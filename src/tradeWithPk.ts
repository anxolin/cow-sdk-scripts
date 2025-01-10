import dotenv from "dotenv";
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { getPk } from "./common";

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error("PRIVATE_KEY is not set");
}

export async function run() {
  // Initialize the SDK
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: getPk(),
    appCode: "AnxSwap",
  });

  // Define trade parameters
  //  Buy 0.12 COW with ETH
  const parameters: TradeParameters = {
    kind: OrderKind.BUY,
    sellToken: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", // WETH
    sellTokenDecimals: 18,
    buyToken: "0x0625afb445c3b6b7b929342a04a22599fd5dbb59", // COW
    buyTokenDecimals: 18,
    amount: "120000000000000000",
  };

  // Post the order
  const orderId = await sdk.postSwapOrder(parameters);

  console.log("Order created, id: ", orderId);
}
