import { ethers } from "ethers";

/**
 * Minimal ABI for the `ComposableCowPoller` contract.
 *
 * It enables just-in-time funding for composable conditional orders: instead of locking
 * the whole notional up front, `pollFunds` pulls exactly the current discrete order's
 * `sellAmount` from the funder into the order owner, immediately before that order
 * settles.
 *
 * Kept as a local helper rather than using `ComposableCowPoller` from
 * `@cowprotocol/sdk-composable`: the published package (1.1.2) does not export it, and
 * the unpublished version on cow-sdk#959/#960 targets the earlier nonce-based Poller, so
 * its typed data, its `nonces()` read and its revoke encoders no longer match the
 * contract. The shed-authorized paths below need no typed data at all.
 *
 * @see https://github.com/cowprotocol/composable-cow/pull/145
 */
const COMPOSABLE_COW_POLLER_ABI = [
  "function COMPOSABLE_COW() external view returns (address)",
  "function COW_SHED_FACTORY() external view returns (address)",
  "function scheduleId((address handler, address funder, address owner, bytes32 salt, bytes staticInput) schedule) external pure returns (bytes32)",
  "function schedules(bytes32 id) external view returns (address handler, address funder, address owner, bytes32 salt, bytes staticInput)",
  "function register((address handler, address funder, address owner, bytes32 salt, bytes staticInput) schedule) external returns (bytes32 id)",
  "function registerFromShed((address handler, address funder, address owner, bytes32 salt, bytes staticInput) schedule) external returns (bytes32 id)",
  "function revoke(address handler, address owner, bytes32 salt) external returns (bytes32 id)",
  "function revokeFromShed(address handler, address funder, address owner, bytes32 salt) external returns (bytes32 id)",
  "function pollFunds(bytes32 id) external returns (bool)",
] as const;

export const COMPOSABLE_COW_POLLER_INTERFACE = new ethers.utils.Interface(
  COMPOSABLE_COW_POLLER_ABI,
);

/**
 * The identity fields of a schedule. `staticInput` is deliberately excluded: the key must
 * stay independent of the order's appData, so `pollFunds(id)` can be embedded as a
 * pre-hook in that very appData. Uniqueness therefore rests on a fresh random `salt`.
 */
export interface PollerScheduleKey {
  /** The conditional-order handler to poll (e.g. the TWAP type). */
  handler: string;
  /** Source of funds (the EOA in the TWAP-for-EOA flow). */
  funder: string;
  /** Order owner (cow-shed / Safe); the fixed pull destination. */
  owner: string;
  /** The conditional order's `salt`; lets the poller rebuild `ctx` on-chain. */
  salt: string;
}

export interface PollerSchedule extends PollerScheduleKey {
  /** The order's `staticInput`, passed verbatim to `getTradeableOrder`. */
  staticInput: string;
}

export function getComposableCowPollerContract(
  pollerAddress: string,
  signer?: ethers.Signer | ethers.providers.Provider,
): ethers.Contract {
  return new ethers.Contract(
    pollerAddress,
    COMPOSABLE_COW_POLLER_INTERFACE,
    signer,
  );
}

/** Derives the schedule key locally, mirroring `ComposableCowPoller.scheduleId`. */
export function scheduleId(schedule: PollerScheduleKey): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address", "bytes32"],
      [schedule.funder, schedule.handler, schedule.owner, schedule.salt],
    ),
  );
}

/** Calldata for the pre-hook that funds one part just before settlement. */
export function encodePollFunds(id: string): string {
  return COMPOSABLE_COW_POLLER_INTERFACE.encodeFunctionData("pollFunds", [id]);
}

/**
 * Calldata for a cow-shed to register a schedule that spends its owner's tokens.
 *
 * The caller must be `COW_SHED_FACTORY.proxyOf(schedule.funder)` and `schedule.owner`
 * must be that same shed; the poller enforces both. Since a shed only executes calls its
 * owner authorized, this replaces the funder's separate `Register` signature.
 */
export function encodeRegisterFromShed(schedule: PollerSchedule): string {
  return COMPOSABLE_COW_POLLER_INTERFACE.encodeFunctionData(
    "registerFromShed",
    [schedule],
  );
}

/** Calldata for a cow-shed to revoke, or pre-emptively burn, one of its funder's keys. */
export function encodeRevokeFromShed(schedule: PollerScheduleKey): string {
  return COMPOSABLE_COW_POLLER_INTERFACE.encodeFunctionData("revokeFromShed", [
    schedule.handler,
    schedule.funder,
    schedule.owner,
    schedule.salt,
  ]);
}
