import { gnosis, bnbchain, APP_CODE } from "../../const";
import { ethers } from "ethers";
import axios from "axios";
import { confirm, getWallet, jsonReplacer } from "../../utils";
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { MetadataApi } from "@cowprotocol/app-data";

const { GNO_ADDRESS } = gnosis;
const { BTCB_ADDRESS } = bnbchain;

interface SwapsIoQuoteParams {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmount: string;
  toChainId: string;
  toTokenAddress: string;
  fromActor?: string;
  fromActorReceiver?: string;
}

interface Token {
  address: string;
  decimals: number;
}

async function apiRequest(method: string, params: any, post: boolean = false) {
  const req = axios.create();
  const baseUrl = "https://api.prod.swaps.io";
  const url = `${baseUrl}/api/v0/cowswap/${method}`;

  console.log("🕣 Requesting...", url, params);
  return post ? req.post(url, params) : req.get(url, { params });
}

async function selectIntermediaryAddress(
  quote: SwapsIoQuoteParams
): Promise<Token> {
  const selectData = await apiRequest("select", quote);
  const decimals: Record<string, number> = {
    "0x8e5bbbb09ed1ebde8674cda39a0c169401db4252": 8,
    "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83": 6,
  };

  console.log("🕣 Select data", selectData.data);

  return {
    address: selectData.data.intermediaryAddress,
    decimals:
      decimals[(selectData.data.intermediaryAddress as string).toLowerCase()] ??
      18,
  };
}

async function getCrossChainQuote(quote: SwapsIoQuoteParams): Promise<any> {
  return await apiRequest("quote", quote);
}

async function initCrossChainOrder(quote: SwapsIoQuoteParams): Promise<any> {
  return await apiRequest("save", quote, true);
}

async function getHookData(swapHash: string, signature: string): Promise<any> {
  return await apiRequest(`submit/${swapHash}`, { signature }, true);
}

