import { sepolia, APP_CODE, mainnet } from "../../const";
const { USDC_ADDRESS, COW_ADDRESS } = mainnet;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { confirm, getWallet, jsonReplacer, printQuote } from "../../utils";

const PARTNER_FEE_ADDRESS = "0x79063d9173C09887d536924E2F6eADbaBAc099f5";

export async function run() {
  const wallet = await getWallet(SupportedChainId.MAINNET);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.MAINNET,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  const sellTokenDecimals = 6;
  const buyTokenDecimals = 18;

  // Define trade parameters
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("30", sellTokenDecimals).toString(), // 0.1 WETH
    sellToken: USDC_ADDRESS,
    sellTokenDecimals: sellTokenDecimals,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: buyTokenDecimals,

    // Optionally add a partner fee and a recipient
    partnerFee: {
      bps: 100,
      recipient: PARTNER_FEE_ADDRESS,
    },

    // slippageBps: 60,
  };

  // Post the order
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    parameters
  );

  printQuote(quoteResults);
  const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;

  const confirmed = await confirm(
    `You will get at least ${buyAmount} COW. ok?`
  );
  if (confirmed) {
    const { orderId } = await postSwapOrderFromQuote();

    console.log(
      `Order created, id: https://explorer.cow.fi/orders/${orderId}?tab=overview`
    );
  }
}
