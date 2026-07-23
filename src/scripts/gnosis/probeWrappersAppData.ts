import axios from "axios";
import { ethers } from "ethers";

/**
 * Step 1 of the "enforceable hooks / wrapper" investigation.
 *
 * The CoW docs (https://docs.cow.fi/cow-protocol/integrate/wrappers) describe conveying a
 * settlement wrapper via a top-level `wrappers` array in the order's `appData`:
 *
 *   appData: { wrappers: [{ target, data, isOmittable }] }
 *
 * BUT that field is NOT in any released `@cowprotocol/app-data` (latest 3.3.1, schema v1.6.0) or
 * `@cowprotocol/cow-sdk` (9.2.2) — the docs are ahead of the published tooling. So the only way to
 * check whether the field is live is to hand-craft the appData JSON and hand it to the orderbook's
 * app-data endpoint, which validates the document server-side.
 *
 * This probe uploads two appData docs to the **Gnosis** orderbook (`PUT /app_data/{hash}`):
 *   1. a control (no `wrappers`) — confirms the endpoint + our hashing work;
 *   2. the same doc WITH a `wrappers` entry.
 * Comparing the two isolates the variable: if the control is accepted and the wrappers doc is
 * rejected, the server schema does not (yet) support `wrappers` on Gnosis. If both are accepted,
 * the field is live server-side even though npm lacks it.
 *
 * No wallet/RPC needed — the app-data endpoint is unauthenticated.
 */

// Gnosis Chain uses the "xdai" path on the CoW API.
const ORDERBOOK = "https://api.cow.fi/xdai/api/v1";
const APP_CODE = "cow-sdk-scripts";

// Placeholder wrapper target (the reference CoWSafeWrapper address); our own wrapper isn't
// deployed/allowlisted yet. We're only testing appData acceptance here, not settlement.
const WRAPPER_TARGET = "0x531636e6e18F3A52c283aCCda39D7185E4597A37";

// CoW's appData hash is keccak256 over the exact UTF-8 bytes of the full appData string, and the
// endpoint recomputes it from the body we send, so any consistent string works for this probe.
function appDataHash(fullAppData: string): string {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(fullAppData));
}

async function upload(label: string, doc: unknown) {
  const fullAppData = JSON.stringify(doc);
  const hash = appDataHash(fullAppData);
  console.log(`\n=== ${label} ===`);
  console.log("fullAppData:", fullAppData);
  console.log("hash:", hash);
  try {
    const res = await axios.put(`${ORDERBOOK}/app_data/${hash}`, { fullAppData });
    console.log(`✅ ACCEPTED (${res.status})`, JSON.stringify(res.data));
  } catch (e: any) {
    console.log(
      `❌ REJECTED (${e.response?.status})`,
      JSON.stringify(e.response?.data ?? e.message)
    );
  }
}

export async function run() {
  // 1) control: a plain, schema-valid appData doc (no wrappers)
  await upload("control (no wrappers)", {
    appCode: APP_CODE,
    metadata: {},
    version: "1.6.0",
  });

  // 2) the same doc WITH a root-level `wrappers` entry (as the docs describe)
  await upload("with wrappers (root-level)", {
    appCode: APP_CODE,
    metadata: {},
    version: "1.6.0",
    wrappers: [{ target: WRAPPER_TARGET, data: "0x", isOmittable: false }],
  });
}
