import { run as approveToken } from "./TradeSDK/sepolia/approveToken";
import dotenv from "dotenv";
import { run as swapWithPk } from "./TradeSDK/sepolia/swapWithPk";
import { run as swapBuy } from "./TradeSDK/sepolia/swapBuy";
import { run as swapSell } from "./TradeSDK/sepolia/swapSell";
import { run as swapWithReceiver } from "./TradeSDK/sepolia/swapWithReceiver";
import { run as swapPartialFill } from "./TradeSDK/sepolia/swapPartialFill";
import { run as swapWithPartnerFee } from "./TradeSDK/sepolia/swapWithPartnerFee";
import { run as swapInBarn } from "./TradeSDK/sepolia/swapInBarn";
import { run as getQuoteAndPostOrder } from "./TradeSDK/sepolia/getQuoteAndPostOrder";
import { run as swapSellWithValidFor } from "./TradeSDK/sepolia/swapSellWithValidFor";
import { run as getQuoteAndPreSign } from "./TradeSDK/sepolia/getQuoteAndPreSign";
import { run as preSign } from "./TradeSDK/sepolia/presign";
import { run as limitSell } from "./TradeSDK/sepolia/limitSell";
import { run as swapSellNative } from "./TradeSDK/sepolia/swapSellNative";
import { run as nativeSell } from "./TradeSDK/sepolia/nativeSell";
import { run as swapWithAppData } from "./TradeSDK/sepolia/swapWithAppData";
import { run as swapAndBridgeUsingOmnibridge } from "./TradeSDK/mainnet/swapAndBridgeUsingOmnibridge";
dotenv.config();

// Just to dev things easily using watch-mode  :)
const JOBS: (() => Promise<unknown>)[] = [
  // approveToken, // Required to approve the token before trading
  // getQuoteAndPostOrder, // Simplest way to integrate!
  //
  // swapWithPk, // FIXME: Doesn't work passing just the PK
  // swapSell, // FIXME: Wrong sell amount (increases by the fee)
  // swapBuy, // FIXME: I suspect the math is wrong as it was not matching exactly CoW Swap UI
  // swapSell, // FIXME: Wrong sell amount (increases by the fee)
  // swapSellNative, // FIXME: The documentation says that it handle automatically the eth flow, however what it does it to place aa WETH order (that is not what I instructed in the params)
  // tradeWithRecipient,
  // swapPartialFill,
  // swapWithReceiver,
  // swapWithPartnerFee, // FIXME: It doesn't work
  // swapInBarn, // FIXME: It doesn't work
  // swapSellWithValidFor, // TODO: Why we can only place order to execute in max 3 hours? Is there a backend limit?
  // swapWithAppData,
  //
  // getQuoteAndPreSign,
  // preSign, // FIXME: It creates an EIP-712 signature, not a pre-sign
  //
  // limitSell,
  //
  // nativeSell, // FIXME: Throws error creating the eth flow order. Doesn't recognize 'gas' property - I believe expects 'gasLimit')
  //
  swapAndBridgeUsingOmnibridge,
];

async function main() {
  if (!JOBS.length) {
    console.log("🤷‍♀️ No jobs to run");
    return;
  }

  for (const job of JOBS) {
    await job();
  }

  console.log("👌 All jobs done\n\n");
}

main().catch(console.error);
