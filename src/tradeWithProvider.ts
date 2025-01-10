import dotenv from "dotenv";
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getPk } from "./common";

export async function run() {
  // Set up provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(getPk(), provider);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet,
    appCode: "swap-n-bridge",
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
