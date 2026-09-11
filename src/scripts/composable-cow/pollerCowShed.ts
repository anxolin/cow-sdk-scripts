import {
  COW_SHED_2_1_0_VERSION,
  CowShedSdk,
} from "@cowprotocol/sdk-cow-shed";
import { AbstractProviderAdapter } from "@cowprotocol/sdk-common";

// COWShedForComposableCoW deployment used by ComposableCowPoller on Gnosis Chain.
// See composable-cow/networks.json at d4e49601a1a8c130b2b28dd3a97fb187d3555ba6.
export const COW_SHED_FACTORY_ADDRESS =
  "0x5E284e80F3bd6A7D80A8500D9c49878028110848";
export const COW_SHED_IMPLEMENTATION_ADDRESS =
  "0xF0D400089d5b9fACA64E3422AD6614546587cfFB";

const COW_SHED_FACTORY_OPTIONS = {
  factoryAddress: COW_SHED_FACTORY_ADDRESS,
  implementationAddress: COW_SHED_IMPLEMENTATION_ADDRESS,
} as const;

export function getPollerCowShedSdk(
  adapter: AbstractProviderAdapter,
): CowShedSdk {
  return new CowShedSdk(
    adapter,
    COW_SHED_FACTORY_OPTIONS,
    COW_SHED_2_1_0_VERSION,
  );
}
