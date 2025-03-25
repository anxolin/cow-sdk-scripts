import {
  OrderBookApi,
  OrderQuoteSideKindSell,
  PriceQuality,
  SigningScheme,
  SupportedChainId,
  buildAppData,
  generateAppDataFromDoc,
} from "@cowprotocol/cow-sdk";
import { APP_CODE } from "../const";

export async function run() {
  const orderBookApi = new OrderBookApi({
    chainId: SupportedChainId.ARBITRUM_ONE,
  });

  const kind = OrderQuoteSideKindSell.SELL;

  // const appData = await buildAppData({
  //   appCode: APP_CODE,
  //   orderClass: "market",
  //   slippageBps: 100,
  //   partnerFee: {
  //     bps: 50,
  //     recipient: "0x016f34D4f2578c3e9DFfC3f2b811Ba30c0c9e7f3",
  //   },
  // });

  const quote = await orderBookApi.getQuote({
    kind: OrderQuoteSideKindSell.SELL,
    from: "0x016f34D4f2578c3e9DFfC3f2b811Ba30c0c9e7f3",
    sellToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    buyToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    receiver: "0x016f34D4f2578c3e9DFfC3f2b811Ba30c0c9e7f3",
    validFor: 1800,
    priceQuality: PriceQuality.OPTIMAL,
    signingScheme: SigningScheme.EIP712,
    sellAmountBeforeFee: "5000000",
    appData:
      '{"appCode":"swap-n-bridge","metadata":{"hooks":{"post":[{"callData":"0x00","gasLimit":"110000","target":"0x0000000000000000000000000000000000000000"}]}},"version":"1.3.0"}',
    appDataHash:
      "0xc23b1518b9946714c0d396392a308bbbc5cf3a19a0bcace01ef9a8d222ca5f95",
  });

  console.log("quote result", quote);
}
