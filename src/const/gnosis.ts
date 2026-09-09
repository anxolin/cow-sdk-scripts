export const GNO_ADDRESS = "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb";

// ComposableCowPoller: just-in-time funding for composable conditional orders.
// `id`-keyed deployment (schedule key is independent of the order's appData, so
// `pollFunds(id)` can be embedded as a pre-hook in the order's own appData).
// This deployment supports CowShed registration and revocation with auth epochs.
export const COMPOSABLE_COW_POLLER_ADDRESS =
  "0xf1c5e22fb6f4b974ad12ca4bc461f9746f77bb7d";
