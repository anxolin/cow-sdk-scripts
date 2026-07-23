import { sepolia, APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";

import {
  SupportedChainId,
  OrderKind,
  TradingSdk,
  Twap,
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderBookApi,
} from "@cowprotocol/cow-sdk";

import { MetadataApi } from "@cowprotocol/app-data";
import { BigNumber, ethers } from "ethers";
import { confirm, debugStringify, getWallet, printQuote } from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";
import { getCowShedSdk } from "./cowShed";
// import { latest } from "@cowprotocol/app-data";

const DEFAULT_GAS_LIMIT = 500_000n;

interface Token {
  symbol: string;
  address: string;
  decimals: number;
  contract: ethers.Contract;
}

const TOKENS = {
  // Ideally, we would have sell=buy support, so this should disappear and twapSellToken should be used instead
  beforeTwapSellToken: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", // wxDAI

  twapSellToken: "0xaf204776c7245bF4147c2612BF6e5972Ee483701", // sDAI
  twapBuyToken: "0x177127622c4A00F3d409B75571e12cB3c8973d3c", // COW
} as const;

const PARTS = 2;

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;

export async function run() {
  const wallet = await getWallet(CHAIN_ID);
  const eoaTrader = wallet.address as `0x${string}`;

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: CHAIN_ID,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Get some info about the assets
  const { beforeTwapSellToken, twapSellToken, twapBuyToken } =
    await getAssetsInfo({ wallet, trader: eoaTrader });

  const sellAmount = ethers.utils.parseUnits("0.2", twapSellToken.decimals); // 0.1 sDAI
  const sellAmountFormatted = ethers.utils.formatUnits(
    sellAmount,
    twapSellToken.decimals,
  );

  const cowShedSdk = getCowShedSdk();
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, eoaTrader);
  console.log("CowShed account:", cowShed);

  // Define trade parameters
  console.log(
    `TWAP sell ${sellAmountFormatted} ${twapSellToken.symbol} for ${twapBuyToken.symbol} in ${PARTS} parts.
To create the TWAP we we will use for this PoC an intermediate order with a post hook:
  - Buy ${sellAmountFormatted} ${twapSellToken.symbol} with ${beforeTwapSellToken.symbol}, sent to ${cowShed}
  - Post-hook will create the TWAP using cow-shed. Each part sells ${twapSellToken.symbol} for ${twapBuyToken.symbol}`,
  );

  // Generate app data for TWAP order
  const metadataApi = new MetadataApi();
  const twapAppData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    environment: "prod",
    metadata: {},
  });
  const { appDataContent: twapAppDataContent, appDataHex: twapAppDataHex } =
    await metadataApi.getAppDataInfo(twapAppData);

  const orderBookApi = new OrderBookApi({
    chainId: CHAIN_ID,
  });

  // TODO: Create TWAP + Derive shed + set shed as the destination for the TWAP
  const twap = Twap.fromData({
    // The TWAP orders sends the bought tokens to the trader
    receiver: eoaTrader,
    sellAmount: sellAmount,
    buyAmount: BigNumber.from(PARTS), // TODO: Get another quote and apply a good slippage
    numberOfParts: BigNumber.from(PARTS),
    timeBetweenParts: BigNumber.from(300),
    sellToken: twapSellToken.address,
    buyToken: twapBuyToken.address,
    appData: twapAppDataHex,
  });

  console.log("TWAP ID:", twap.id);
  console.log("TWAP params for cereation of order", {
    twapParams: twap.leaf,
    twapData: debugStringify(twap.data),
    twapAppDataContent: twapAppDataContent,
  });

  console.log("Uploading TWAP app data to API...");
  await orderBookApi.uploadAppData(twapAppDataHex, twapAppDataContent);

  // Get calldata and gas estimation for the approval
  const approveSellTokenCalldata =
    twapSellToken.contract.interface.encodeFunctionData("approve", [
      COW_VAULT_RELAYER_CONTRACT,
      sellAmount,
    ]);
  console.log("Approve sell token calldata:", approveSellTokenCalldata);

  const approveSellTokenGasLimit =
    await twapSellToken.contract.estimateGas.approve(
      COW_VAULT_RELAYER_CONTRACT,
      sellAmount,
    );
  console.log(
    "Approve sell token gas limit:",
    approveSellTokenGasLimit.toString(),
  );

  const deadline = BigInt(Math.ceil(Date.now() / 1000)) + 1800n;
  console.log(
    `Deadline: ${deadline} (${new Date(Number(deadline) * 1000).toISOString()})`,
  );

  const { signedMulticall: approveAndTwap, gasLimit: approveAndTwapGasLimit } =
    await cowShedSdk.signCalls({
      chainId: CHAIN_ID,
      calls: [
        {
          callData: approveSellTokenCalldata,
          target: twapSellToken.address,
          value: 0n,
          isDelegateCall: false,
          allowFailure: true,
        },
        {
          callData: twap.createCalldata,
          target: COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID],
          value: 0n,
          isDelegateCall: false,
          allowFailure: true,
        },
      ],
      deadline,
      signer: wallet,
      defaultGasLimit: DEFAULT_GAS_LIMIT,
    });
  console.log("Signed twap calldata:", approveAndTwap);

  // Dummy order that creates the TWAP
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    {
      // Buy the sell amount we will later use for creating the TWAP. Using Buy order, so we can be assured we know the sell amount of the TWAP
      kind: OrderKind.BUY,
      buyToken: twapSellToken.address,
      buyTokenDecimals: twapSellToken.decimals,
      amount: sellAmount.toString(),
      sellToken: beforeTwapSellToken.address,
      sellTokenDecimals: beforeTwapSellToken.decimals,

      receiver: cowShed, // Receiver is a special shed with support for Composable Cow. See https://github.com/cowdao-grants/cow-shed/pull/53
      owner: eoaTrader,
      partiallyFillable: false,
      validFor: 1800,
    },
    {
      appData: {
        appCode: APP_CODE,
        metadata: {
          hooks: {
            post: [
              // Approve and create the TWAP
              {
                callData: approveAndTwap.data,
                gasLimit: approveAndTwapGasLimit.toString(),
                target: approveAndTwap.to,
                dappId: "cow-sdk-scripts://composable-cow/post-twap-for-eoa",
              },
            ],
          },
        },
      },
    },
  );

  // Print the quote
  printQuote(quoteResults);
  const sellAmountIntialTrade =
    quoteResults.amountsAndCosts.afterSlippage.sellAmount;
  const sellAmountIntialTradeFormatted = ethers.utils.formatUnits(
    sellAmountIntialTrade,
    beforeTwapSellToken.decimals,
  );

  // Ask for confirmation before posting the order
  const confirmed = await confirm(
    `Your CoW Shed will get exactly ${sellAmountFormatted} ${twapSellToken.symbol} for at most ${sellAmountIntialTradeFormatted} ${beforeTwapSellToken.symbol}. Then a TWAP will be created with each part selling ${twapSellToken.symbol} for ${twapBuyToken.symbol}. ok?`,
  );
  if (confirmed) {
    const allowance = await beforeTwapSellToken.contract.allowance(
      eoaTrader,
      COW_VAULT_RELAYER_CONTRACT,
    );
    console.log(
      `Allowance for Vault Relayer: ${allowance} ${beforeTwapSellToken.symbol}`,
    );
    if (allowance < sellAmountIntialTrade) {
      console.log(
        `Approving sell token for: ${sellAmountIntialTradeFormatted} ${beforeTwapSellToken.symbol}`,
      );

      const tx = await beforeTwapSellToken.contract.approve(
        COW_VAULT_RELAYER_CONTRACT,
        ethers.constants.MaxUint256,
        // sellAmountIntialTrade
      );
      console.log(`Approving ${beforeTwapSellToken.symbol}. tx:`, tx.hash);
      await tx.wait();
      console.log(`${beforeTwapSellToken.symbol} Approved`);
    }

    // Post the order
    const { orderId } = await postSwapOrderFromQuote();

    console.log(
      `Order created, id: https://explorer.cow.fi/gc/orders/${orderId}?tab=overview`,
    );
  }
}

