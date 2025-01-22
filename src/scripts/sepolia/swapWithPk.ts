import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { getPk } from "../../utils";
import { ethers } from "ethers";

export async function run() {
  // Get the private key
  const privateKey = getPk();

  // Initialize the SDK
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: privateKey, // Use the private key directly
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log("Swap using PK");
  const parameters: TradeParameters = {
    kind: OrderKind.BUY, // Buy
    amount: ethers.utils.parseUnits("100", 18).toString(), // 100 COW
    sellToken: WETH_ADDRESS, // With WETH
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS,
    buyTokenDecimals: 18,
    slippageBps: 50,
  };

  // Post the order
  const orderId = await sdk.postSwapOrder(parameters);

  console.log(
    `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
  );
}
