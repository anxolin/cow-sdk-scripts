import * as weiroll from "@weiroll/weiroll.js";
import { SigningScheme } from "@cowprotocol/contracts";

import { mainnet, APP_CODE } from "../../const";
const { DAI_ADDRESS, USDC_ADDRESS } = mainnet;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
  CowShedHooks,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";

import { MetadataApi } from "@cowprotocol/app-data";
import { confirm, getWallet, printQuote } from "../../common/utils";
import { createBridgeTx } from "../../omnibridge/createBridgeTx";
import { BaseTransaction } from "../../types";

export async function run() {
  const chainId = SupportedChainId.MAINNET;
  const wallet = await getWallet(chainId);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: chainId,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log(
    "Buy 1 DAI using USDC and bridge to Gnosis Chain using Omnibridge"
  );

  const { cowShedAccount, authenticatedBridgeTx, gasLimit } =
    await getCowShedDetails(chainId, wallet);

  const parameters: TradeParameters = {
    kind: OrderKind.BUY, // Buy
    amount: ethers.utils.parseUnits("1", 18).toString(), // 1 DAI
    sellToken: USDC_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: DAI_ADDRESS, // For DAI
    buyTokenDecimals: 18,
    partiallyFillable: false, // Fill or Kill
    receiver: cowShedAccount,
  };

  const metadataApi = new MetadataApi();
  const appData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      hooks: {
        post: [
          {
            callData: authenticatedBridgeTx.callData,
            gasLimit: gasLimit.toString(),
            target: authenticatedBridgeTx.to,
            dappId: "bridge-to-omnibridge-script",
          },
        ],
      },
    },
  });

  const quote = await sdk.getQuote(parameters, { appData });
  const { postSwapOrderFromQuote, quoteResults } = quote;

  const maxSellAmount = quoteResults.amountsAndCosts.afterSlippage.sellAmount;
  const maxSellAmountFormatted = ethers.utils.formatUnits(maxSellAmount, 6);

  console.log(`You will get pay at most: ${maxSellAmountFormatted} USDC. ok?`);

  const confirmed = await confirm(
    `You will sell at most ${maxSellAmountFormatted} USDC. ok?`
  );
  if (!confirmed) {
    console.log("🚫 Aborted");
    return;
  }

  // Post the order
  const orderId = await postSwapOrderFromQuote();

  // Print the order creation
  console.log(
    `ℹ️ Order created, id: https://explorer.cow.fi/orders/${orderId}?tab=overview`
  );

  // Wait for the bridge start
  console.log("🕣 Waiting for the bridge to start...");
  console.log("🔗 Omnibridge link: <URL>");
  // TODO: Implement

  // Wait for the bridging to be completed
  console.log("🕣 Waiting for the bridging to be completed...");
  // TODO: Implement

  console.log("🎉 The 1 DAI you bought is now available in Gnosis Chain");
}

// TODO: Move to a shared location
export function getCowShedNonce(): string {
  return ethers.utils.hexZeroPad(ethers.utils.hexlify(Date.now()), 32);
}

export function getCowShedDeadline(): bigint {
  // return max uint256
  return ethers.constants.MaxUint256.toBigInt();
}

// TODO: Move to a shared location
async function getCowShedDetails(
  chainId: SupportedChainId,
  wallet: ethers.Wallet
): Promise<{
  cowShedAccount: string;
  authenticatedBridgeTx: BaseTransaction;
  gasLimit: bigint;
}> {
  // Get the cow-shed for the wallet
  const cowShedHooks = new CowShedHooks(chainId);
  const cowShedAccount = cowShedHooks.proxyOf(wallet.address);

  console.log(
    `CoW-shed will be the receiver of the SWAP, who will initiate the bridging. CoW-shed=${cowShedAccount}`
  );

  // Get raw transaction to bridge all DAI from cow-shed using omnibridge
  const bridgeTx = await createBridgeTx({
    bridgedToken: DAI_ADDRESS,
    owner: wallet.address,
    cowShedProxy: cowShedAccount,
  });

  // Sign the bridge transaction
  const calls = [
    {
      callData: bridgeTx.callData,
      target: bridgeTx.to,
      value: bridgeTx.value,
      isDelegateCall: !!bridgeTx.isDelegateCall,
      allowFailure: false,
    },
  ];
  const nonce = getCowShedNonce();
  const deadline = getCowShedDeadline();

  const signature = await cowShedHooks.signCalls(
    calls,
    nonce,
    deadline,
    wallet,
    SigningScheme.EIP712
  );

  const callData = cowShedHooks.encodeExecuteHooksForFactory(
    calls,
    nonce,
    deadline,
    cowShedAccount, // TODO: Check if this is correct 👀
    signature
  );

  const cowShedFactoryAddress = cowShedHooks.getFactoryAddress();
  const gasEstimate = await wallet.estimateGas({
    to: cowShedFactoryAddress,
    data: callData,
    value: 0,
  });

  return {
    cowShedAccount,
    authenticatedBridgeTx: {
      callData,
      to: cowShedFactoryAddress,
      value: 0n,
    },
    gasLimit: gasEstimate.toBigInt(),
  };
}
