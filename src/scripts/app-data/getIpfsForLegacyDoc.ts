import { MetadataApi, stringifyDeterministic } from "@cowprotocol/sdk-app-data";

export async function run() {
  const metadataApi = new MetadataApi();

  const cid = await metadataApi.legacy.appDataHexToCidLegacy(
    "0x46ff6f01739b9d0f95ce957468e01ef617abf89d29abfb673613e4f87ba86e29",
  );
  console.log("Cid: ", cid);
}
