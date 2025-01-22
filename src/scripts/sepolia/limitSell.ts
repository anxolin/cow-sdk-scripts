import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
  LimitTradeParameters,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getWallet } from "../../utils";

export async function run() {
  const wallet = await getWallet(SupportedChainId.SEPOLIA);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log("Limit Order: Sell 0.1 WETH for at least 1 wei of COW");
  const parameters: LimitTradeParameters = {
    kind: OrderKind.SELL, // Sell
    sellAmount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    buyAmount: "1", // 1 wei of COW (pure market order)
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
    slippageBps: 50,
  };

  // Post the order
  const orderId = await sdk.postLimitOrder(parameters);

  console.log(
    `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
  );
}
