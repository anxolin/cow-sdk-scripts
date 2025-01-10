import { APP_CODE, COW_ADDRESS, WETH_ADDRESS } from "../const";
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getPk } from "../common/utils";

const PARTNER_FEE_ADDRESS = "0x79063d9173C09887d536924E2F6eADbaBAc099f5";

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
    `Swap with 1% partner fee, to be received by ${PARTNER_FEE_ADDRESS}`
  );
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
    slippageBps: 50,

    // FIXME: It doesn't work. Partner fee is not added to the appData
    partnerFee: {
      bps: 100, // 100 BPS (1%) partner fee
      recipient: PARTNER_FEE_ADDRESS, // Partner fee recipient
    },
  };

  // Post the order
  const orderId = await sdk.postSwapOrder(parameters);

  console.log(
    `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
  );
}
