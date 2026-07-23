import { sepolia, APP_CODE } from "../../const";

import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
  SigningScheme,
  WithPartialTraderParams,
  SwapAdvancedSettings,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { confirm, getWallet, printQuote } from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";
import { cowAppDataLatestScheme as latest } from "@cowprotocol/sdk-app-data";
import { orderHelperFactoryAbi } from "./abi/OrderHelperFactoryAbi";
import { orderHelperAbi } from "./abi/OrderHelperAbi";

// To setup an account to test this script:
// 1. Create a test account (PK to use in the script)
// 2. Go to https://app.aave.com, enable sepolia (in the gear icon on the top right), and supply sepolia ETH
//    Example: https://sepolia.etherscan.io/tx/0x7cf4f7853963292ff7819d4a5cd5e31c55e7f679e49237c93315b47029486698
// 3. Borrow some GHO
//    Example: https://sepolia.etherscan.io/tx/0xb470bbf7e98d1b4cad7fa79e97b64e295bb2e077f0e91f9220d39c48f339641c
// 4. Add the private key and the RPC URL to the `.env` file:
// ```ini
// RPC_URL_11155111=your-rpc
// PRIVATE_KEY=your-pk
// ```

const TOKENS = {
  oldUnderlying: "0xc558dbdd856501fcd9aaf1e62eae57a9f0629a3c", // WETH
  oldCollateral: "0x5b071b590a59395fe4025a0ccc1fcc931aac1830", // aETHWeth
  debt: "0xc4bf5cbdabe595361438f8c6a187bdc330539c60", // GHO
  newUnderlying: "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8", // USDC
  newCollateral: "0x40d16fc0236f5686f0a7030063ca493c4dd83358", // aUSDC
} as const;

const AAVE_POOL_ADDRESS = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"; // See https://search.onaave.com/?q=sepolia
const COW_AAVE_BORROWER = "0x7d9C4DeE56933151Bc5C909cfe09DEf0d315CB4A"; // See https://github.com/cowprotocol/flash-loan-router/blob/main/networks.json
const COW_AAVE_HELPER_FACTORY = "0xc55098a66d2225c37bf33c1f7b8b9b0abc8fd32f"; // https://sepolia.etherscan.io/address/0xc55098a66d2225c37bf33c1f7b8b9b0abc8fd32f#code
const DEFAULT_GAS_LIMIT = "1000000"; // FIXME: This should not be necessary, it should estimate correctly!

const CHAIN_ID = SupportedChainId.SEPOLIA;

