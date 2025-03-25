import { base, arbitrum, APP_CODE } from "../../const";

import {
  SupportedChainId,
  BridgingSdk,
  AcrossBridgeProvider,
  QuoteBridgeRequest,
  OrderKind,
  AccountAddress,
  assertIsBridgeQuoteAndPost,
  getChainInfo,
  BridgeQuoteAndPost,
} from "@cowprotocol/cow-sdk";

import { ethers } from "ethers";

import { confirm, getRpcProvider, getWallet, jsonReplacer } from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";

export async function run() {
  // Sell token (USDC in Arbitrum)
  const sellTokenChainId = SupportedChainId.ARBITRUM_ONE;
  const sellTokenAddress = arbitrum.USDC_ADDRESS;
  const sellTokenDecimals = 6;

  // Buy token (WETH in Base)
  const buyTokenChainId = SupportedChainId.BASE;
  const buyTokenAddress = base.WETH_ADDRESS;
  const buyTokenDecimals = 18;

  // Amount to sell
  const sellAmount = ethers.utils.parseUnits("5", sellTokenDecimals).toBigInt();

  // Get wallet
  const wallet = await getWallet(sellTokenChainId);

  // Initialize the Across bridge provider
  const acrossBridgeProvider = new AcrossBridgeProvider();

  // Initialize the SDK with the wallet
  const sdk = new BridgingSdk({
    providers: [acrossBridgeProvider],
    enableLogging: true,
    // tradingSdk: new TradingSdk({}, { enableLogging: true }),
  });

  const parameters: QuoteBridgeRequest = {
    kind: OrderKind.SELL,

    sellTokenChainId,
    sellTokenAddress,
    sellTokenDecimals,

    buyTokenChainId,
    buyTokenAddress,
    buyTokenDecimals,

    amount: sellAmount,

    // TODO: Sort this mess
    receiver: wallet.address,
    signer: wallet,
    account: wallet.address as AccountAddress, // FIXME: Why is this needed

    partiallyFillable: false,
    slippageBps: 50,
    appCode: APP_CODE,
  };

  const { signer, ...restParameters } = parameters;
  console.log(
    "🕣 Getting quote...",
    JSON.stringify(restParameters, jsonReplacer, 2)
  );

  const quote = await sdk.getQuote(parameters);
  assertIsBridgeQuoteAndPost(quote);

  // Get the symbols for the tokens
  const sourceChainProvider = await getRpcProvider(parameters.sellTokenChainId);
  const targetChainProvider = await getRpcProvider(parameters.buyTokenChainId);
  const sellTokenSymbol = await getErc20Contract(
    quote.swap.tradeParameters.sellToken,
    sourceChainProvider
  ).symbol();
  const intermediateSymbol = await getErc20Contract(
    quote.swap.tradeParameters.buyToken,
    sourceChainProvider
  ).symbol();
  const buyTokenSymbol = await getErc20Contract(
    quote.bridge.tradeParameters.buyTokenAddress,
    targetChainProvider
  ).symbol();

  // Print the quote
  const quoteString = await formatQuote({
    parameters,
    quote,
    sellTokenSymbol,
    intermediateSymbol,
    buyTokenSymbol,
  });
  console.log(quoteString);

  const sellAmountFormatted = formatAmount(
    sellAmount,
    sellTokenDecimals,
    sellTokenSymbol
  );
  const minReceiveBuyToken = formatAmount(
    quote.bridge.amountsAndCosts.afterSlippage.buyAmount,
    buyTokenDecimals,
    buyTokenSymbol
  );

  const confirmed = await confirm(
    `Sell ${sellAmountFormatted} USDC (Arbitrum) for receive at least ${minReceiveBuyToken} WETH (Base). ok?`
  );
  if (!confirmed) {
    console.log("🚫 Aborted");
    return;
  }

  // Post the order
  const orderId = await quote.postSwapOrderFromQuote();

  // Print the order creation
  console.log(
    `ℹ️ Order created, id: https://explorer.cow.fi/orders/${orderId}?tab=overview`
  );

  // Wait for the bridge start
  console.log("🕣 Waiting for the bridge to start...");
  console.log("🔗 Across link: <URL>");
  // TODO: Implement

  // Wait for the bridging to be completed
  console.log("🕣 Waiting for the bridging to be completed...");
  // TODO: Implement

  console.log(`🎉 The WETH is now waiting for you in Base`);
}

