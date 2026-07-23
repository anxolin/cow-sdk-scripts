import { MetadataApi } from "@cowprotocol/cow-sdk";
import axios from "axios";

/**
 * Step 1 of the "enforceable hooks / wrapper" investigation.
 *
 * CoW conveys a settlement wrapper via `appData.metadata.wrappers` — an array of
 * `{ address, data?, is_omittable? }`. (The docs example `appData: { wrappers: [...] }` with
 * `target`/`isOmittable` is out of date; the real schema puts it under `metadata` and uses
 * `address` + `is_omittable`.)
 *
 * The field is NOT in the deprecated `@cowprotocol/sdk-app-data`, which is why it looked missing — it
 * lives in `@cowprotocol/sdk-app-data` (5.3.1, schema v1.15.0, `LATEST_WRAPPERS_METADATA_VERSION`),
 * re-exported by `@cowprotocol/cow-sdk` 9.2.2 as `MetadataApi`.
 *
 * This probe builds the appData doc with the real (typed) builder and uploads it to the **Gnosis**
 * orderbook app-data endpoint (`PUT /app_data/{hash}`), plus a control without wrappers. Comparing
 * the two shows whether the live Gnosis orderbook accepts `metadata.wrappers`. No wallet/RPC needed.
 */

// Gnosis Chain uses the "xdai" path on the CoW API.
const ORDERBOOK = "https://api.cow.fi/xdai/api/v1";
const APP_CODE = "cow-sdk-scripts";

// Placeholder wrapper address (the reference CoWSafeWrapper); our own wrapper isn't
// deployed/allowlisted yet. We're only testing appData acceptance here, not settlement.
const WRAPPER_ADDRESS = "0x531636e6e18F3A52c283aCCda39D7185E4597A37";

const metadataApi = new MetadataApi();

async function upload(
  label: string,
  doc: Parameters<typeof metadataApi.getAppDataInfo>[0],
) {
  const { appDataContent, appDataHex } = await metadataApi.getAppDataInfo(doc);
  console.log(`\n=== ${label} ===`);
  console.log("appDataContent:", appDataContent);
  console.log("appDataHex:", appDataHex);
  try {
    const res = await axios.put(`${ORDERBOOK}/app_data/${appDataHex}`, {
      fullAppData: appDataContent,
    });
    console.log(`✅ ACCEPTED (${res.status})`, JSON.stringify(res.data));
  } catch (e: any) {
    console.log(
      `❌ REJECTED (${e.response?.status})`,
      JSON.stringify(e.response?.data ?? e.message),
    );
  }
}

export async function run() {
  // 1) control: a plain, schema-valid appData doc (no wrappers)
  const control = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {},
  });
  await upload("control (no wrappers)", control);

  // 2) the same doc WITH metadata.wrappers
  const withWrappers = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      wrappers: [{ address: WRAPPER_ADDRESS, data: "0x", is_omittable: false }],
    },
  });
  await upload("with metadata.wrappers", withWrappers);
}
