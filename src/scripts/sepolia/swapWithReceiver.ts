import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getWallet } from "../../utils";

const RECEIVER_ADDRESS = "0x79063d9173C09887d536924E2F6eADbaBAc099f5";

export async function run() {
  const wallet = await getWallet(SupportedChainId.SEPOLIA);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log(`Swap and send to receiver: ${RECEIVER_ADDRESS}`);
  const parameters: TradeParameters = {
    kind: OrderKind.BUY, // Buy
    amount: ethers.utils.parseUnits("100", 18).toString(), // 100 COW
    sellToken: WETH_ADDRESS, // With WETH
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS,
    buyTokenDecimals: 18,
    receiver: RECEIVER_ADDRESS, // Receiver
  };

  // Post the order
  const orderId = await sdk.postSwapOrder(parameters);

  console.log(
    `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
  );
}