async function getAssetsInfo(params: {
  wallet: ethers.Wallet;
  trader: string;
}): Promise<{
  beforeTwapSellToken: Token;
  twapSellToken: Token;
  twapBuyToken: Token;
}> {
  const { wallet } = params;

  // Get ERC20 balance for oldUnderlying using ethersjs
  const beforeTwapSellToken = await getErc20Contract(
    TOKENS.beforeTwapSellToken,
    wallet,
  );
  const twapSellToken = await getErc20Contract(TOKENS.twapSellToken, wallet);
  const twapBuyToken = await getErc20Contract(TOKENS.twapBuyToken, wallet);

  const [
    beforeTwapSellTokenSymbol,
    beforeTwapSellTokenDecimals,
    twapSellTokenSymbol,
    twapSellTokenDecimals,
    twapBuyTokenSymbol,
    twapBuyTokenDecimals,
  ] = await Promise.all([
    beforeTwapSellToken.symbol(),
    beforeTwapSellToken.decimals(),
    twapSellToken.symbol(),
    twapSellToken.decimals(),
    twapBuyToken.symbol(),
    twapBuyToken.decimals(),
  ]);

  return {
    beforeTwapSellToken: {
      symbol: beforeTwapSellTokenSymbol,
      address: beforeTwapSellToken.address,
      decimals: beforeTwapSellTokenDecimals,
      contract: beforeTwapSellToken,
    },
    twapSellToken: {
      symbol: twapSellTokenSymbol,
      address: twapSellToken.address,
      decimals: twapSellTokenDecimals,
      contract: twapSellToken,
    },
    twapBuyToken: {
      symbol: twapBuyTokenSymbol,
      address: twapBuyToken.address,
      decimals: twapBuyTokenDecimals,
      contract: twapBuyToken,
    },
  };
}
