import { gnosis, APP_CODE } from "../../const";
const { WXDAI_ADDRESS, GNO_ADDRESS } = gnosis;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { MetadataApi } from "@cowprotocol/sdk-app-data";
import { ethers } from "ethers";
import { getWallet, jsonReplacer } from "../../utils";

/**
 * Post an order on Gnosis Chain with CoW Protocol hooks carried in the order's `appData`,
 * so we can inspect end-to-end how the real backend/solvers convey and treat hooks.
 *
 * Why this script exists
 * ----------------------
 * We're validating an assumption for an "enforceable hooks" wrapper (cow-shed): that the
 * pre/post interactions and any wrapper routing for an order travel in `appData`, and how the
 * backend serves that to solvers.
 *
 * What the SDK supports (verified 2026-07)
 * ----------------------------------------
 * `@cowprotocol/sdk-app-data` (3.0.0-rc.1, schema up to v1.3.0) exposes standard **CoW hooks**
 * (`metadata.hooks.pre` / `.post`, each a `{ target, callData, gasLimit }`). Neither app-data nor
 * `@cowprotocol/cow-sdk` (checked 6.0.0-RC.42 and 9.2.2) exposes a "wrapper" / Atomic-Bundles field
 * or a `wrappedSettle` helper, so we cannot route an order through a settlement wrapper from here.
 * This script therefore probes the *hooks-in-appData* path — the closest existing mechanism —
 * and prints the full appData document + hash so we can inspect exactly what the backend stores
 * and serves. Extend `HOOKS` below (or add wrapper routing) once the SDK/app-data schema exposes it.
 *
 * Env required: PRIVATE_KEY, RPC_URL_100.
 */

// --- tweak me -------------------------------------------------------------
const SELL_TOKEN = WXDAI_ADDRESS;
const BUY_TOKEN = GNO_ADDRESS;
const SELL_AMOUNT = ethers.utils.parseUnits("1", 18).toString(); // 1 WXDAI

// A benign no-op post-hook purely to exercise the hooks-in-appData path. Calling address(0)
// with empty calldata is a harmless no-op a solver can execute. Replace with a real interaction
// (e.g. a call routed through your cow-shed) once we test meaningful hooks.
const HOOKS = {
  pre: [] as { target: string; callData: string; gasLimit: string }[],
  post: [
    {
      target: "0x0000000000000000000000000000000000000000",
      callData: "0x",
      gasLimit: "50000",
    },
  ],
};
// -------------------------------------------------------------------------

export async function run() {
  const chainId = SupportedChainId.GNOSIS_CHAIN;
  const wallet = await getWallet(chainId);

  const sdk = new TradingSdk({
    chainId,
    signer: wallet,
    appCode: APP_CODE,
  });

  const parameters: TradeParameters = {
    kind: OrderKind.SELL,
    amount: SELL_AMOUNT,
    sellToken: SELL_TOKEN,
    sellTokenDecimals: 18,
    buyToken: BUY_TOKEN,
    buyTokenDecimals: 18,
  };

  const metadataApi = new MetadataApi();
  const appData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      hooks: HOOKS,
    },
  });

  // NOTE: `as any` bridges dual-package app-data type drift in this SDK RC (the standalone
  // `@cowprotocol/sdk-app-data` schema vs the copy bundled inside `@cowprotocol/cow-sdk`). The
  // runtime JSON is identical.
  // Inspect exactly what will be committed on-chain (hash) and served off-chain (full doc).
  const { appDataContent, appDataHex } = await metadataApi.getAppDataInfo(
    appData as any,
  );
  console.log("📦 appData doc:", JSON.stringify(appData, jsonReplacer, 2));
  console.log("🧾 appData content (served to solvers):", appDataContent);
  console.log("#️⃣  appData hash (committed in the order):", appDataHex);

  console.log(`\nPosting order on Gnosis (owner=${wallet.address})...`);
  const orderId = await sdk.postSwapOrder(parameters, {
    appData: appData as any,
  });

  console.log(
    `✅ Order created: https://explorer.cow.fi/gc/orders/${orderId}?tab=overview`,
  );
}
