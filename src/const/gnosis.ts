export const GNO_ADDRESS = "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb";

// ComposableCowPoller: just-in-time funding for composable conditional orders.
// `id`-keyed deployment (schedule key is independent of the order's appData, so
// `pollFunds(id)` can be embedded as a pre-hook in the order's own appData).
// This build also accepts registrations from the funder's cow-shed, which is what
// removes the separate Register signature.
// Unreviewed dev deployment: expect it to move when composable-cow#145 lands.
// See https://github.com/cowprotocol/composable-cow/pull/145
export const COMPOSABLE_COW_POLLER_ADDRESS =
  "0x34613B4c104F434FC25fc31ffBD72c4C7C1CCA47";