export async function run() {
  const wallet = await getWallet(CHAIN_ID);
  const trader = wallet.address;

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: CHAIN_ID,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Get some info about the assets
  const {
    oldUnderlingBalance,
    oldUnderlyingSymbol,
    oldUnderlyingDecimals,
    oldUnderlyingBalanceFormatted,
    newUnderlyingSymbol,
    newUnderlyingDecimals,
  } = await getAssetsInfo({ wallet, trader });

  // Define trade parameters
  console.log(
    `Get quote for selling ${oldUnderlyingBalanceFormatted} ${oldUnderlyingSymbol} for ${newUnderlyingSymbol}`
  );

  // Get the order details
  const { parameters, advancedSettings, helperContract } =
    await getOrderDetails({
      trader,
      oldUnderlingBalance,
      oldUnderlyingDecimals,
      newUnderlyingDecimals,
      wallet,
    });

  // Post the 1271 order (including the flash-loan hint and the pre-hook)
  // TODO: I believe the SDK doesn't handle very well 1271 orders, we might need to use another specific method to pass also the signature either in the quote, or at the time of posting the order.
  // TODO: The signature should contain the order, so it can be decoded: `GPv2Order.Data memory _order = abi.decode(_signature, (GPv2Order.Data));`. . Keep in mind the signature will be simpler in a future implementation, because we don't need all the order data (most of them are already constants in the contract)
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    parameters,
    advancedSettings
  );

  // Print the quote
  printQuote(quoteResults);
  const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;

  // Ask for confirmation before posting the order
  const confirmed = await confirm(
    `You will get at least ${buyAmount} COW. ok?`
  );
  if (confirmed) {
    // User allows to transfer the old collateral to the helper contract
    await approveOldCollateral({
      wallet,
      trader,
      helperContract,
      oldUnderlingBalance,
      oldUnderlyingDecimals,
      oldUnderlyingSymbol,
    });

    // Post the order
    const { orderId } = await postSwapOrderFromQuote();

    console.log(
      `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
    );
  }
}

async function approveOldCollateral(params: {
  wallet: ethers.Wallet;
  trader: string;
  helperContract: string;
  oldUnderlingBalance: ethers.BigNumberish;
  oldUnderlyingDecimals: number;
  oldUnderlyingSymbol: string;
}) {
  const {
    wallet,
    trader,
    helperContract,
    oldUnderlingBalance,
    oldUnderlyingDecimals,
    oldUnderlyingSymbol,
  } = params;

  // Approve the helper contract to spend the old collateral
  const oldCollateral = await getErc20Contract(TOKENS.oldCollateral, wallet);

  // Get the allowance for the helper contract
  const allowance = await oldCollateral.allowance(trader, helperContract);
  const allowanceFormatted = ethers.utils.formatUnits(
    allowance,
    oldUnderlyingDecimals
  );
  console.log(
    `Allowance for the helper contract: ${allowanceFormatted} ${oldUnderlyingSymbol}`
  );

  if (allowance < oldUnderlingBalance) {
    console.log(
      "Alright! First make sure the helper contract has an approval (we could use permit pre-hook instead too)"
    );

    const tx = await oldCollateral.approve(helperContract, oldUnderlingBalance);
    await tx.wait();
  } else {
    console.log("The helper contract has enough allowance to post the order");
  }
}

async function getAssetsInfo(params: {
  wallet: ethers.Wallet;
  trader: string;
}) {
  const { wallet, trader } = params;

  // Get ERC20 balance for oldUnderlying using ethersjs
  const oldUnderlying = await getErc20Contract(TOKENS.oldUnderlying, wallet);
  const oldCollateral = await getErc20Contract(TOKENS.oldCollateral, wallet);
  const [oldUnderlyingSymbol, oldUnderlyingDecimals, oldUnderlingBalance] =
    await Promise.all([
      oldUnderlying.symbol(),
      oldUnderlying.decimals(),
      oldCollateral.balanceOf(trader),
    ]);
  const oldUnderlyingBalanceFormatted = ethers.utils.formatUnits(
    oldUnderlingBalance,
    oldUnderlyingDecimals
  );

  console.log(
    `Old underlying balance: ${oldUnderlyingBalanceFormatted} ${oldUnderlyingSymbol}`
  );

  const newUnderlying = await getErc20Contract(TOKENS.newUnderlying, wallet);
  const [newUnderlyingSymbol, newUnderlyingDecimals] = await Promise.all([
    newUnderlying.symbol(),
    newUnderlying.decimals(),
  ]);

  return {
    // Old underlying info
    oldUnderlingBalance,
    oldUnderlyingSymbol,
    oldUnderlyingDecimals,
    oldUnderlyingBalanceFormatted,

    // New underlying info
    newUnderlyingSymbol,
    newUnderlyingDecimals,
  };
}

async function getHelperDeploymentPreHook(params: {
  trader: string;
  oldUnderlingBalance: ethers.BigNumberish;
  minReceivedAmount: string;
  validFor: number;
  orderHelperFactory: ethers.Contract;
  wallet: ethers.Wallet;
}): Promise<{
  helperContract: string;
  helperContractDeploymentHook: latest.CoWHook;
}> {
  const {
    trader,
    oldUnderlingBalance,
    minReceivedAmount,
    validFor,
    orderHelperFactory,
    wallet,
  } = params;

  const orderHelperParams = [
    trader, // owner
    AAVE_POOL_ADDRESS, // borrower
    TOKENS.oldCollateral,
    oldUnderlingBalance,
    TOKENS.newCollateral,
    minReceivedAmount,
    validFor,
  ];

  console.log("Get helper contract", orderHelperParams);
  const helperContract: string = await orderHelperFactory.getOrderHelperAddress(
    ...orderHelperParams
  );
  // TODO: We might want to use this function to save one RPC call
  // const helperContract = predictDeterministicAddress({
  //   implementation,
  //   salt: getSalt(orderHelperParams),
  //   factoryAddress: COW_AAVE_COLLATERAL_SWAP_HELPER_FACTORY,
  // });

  // Prepare deployment of the helper contract
  const deployOrderHelperData = orderHelperFactory.interface.encodeFunctionData(
    "deployOrderHelper",
    orderHelperParams
  );
  console.log("deployOrderHelperData", deployOrderHelperData);

  const gasEstimate = await wallet
    .estimateGas({
      to: COW_AAVE_HELPER_FACTORY,
      data: deployOrderHelperData,
      value: ethers.constants.Zero,
    })
    .catch((error) => {
      console.error("error estimating gas", error);
      console.log("Check the call", {
        to: COW_AAVE_HELPER_FACTORY,
        data: deployOrderHelperData,
      });
      return DEFAULT_GAS_LIMIT;
    });
  console.log("gasEstimate", gasEstimate);

  const helperContractDeploymentHook: latest.CoWHook = {
    target: COW_AAVE_HELPER_FACTORY,
    callData: deployOrderHelperData,
    gasLimit: gasEstimate.toString(),
    dappId: "cow-sdk-scripts://flash-loans/collateralSwapAave",
  };

  return {
    helperContract,
    helperContractDeploymentHook,
  };
}

function getCollateralSwapPostHook(params: {
  helperContract: string;
}): latest.CoWHook {
  const { helperContract } = params;

  // Get the helper contract
  const helperContractInstance = new ethers.Contract(
    helperContract,
    orderHelperAbi
  );

  const collateralSwapHook: latest.CoWHook = {
    target: helperContract,
    callData:
      helperContractInstance.interface.encodeFunctionData("swapCollateral"),
    gasLimit: DEFAULT_GAS_LIMIT, // TODO: Estimate gas
    dappId: "cow-sdk-scripts://flash-loans/collateralSwapAave",
  };

  return collateralSwapHook;
}

async function getOrderDetails(props: {
  trader: string;
  oldUnderlingBalance: ethers.BigNumberish;
  oldUnderlyingDecimals: number;
  newUnderlyingDecimals: number;
  wallet: ethers.Wallet;
}): Promise<{
  parameters: WithPartialTraderParams<TradeParameters>;
  advancedSettings?: SwapAdvancedSettings;
  helperContract: string;
}> {
  const {
    trader,
    oldUnderlingBalance,
    oldUnderlyingDecimals,
    newUnderlyingDecimals,
    wallet,
  } = props;

  // Get the minimum receive
  const minReceivedAmount = "1"; // 1 Wei. Technically I would need to ask for a quote. Its a bit tricky, because we would need to ask for a quote with the helper contract as owner. Could be possible with a dirty trick (find an user with balance for the oldUnderlying and ask for a quote to dump it for the newUnderlying). For simplicity, I start hardcoding to 1 web.
  const validFor = 60 * 30; // 30 minutes from now

  // Ger factory contract instance
  const orderHelperFactory = new ethers.Contract(
    COW_AAVE_HELPER_FACTORY,
    orderHelperFactoryAbi,
    wallet
  );

  // Get the hook to deploy the helper contract
  const { helperContractDeploymentHook, helperContract } =
    await getHelperDeploymentPreHook({
      trader,
      oldUnderlingBalance,
      minReceivedAmount,
      validFor,
      orderHelperFactory,
      wallet,
    });

  // Get the hook to swap the collateral
  const collateralSwapHook = getCollateralSwapPostHook({ helperContract });

  const parameters: TradeParameters = {
    kind: OrderKind.SELL,
    amount: oldUnderlingBalance.toString(), // All underlying balance
    sellToken: TOKENS.oldUnderlying,
    sellTokenDecimals: oldUnderlyingDecimals,
    buyToken: TOKENS.newUnderlying,
    buyTokenDecimals: newUnderlyingDecimals,

    partiallyFillable: false,
    owner: helperContract as `0x${string}`,
    receiver: helperContract,
    validFor,
  };
  console.log("Trade parameters", parameters);

  // Flash loan
  const flashLoanHint = {
    lender: AAVE_POOL_ADDRESS,
    
    borrower: COW_AAVE_BORROWER,
    token: TOKENS.oldUnderlying,
    amount: oldUnderlingBalance,


    loanReceiver: helperContract, // TODO: not implemented in backend, but should be useful
  };

  // minimal
  {
    token: TOKENS.oldUnderlying,
    amount: oldUnderlingBalance,
  }

  // Use this borrower
  {
    token: TOKENS.oldUnderlying,
    amount: oldUnderlingBalance,
    borrower: ..,
  }


  // // Use just-in-time borrower
  // {
  //   token: TOKENS.oldUnderlying,
  //   amount: oldUnderlingBalance,
  //   borrower: helper,  
  //   calldata: deploymnent
  // }

  // {
  //   token: TOKENS.oldUnderlying,
  //   amount: oldUnderlingBalance,
  //   borrower: helperFactory,
  //   factoryParams: deploymnent
  // }




  // 



  const {  receiver, ... } = decode(borrowerData)

  console.log("flashLoanHint", flashLoanHint);

  const advancedSettings: SwapAdvancedSettings = {
    additionalParams: {
      signingScheme: SigningScheme.EIP1271,
    },
    appData: {
      appCode: APP_CODE,
      metadata: {
        // @ts-ignore The flash-loan hint is still not added officially to https://github.com/cowprotocol/app-data
        flashLoan: flashLoanHint,
        hooks: {
          pre: [helperContractDeploymentHook],
          post: [collateralSwapHook],
        },
      },
    },
  };

  return {
    parameters,
    advancedSettings,
    helperContract,
  };
}
