import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS } = sepolia;

import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getPk } from "../../common/utils";
import { MetadataApi } from "@cowprotocol/app-data";

export async function run() {
  // Set up provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(getPk(), provider);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log(
    "Buy 1 DAI using USDC and bridge to Gnosis Chain using Omnibridge"
  );
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
    slippageBps: 50,
  };

  const metadataApi = new MetadataApi();
  const appData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      hooks: {
        post: [
          {
            callData: "0x",
            gasLimit: "123456",
            target: "0x",
          },
        ],
      },
    },
  });

  // Post the order
  const orderId = await sdk.postSwapOrder(parameters, { appData });

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
