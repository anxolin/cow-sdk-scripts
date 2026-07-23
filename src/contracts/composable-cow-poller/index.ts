import { ethers } from "ethers";

/**
 * Minimal ABI for the `ComposableCowPoller` contract.
 *
 * It enables just-in-time funding for composable conditional orders: instead of
 * locking the whole notional up front, `pollFunds` pulls exactly the current discrete
 * order's `sellAmount` from a funder into the order owner, immediately before that
 * order settles.
 *
 * @see https://github.com/cowprotocol/composable-cow/pull/116
 */
const COMPOSABLE_COW_POLLER_ABI = [
  "function composableCow() external view returns (address)",
  "function scheduleId(address funder, address handler, address owner, bytes32 salt) external pure returns (bytes32)",
  "function register((address handler, address funder, address owner, bytes32 salt, bytes staticInput) schedule) external returns (bytes32 id)",
  "function revoke(bytes32 id) external",
  "function pollFunds(bytes32 id) external",
  "function schedules(bytes32 id) external view returns (address handler, address funder, address owner, bytes32 salt, bytes staticInput)",
  "function lastFunded(bytes32 id) external view returns (bytes32)",
] as const;

export interface PollerSchedule {
  /** The conditional-order handler to poll (e.g. the TWAP type). */
  handler: string;
  /** Source of funds (the EOA in the TWAP-for-EOA flow); the only registrant. */
  funder: string;
  /** Order owner (cow-shed / Safe); the fixed pull destination. */
  owner: string;
  /** The conditional order's `salt`; lets the poller rebuild `ctx` on-chain. */
  salt: string;
  /** The order's `staticInput`, passed verbatim to `getTradeableOrder`. */
  staticInput: string;
}

export function getComposableCowPollerContract(
  pollerAddress: string,
  signer?: ethers.Signer | ethers.providers.Provider
): ethers.Contract {
  return new ethers.Contract(pollerAddress, COMPOSABLE_COW_POLLER_ABI, signer);
}