export async function run() {
  /**
   * Cross-Chain CowSwap Example via Swaps.io:
   *  This example demonstrates buying BTCB on BNB chain using GNO on Gnosis chain,
   *  using CowSwap for the initial trade and Swaps.io for cross-chain bridging.
   */

  // Constants
  const srcChainId = SupportedChainId.GNOSIS_CHAIN; // Gnosis Chain ID
  const srcToken: Token = {
    address: GNO_ADDRESS,
    decimals: 18,
  };
  const dstChainId = 56; // BNB Chain ID
  const dstToken: Token = {
    address: BTCB_ADDRESS,
    decimals: 18,
  };

  // Amount of GNO you want to sell
  const srcTokenAmountFormatted = "0.05";
  const srcTokenAmount = ethers.utils
    .parseUnits(srcTokenAmountFormatted, srcToken.decimals)
    .toString();

  // Get a signer/wallet connected to Gnosis
  const wallet = await getWallet(srcChainId);

  console.log("===========================================");
  console.log(" Swaps.io Cross-Chain Swap via CowSwap");
  console.log("===========================================");
  console.log(`You want to buy BTCB on BNB chain using GNO on Gnosis chain.`);
  console.log(`Amount of GNO to sell: ${srcTokenAmountFormatted}`);

  // ----------------------------
  // STEP A: Select intermediary token
  // ----------------------------
  console.log("Fetching intermediary token...");
  const selectQuoteParams = {
    fromChainId: srcChainId.toString(),
    fromTokenAddress: srcToken.address,
    fromAmount: srcTokenAmount,
    toChainId: dstChainId.toString(),
    toTokenAddress: dstToken.address,
  };
  const intermediaryToken = await selectIntermediaryAddress(selectQuoteParams);
  console.log("Intermediary token determined:", intermediaryToken.address);

  // ----------------------------
  // STEP B: Get a pre-quote on CowSwap for the intermediary token
  // ----------------------------
  const sdk = new TradingSdk({
    chainId: srcChainId,
    signer: wallet,
    appCode: APP_CODE,
  });

  const preQuoteParams: TradeParameters = {
    kind: OrderKind.SELL,
    amount: srcTokenAmount,
    sellToken: srcToken.address,
    sellTokenDecimals: srcToken.decimals,
    buyToken: intermediaryToken.address,
    buyTokenDecimals: intermediaryToken.decimals,
    partiallyFillable: false,
  };

  console.log("Fetching pre-quote from CowSwap for the intermediary token...");
  const preQuote = await sdk.getQuote(preQuoteParams);
  const minBuyAmount =
    preQuote.quoteResults.amountsAndCosts.afterSlippage.buyAmount;
  console.log(
    `Estimated intermediary token received: ${ethers.utils.formatUnits(
      minBuyAmount,
      intermediaryToken.decimals
    )}`
  );

  // ----------------------------
  // STEP C: Get cross-chain quote for final token on destination chain
  // ----------------------------
  console.log(
    "Fetching cross-chain quote on Swaps.io for final token on destination chain..."
  );
  const crossChainQuoteParams = {
    ...selectQuoteParams,
    fromTokenAddress: intermediaryToken.address,
    fromAmount: minBuyAmount.toString(),
  };
  const crossChainQuote = await getCrossChainQuote(crossChainQuoteParams);
  const formattedFinalAmount = ethers.utils.formatUnits(
    crossChainQuote.data.order.toAmount.toString(),
    dstToken.decimals
  );
  console.log(`You will receive ${formattedFinalAmount} BTCB on BNB chain.`);

  // ----------------------------
  // STEP D: Initiate cross-chain order on Swaps.io
  // ----------------------------
  console.log("Initiating the cross-chain order on Swaps.io...");
  const initOrderParams = {
    ...crossChainQuoteParams,
    fromActor: wallet.address,
    fromActorReceiver: wallet.address,
  };
  const orderData = await initCrossChainOrder(initOrderParams);
  const swapHash = orderData.data.hash;
  const typedData = orderData.data.signable.data;
  console.log("Cross-chain order initiated. Swap hash:", swapHash);

  // ----------------------------
  // STEP E: Sign the typed data of CowShed hook returned by Swaps.io
  // ----------------------------
  // TODO: Ideally for security, is best the call data is generated here and not received by an API
  console.log("Signing typed data required by Swaps.io...");
  const { domain, types, message } = typedData;
  const signature = await wallet._signTypedData(
    domain,
    { ExecuteHooks: types["ExecuteHooks"], Call: types["Call"] },
    message
  );

  // ----------------------------
  // STEP F: Submit signature and get hook call data
  // ----------------------------
  // TODO: Review why the hook data is received from an API instead of generated here
  console.log("Submitting signature to Swaps.io for hook data...");
  const hookData = await getHookData(swapHash, signature);
  const hook = hookData.data.hookData.hook;
  console.log("🕣 Hook data", hook);

  // ----------------------------
  // STEP G: Create a final CowSwap order with the post-hook data
  // ----------------------------
  console.log("Generating final CowSwap order with post-hook data...");

  const parameters: TradeParameters = {
    kind: OrderKind.BUY, // TODO: The example is a buy order. WIll be nice to test a sell order
    amount: minBuyAmount.toString(),
    sellToken: srcToken.address,
    sellTokenDecimals: srcToken.decimals,
    buyToken: intermediaryToken.address,
    buyTokenDecimals: intermediaryToken.decimals,
    partiallyFillable: false,
    receiver: hookData.data.hookData.recipientOverride,
  };

  const metadataApi = new MetadataApi();
  const appData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      hooks: {
        post: [
          {
            ...hook,
            dappId: "swaps-io",
          },
        ],
      },
    },
  });

  console.log(
    "🕣 Getting quote...",
    JSON.stringify(parameters, jsonReplacer, 2)
  );

  // TODO: This is the second quote we ask to the API. I understand why, its because first one is to estimate how many intermediate tokens we get, and the second one is to re-estimate once we have the hook. In principle, we should need one if we can use already a gas estimation and a mock hook at the begining.
  const quote = await sdk.getQuote(parameters, { appData });
  const { postSwapOrderFromQuote, quoteResults } = quote;

  const maxSellAmount = quoteResults.amountsAndCosts.afterSlippage.sellAmount;
  const maxSellAmountFormatted = ethers.utils.formatUnits(
    maxSellAmount,
    srcToken.decimals
  );

  const confirmed = await confirm(
    `You will sell at most ${maxSellAmountFormatted} GNO to buy ${formattedFinalAmount} BTCB on BNB chain. ok?`
  );
  if (!confirmed) {
    console.log("🚫 Aborted");
    return;
  }

  // ----------------------------
  // STEP H: Post the final order and track cross-chain completion
  // ----------------------------
  const orderId = await postSwapOrderFromQuote();

  // Print the order creation
  console.log(
    `ℹ️ Order created, id: https://explorer.cow.fi/orders/${orderId}?tab=overview`
  );

  // Wait for the cross-chain swap start
  console.log("🕣 Waiting for the cross-chain swap to start...");
  console.log(
    `🔗 Swaps.io Explorer link: https://api.prod.swaps.io/api/v0/swaps/${swapHash}`
  );
  // TODO: Implement

  // Wait for the cross-chain swap to be completed
  console.log("🕣 Waiting for the cross-chain swap to be completed...");
  // TODO: Implement

  console.log("🎉 The BTCB you bought is now available in BNB Chain");
}
