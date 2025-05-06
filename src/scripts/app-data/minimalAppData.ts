import { MetadataApi, stringifyDeterministic } from "@cowprotocol/app-data";

export async function run() {
  const metadataApi = new MetadataApi();

  const appDataSchema = await metadataApi.generateAppDataDoc({
    appCode: "CoW SDK scripts",
    environment: "prod",
    metadata: {
      // Optional: Add your metadata here
    },
  });

  const { appDataContent, appDataHex, cid } = await metadataApi.getAppDataInfo(
    appDataSchema
  );

  console.log("App-data content (full app-data string): ", appDataContent);
  console.log(
    "App-data hex (app-data hex part of the order struct): ",
    appDataHex
  );
  console.log("App-data cid (IPFS identifier): ", cid);
}
