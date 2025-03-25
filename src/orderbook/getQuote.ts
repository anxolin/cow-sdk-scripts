import {
  OrderBookApi,
  OrderQuoteSideKindSell,
  PriceQuality,
  SigningScheme,
  SupportedChainId,
} from "@cowprotocol/cow-sdk";

export async function run() {
  const orderBookApi = new OrderBookApi({
    chainId: SupportedChainId.ARBITRUM_ONE,
  });

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
  });

  console.log("quote result", quote);
}
