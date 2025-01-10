import { APP_CODE, COW_ADDRESS, WETH_ADDRESS } from "../const";
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { confirm, getPk, jsonReplacer } from "../common/utils";

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
  console.log("Swap Sell 0.1 WETH for COW (0.5% slippage)");
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
    slippageBps: 50,

    // Optionally add a partner fee and a recipient
    partnerFee: {
      bps: 100,
      recipient: PARTNER_FEE_ADDRESS,
    },
  };

  // Post the order
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    parameters
  );

  console.log(
    "\n🤝 Quote: ",
    JSON.stringify(quoteResults.quoteResponse, jsonReplacer, 2)
  );
  console.log(
    "\n💰 Amounts and costs: ",
    JSON.stringify(quoteResults.amountsAndCosts, jsonReplacer, 2)
  );
  console.log(
    "\n💿 App Data: ",
    JSON.stringify(quoteResults.appDataInfo, jsonReplacer, 2)
  );

  console.log(
    "\n✍️ Order to sign: ",
    JSON.stringify(quoteResults.orderToSign, jsonReplacer, 2)
  );

  console.log(
    "\n📝 Order Typed Data: ",
    JSON.stringify(quoteResults.orderTypedData, jsonReplacer, 2)
  );

  const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;

  const confirmed = await confirm(`You will get at least: ${buyAmount}, ok?`);
  if (confirmed) {
    const orderId = await postSwapOrderFromQuote();

    console.log(
      `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
    );
  }
}