async function formatQuote(params: {
  parameters: QuoteBridgeRequest;
  quote: BridgeQuoteAndPost;
  sellTokenSymbol: string;
  intermediateSymbol: string;
  buyTokenSymbol: string;
}): Promise<string> {
  const {
    parameters,
    quote,
    sellTokenSymbol,
    intermediateSymbol,
    buyTokenSymbol,
  } = params;
  const { bridge, swap } = quote;

  const swapAmount = swap.amountsAndCosts;
  const bridgeAmount = bridge.amountsAndCosts;

  return `
Swap details:
  - Trader: ${parameters.account}
  - Sell
      - Chain: ${formatChainId(parameters.sellTokenChainId)}
      - Token: ${formatToken(
        swap.tradeParameters.sellToken,
        swap.tradeParameters.sellTokenDecimals,
        sellTokenSymbol
      )}
      - Amount: ${formatAmount(
        swapAmount.afterNetworkCosts.sellAmount,
        swap.tradeParameters.sellTokenDecimals,
        sellTokenSymbol
      )}
  - Buy (intermediate token)
      - Chain: ${formatChainId(parameters.sellTokenChainId)}
      - Token: ${formatToken(
        swap.tradeParameters.buyToken,
        swap.tradeParameters.buyTokenDecimals,
        intermediateSymbol
      )}
      - Est. Receive: ${formatAmount(
        swapAmount.afterPartnerFees.buyAmount,
        swap.tradeParameters.buyTokenDecimals,
        intermediateSymbol
      )}
      - Min. Receive: ${formatAmount(
        swapAmount.afterSlippage.buyAmount,
        swap.tradeParameters.buyTokenDecimals,
        intermediateSymbol
      )}
  - Network fee:
      - in sell token: ${formatAmount(
        swapAmount.costs.networkFee.amountInSellCurrency,
        swap.tradeParameters.sellTokenDecimals,
        sellTokenSymbol
      )}
      - in buy token: ${formatAmount(
        swapAmount.costs.networkFee.amountInBuyCurrency,
        swap.tradeParameters.buyTokenDecimals,
        intermediateSymbol
      )}
  - Slippage: ${swap.tradeParameters.slippageBps ?? "default"}
  - Receiver (cow-shed): ${swap.tradeParameters.receiver}

Bridge details:
   - Bridge provider:
       - Name: ${bridge.providerInfo.name}
       - Logo: ${bridge.providerInfo.logoUrl}
   - Bridged token (intermediate token)
       - Chain: ${formatChainId(bridge.tradeParameters.sellTokenChainId)}
       - Token: ${formatToken(
         bridge.tradeParameters.sellTokenAddress,
         bridge.tradeParameters.sellTokenDecimals,
         intermediateSymbol
       )}       
       - Amount: ${formatAmount(
         bridgeAmount.beforeFee.sellAmount,
         bridge.tradeParameters.sellTokenDecimals,
         intermediateSymbol
       )}
   - Buy:
       - Chain: ${formatChainId(bridge.tradeParameters.buyTokenChainId)}
       - Token: ${formatToken(
         bridge.tradeParameters.buyTokenAddress,
         bridge.tradeParameters.buyTokenDecimals,
         buyTokenSymbol
       )}       
       - Est. Receive (buy token): ${formatAmount(
         bridgeAmount.afterFee.buyAmount,
         bridge.tradeParameters.buyTokenDecimals,
         buyTokenSymbol
       )}
       - Min. Receive (buy token): ${formatAmount(
         bridgeAmount.afterSlippage.buyAmount,
         bridge.tradeParameters.buyTokenDecimals,
         buyTokenSymbol
       )}
   - Bridging fee:
       - Fee: ${bridgeAmount.costs.bridgingFee.feeBps} BPS
       - in sell token: ${formatAmount(
         bridgeAmount.costs.bridgingFee.amountInSellCurrency,
         bridge.tradeParameters.sellTokenDecimals,
         intermediateSymbol
       )}
       - in buy token: ${formatAmount(
         bridgeAmount.costs.bridgingFee.amountInBuyCurrency,
         bridge.tradeParameters.buyTokenDecimals,
         buyTokenSymbol
       )}
   - Slippage: ${bridgeAmount.slippageBps}
   - Recipient (trader): ${bridge.tradeParameters.receiver}
`;
}

function formatChainId(chainId: number) {
  const chainInfo = getChainInfo(chainId);
  return `${chainInfo ? chainInfo.label : "UNKNOWN CHAIN"} (${chainId})`;
}

function formatToken(address: string, decimals: number, symbol: string) {
  return `${symbol} (${address}, decimals: ${decimals})`;
}

function formatAmount(amount: bigint, decimals: number, symbol: string) {
  return `${ethers.utils.formatUnits(amount, decimals)} ${symbol} (${amount})`;
}
