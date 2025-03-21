import { SigningScheme } from "@cowprotocol/contracts";

import { mainnet, APP_CODE } from "../../const";
const { DAI_ADDRESS, USDC_ADDRESS } = mainnet;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";

import { MetadataApi } from "@cowprotocol/app-data";
import { confirm, getWallet, jsonReplacer } from "../../utils";
import { bridgeWithXdaiBridge } from "../../contracts/xDaiBridge";
import { createCowShedTx } from "../../contracts/cowShed";

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
    "Buy 1 DAI using USDC and bridge to Gnosis Chain using xDAI Bridge"
  );

  // Get raw transaction to bridge all available DAI from cow-shed using xDAI Bridge
  const bridgeWithXdaiBridgeTx = await bridgeWithXdaiBridge({
    owner: wallet.address,
    chainId,
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
    call: bridgeWithXdaiBridgeTx,
    chainId,
    wallet,
  });

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
            dappId: "bridge-to-xdai-script",
          },
        ],
      },
    },
  });

  console.log(
    "🕣 Getting quote...",
    JSON.stringify(parameters, jsonReplacer, 2)
  );

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
