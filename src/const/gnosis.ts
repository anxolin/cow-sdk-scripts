export const GNO_ADDRESS = "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb";

// ComposableCowPoller: just-in-time funding for composable conditional orders.
// `id`-keyed deployment (schedule key is independent of the order's appData, so
// `pollFunds(id)` can be embedded as a pre-hook in the order's own appData).
// See https://github.com/cowprotocol/composable-cow/pull/116
export const COMPOSABLE_COW_POLLER_ADDRESS =
  "0xA360eE11eD0d2025604518CF4B8F6e6CB76C7Df7";
