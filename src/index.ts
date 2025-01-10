import { run as approveToken } from "./TradeSDK/approveToken";
import dotenv from "dotenv";
import { run as swapWithPk } from "./TradeSDK/swapWithPk";
import { run as swapBuy } from "./TradeSDK/swapBuy";
import { run as swapSell } from "./TradeSDK/swapSell";
import { run as swapWithReceiver } from "./TradeSDK/swapWithReceiver";
import { run as swapPartialFill } from "./TradeSDK/swapPartialFill";
import { run as swapWithPartnerFee } from "./TradeSDK/swapWithPartnerFee";
import { run as swapInBarn } from "./TradeSDK/swapInBarn";
import { run as getQuoteAndPostOrder } from "./TradeSDK/getQuoteAndPostOrder";
import { run as swapSellWithValidFor } from "./TradeSDK/swapSellWithValidFor";
import { run as getQuoteAndPreSign } from "./TradeSDK/getQuoteAndPreSign";
import { run as preSign } from "./TradeSDK/preSign";

dotenv.config();

// Just to dev things easily using watch-mode  :)
const JOBS: (() => Promise<unknown>)[] = [
  // approveToken, // Required to approve the token before trading
  // getQuoteAndPostOrder, // Simplest way to integrate!
  //
  // swap
  // swapWithPk, // FIXME: Doesn't work passing just the PK
  // swapSell,
  // swapBuy,
  // tradeWithRecipient,
  // swapPartialFill,
  // swapWithReceiver,
  // swapWithPartnerFee, // FIXME: It doesn't work
  // swapInBarn, // FIXME: It doesn't work
  // swapSellWithValidFor, // TODO: Why we can only place order to execute in max 3 hours? Is there a backend limit?
  //
  // getQuoteAndPreSign,
  // preSign, // FIXME: It creates an EIP-712 signature, not a pre-sign
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
