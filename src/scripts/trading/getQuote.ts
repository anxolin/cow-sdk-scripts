import { base, arbitrum, APP_CODE } from "../../const";

import { SupportedChainId, OrderKind, TradingSdk } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";

import { getWallet, jsonReplacer } from "../../utils";

export async function run() {
  // Get wallet
  const sellTokenChainId = SupportedChainId.ARBITRUM_ONE;
  const wallet = await getWallet(sellTokenChainId);
  const sellTokenDecimals = 6;

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({ signer: wallet, appCode: APP_CODE });
  const quote = await sdk.getQuote({
    kind: OrderKind.SELL,
    chainId: sellTokenChainId,
    sellToken: arbitrum.USDC_ADDRESS,
    sellTokenDecimals: 6,
    buyToken: arbitrum.USDT_ADDRESS,
    buyTokenDecimals: 6,
    receiver: wallet.address,
    amount: ethers.utils.parseUnits("5", sellTokenDecimals).toString(),
    validFor: 1800,
  });

  console.log(`🎉 quote`, JSON.stringify(quote, jsonReplacer, 2));
}
