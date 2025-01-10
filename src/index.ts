import { run as approveToken } from "./TradeSDK/approveToken";
import dotenv from "dotenv";
import { run as tradeWithPk } from "./TradeSDK/swapWithPk";
import { run as swapBuy } from "./TradeSDK/swapBuy";
import { run as swapSell } from "./TradeSDK/swapSell";
import { run as swapWithReceiver } from "./TradeSDK/swapWithReceiver";
import { run as swapPartialFill } from "./TradeSDK/swapPartialFill";
import { run as swapWithPartnerFee } from "./TradeSDK/swapWithPartnerFee";

dotenv.config();

// Just to dev things easily using watch-mode  :)
const JOBS: (() => Promise<unknown>)[] = [
  // approveToken,
  // tradeWithPk, // TODO: Doesn't work passing just the PK
  // swapSell,
  // swapBuy,
  // tradeWithRecipient,
  // swapPartialFill,
  // swapWithReceiver,
  swapWithPartnerFee,
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
