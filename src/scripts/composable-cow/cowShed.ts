import {
  COW_SHED_2_1_0_VERSION,
  CowShedSdk,
} from "@cowprotocol/sdk-cow-shed";
import { AbstractProviderAdapter } from "@cowprotocol/sdk-common";

// Factory options for the COWShedForComposableCoW deployment on Gnosis Chain.
// This is the factory pinned by the current ComposableCowPoller deployment.
const COW_SHED_FACTORY_OPTIONS = {
  factoryAddress: "0x5E284e80F3bd6A7D80A8500D9c49878028110848",
  implementationAddress: "0xF0D400089d5b9fACA64E3422AD6614546587cfFB",
} as const;

/**
 * Build a `CowShedSdk` configured for the COWShedForComposableCoW deployment,
 * which is the cow-shed flavour with support for Composable CoW.
 */
export function getCowShedSdk(adapter: AbstractProviderAdapter): CowShedSdk {
  return new CowShedSdk(
    adapter,
    COW_SHED_FACTORY_OPTIONS,
    COW_SHED_2_1_0_VERSION,
  );
}
