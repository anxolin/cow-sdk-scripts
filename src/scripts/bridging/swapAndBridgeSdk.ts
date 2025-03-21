import { base, arbitrum, APP_CODE } from "../../const";

import {
  SupportedChainId,
  BridgingSdk,
  AcrossBridgeProvider,
  QuoteBridgeRequest,
  OrderKind,
  isBridgeQuoteAndPost,
  AccountAddress,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";

import { confirm, getWallet, jsonReplacer } from "../../utils";

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
    appCode: APP_CODE,

    // TODO: Sort this mess
    receiver: wallet.address,
    signer: wallet,
    account: wallet.address as AccountAddress, // FIXME: Why is this needed

    partiallyFillable: false,
    slippageBps: 50,
  };

  console.log(
    "🕣 Getting quote...",
    JSON.stringify(parameters, jsonReplacer, 2)
  );

  const quote = await sdk.getQuote(parameters);
  if (!isBridgeQuoteAndPost(quote))
    throw new Error("Quote is not a bridge quote");

  // After the assertion, we can safely destructure the quote
  const { postSwapOrderFromQuote, bridge, swap } = quote;

  const swapAmount = swap.amountsAndCosts;
  const bridgeAmount = bridge.amountsAndCosts;

  console.log(`
Swap details:
  - Sell
      - Token: ${swap.tradeParameters.sellToken} (${
    swap.tradeParameters.sellTokenDecimals
  })
      - Amount: ${swapAmount.afterNetworkCosts.sellAmount}
  - Buy (intermediate token))
      - Token: ${swap.tradeParameters.buyToken} (${
    swap.tradeParameters.buyTokenDecimals
  })
      - Est. Receive: ${swapAmount.afterPartnerFees.buyAmount}
      - Min. Receive: ${swapAmount.afterSlippage.buyAmount}
  - Network fee: ${swapAmount.costs.networkFee}
  - Slippage: ${swap.tradeParameters.slippageBps ?? "default"}
  - Receiver: ${swap.tradeParameters.receiver}

Bridge details:
   - Bridge provider:
       - Name: ${bridge.providerInfo.name}
       - Logo: ${bridge.providerInfo.logoUrl}
   - Bridged token (intermediate token)
       - Token: ${bridge.tradeParameters.sellTokenAddress} (${
    bridge.tradeParameters.sellTokenDecimals
  })
       - Amount: ${bridgeAmount.beforeFee.sellAmount}
   - Buy:
       - Token: ${bridge.tradeParameters.buyTokenAddress} (${
    bridge.tradeParameters.buyTokenDecimals
  })
       - Est. Receive (buy token): ${bridgeAmount.afterFee.buyAmount}
       - Min. Receive (buy token): ${bridgeAmount.afterSlippage.buyAmount}
   - Bridging fee: ${bridgeAmount.costs.bridgingFee}
   - Slippage: ${bridgeAmount.slippageBps}
   - Recipient: ${bridge.tradeParameters.receiver}
`);

  const sellAmountFormatted = ethers.utils.formatUnits(
    sellAmount,
    sellTokenDecimals
  );

  const minReceiveBuyToken = ethers.utils.formatUnits(
    bridgeAmount.afterSlippage.buyAmount,
    buyTokenDecimals
  );

  const confirmed = await confirm(
    `Sell ${sellAmountFormatted} USDC (Arbitrum) for receive at least ${minReceiveBuyToken} WETH (Base). ok?`
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
  console.log("🔗 Across link: <URL>");
  // TODO: Implement

  // Wait for the bridging to be completed
  console.log("🕣 Waiting for the bridging to be completed...");
  // TODO: Implement

  console.log(`🎉 The WETH is now waiting for you in Base`);
}
