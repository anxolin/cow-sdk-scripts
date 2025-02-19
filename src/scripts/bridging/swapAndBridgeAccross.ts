import { base, arbitrum, APP_CODE } from "../../const";

import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";

import { MetadataApi } from "@cowprotocol/app-data";
import { confirm, getWallet, jsonReplacer } from "../../utils";
import { createCowShedTx } from "../../contracts/cowShed";
import {
  bridgeWithAcross,
  getIntermediateTokenFromTargetToken,
} from "../../contracts/across";
import { getErc20Contract } from "../../contracts/erc20";

export async function run() {
  const sourceChain = SupportedChainId.ARBITRUM_ONE;
  const targetChain = SupportedChainId.BASE;
  const sellToken = arbitrum.USDC_ADDRESS;
  const sellTokenDecimals = 6;
  const sellAmount = ethers.utils.parseUnits("5", sellTokenDecimals).toString();
  const buyToken = base.WETH_ADDRESS;
  const buyTokenDecimals = 18;

  const wallet = await getWallet(sourceChain);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: sourceChain,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Get the intermediary token
  const intermediaryToken = getIntermediateTokenFromTargetToken({
    sourceChain,
    targetChain,
    targetToken: buyToken,
  });

  if (!intermediaryToken) {
    throw new Error("No intermediary token found");
  }

  // Get intermediate token decimals
  const intermediateTokenContract = getErc20Contract(intermediaryToken, wallet);
  const intermediateTokenDecimals = await intermediateTokenContract.decimals();
  const intermediateTokenSymbol = await intermediateTokenContract.symbol();

  // Estimate how many intermediate tokens we can bridge
  // TODO: Ideally, this would not be needed, as we should bridge all intermediate tokens!
  let quote = await sdk.getQuote({
    kind: OrderKind.SELL,
    sellToken,
    sellTokenDecimals,
    buyToken: intermediaryToken,
    buyTokenDecimals,
    receiver: wallet.address,
    amount: sellAmount,
  });
  const intermediateTokenAmount =
    quote.quoteResults.amountsAndCosts.afterSlippage.buyAmount;

  console.log("quote", JSON.stringify(quote, jsonReplacer, 2));

  // Get raw transaction to bridge all available DAI from cow-shed using xDAI Bridge
  const bridgeWithXdaiBridgeTx = await bridgeWithAcross({
    owner: wallet.address,
    bridgeAllFromSwap: true,
    sourceChain: sourceChain,
    sourceToken: intermediaryToken,
    sourceTokenAmount: intermediateTokenAmount,
    targetChain: targetChain,
    targetToken: buyToken,
    recipient: wallet.address,
  });

  console.log(
    "\n💰 Bridge tx:",
    JSON.stringify(bridgeWithXdaiBridgeTx, jsonReplacer, 2)
  );

  // Sign and encode the transaction
  const {
    cowShedAccount,
    preAuthenticatedTx: authenticatedBridgeTx,
    gasLimit,
  } = await createCowShedTx({
    tx: bridgeWithXdaiBridgeTx,
    chainId: sourceChain,
    wallet,
  });

  // Define trade parameters. Sell sell token for intermediary token, to be received by cow-shed
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: sellAmount,
    sellToken,
    sellTokenDecimals: sellTokenDecimals,
    buyToken: intermediaryToken,
    buyTokenDecimals: intermediateTokenDecimals,
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
            dappId: "bridge-accross",
          },
        ],
      },
    },
  });

  console.log(
    "🕣 Getting quote...",
    JSON.stringify(parameters, jsonReplacer, 2)
  );

  quote = await sdk.getQuote(parameters, { appData });
  const { postSwapOrderFromQuote, quoteResults } = quote;

  const minIntermediateTokenAmount =
    quoteResults.amountsAndCosts.afterSlippage.buyAmount;
  const minIntermediateTokenAmountFormatted = ethers.utils.formatUnits(
    minIntermediateTokenAmount,
    intermediateTokenDecimals
  );
  const sellAmountFormatted = ethers.utils.formatUnits(
    sellAmount,
    sellTokenDecimals
  );

  console.log(
    `You will sell ${sellAmountFormatted} USDC and receive at least ${minIntermediateTokenAmountFormatted} ${intermediateTokenSymbol} (intermediate token). Then, it will be bridged to Base for WETH.`
  );

  const confirmed = await confirm(
    `You will bridge at least ${minIntermediateTokenAmountFormatted} ${intermediateTokenSymbol}. ok?`
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
