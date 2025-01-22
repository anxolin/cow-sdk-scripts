import dotenv from "dotenv";

import { run as approveTokenSepolia } from "./scripts/sepolia/approveTokenSepolia";

import { run as swapWithPk } from "./scripts/sepolia/swapWithPk";
import { run as swapBuy } from "./scripts/sepolia/swapBuy";
import { run as swapSell } from "./scripts/sepolia/swapSell";
import { run as swapWithReceiver } from "./scripts/sepolia/swapWithReceiver";
import { run as swapPartialFill } from "./scripts/sepolia/swapPartialFill";
import { run as swapWithPartnerFee } from "./scripts/sepolia/swapWithPartnerFee";
import { run as swapInBarn } from "./scripts/sepolia/swapInBarn";
import { run as getQuoteAndPostOrder } from "./scripts/sepolia/getQuoteAndPostOrder";
import { run as swapSellWithValidFor } from "./scripts/sepolia/swapSellWithValidFor";
import { run as getQuoteAndPreSign } from "./scripts/sepolia/getQuoteAndPreSign";
import { run as preSign } from "./scripts/sepolia/presign";
import { run as swapSellNative } from "./scripts/sepolia/swapSellNative";
import { run as limitSell } from "./scripts/sepolia/limitSell";
import { run as nativeSell } from "./scripts/sepolia/nativeSell";
import { run as swapWithAppData } from "./scripts/sepolia/swapWithAppData";
import { run as swapAndBridgeUsingOmnibridge } from "./scripts/mainnet/swapAndBridgeUsingOmnibridge";
import { run as approveTokenMainnet } from "./scripts/mainnet/approveTokenMainnet";
import { run as swapAndBridgeUsingXdaiBridge } from "./scripts/mainnet/swapAndBridgeUsingXdaiBridge";

dotenv.config();

// Just to dev things easily using watch-mode  :)
const JOBS: (() => Promise<unknown>)[] = [
  // approveTokenSepolia, // Required to approve the token before trading
  // getQuoteAndPostOrder, // Simplest way to integrate!
  //
  // swapWithPk,
  // swapSell,
  // swapBuy,
  // swapSell,
  // swapSellNative, // FIXME: The documentation says that it handle automatically the eth flow, however what it does it to place aa WETH order (that is not what I instructed in the params)
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
  // approveTokenMainnet,
  swapAndBridgeUsingOmnibridge,
  // swapAndBridgeUsingXdaiBridge,
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
