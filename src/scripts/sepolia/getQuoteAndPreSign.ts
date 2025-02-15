import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
  SwapAdvancedSettings,
  SigningScheme,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { confirm, getWallet } from "../../utils";

export async function run() {
  const wallet = await getWallet(SupportedChainId.SEPOLIA);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log("Presign");
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
  };

  const advancedParameters: SwapAdvancedSettings = {
    quoteRequest: {
      // Specify the signing scheme
      signingScheme: SigningScheme.PRESIGN,
    },
  };

  // Post the order
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    parameters,
    advancedParameters
  );

  const buyAmount = quoteResults.amountsAndCosts.afterSlippage.buyAmount;
  const confirmed = await confirm(
    `You will get at least ${buyAmount} COW, ok?`
  );
  if (confirmed) {
    const orderId = await postSwapOrderFromQuote();

    console.log(
      `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
    );
  }
}
