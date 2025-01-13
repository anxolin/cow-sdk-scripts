import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getPk } from "../../common/utils";

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
  console.log("Swap Buy 100 COW with WETH (0.5% slippage)");
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
