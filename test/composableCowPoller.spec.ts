import assert from "node:assert/strict";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import {
  COW_SHED_2_1_0_VERSION,
  COW_SHED_712_TYPES,
} from "@cowprotocol/sdk-cow-shed";
import {
  ComposableCowPoller,
  type ComposableCowPollerSchedule,
} from "@cowprotocol/sdk-composable";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";
import { ethers } from "ethers";

import {
  assertPermitValid,
  MULTICALL3,
  optionalPermitCall,
  SignedPermit,
} from "../src/scripts/composable-cow/optionalPermit";
import {
  COW_SHED_FACTORY_ADDRESS,
  COW_SHED_IMPLEMENTATION_ADDRESS,
  getPollerCowShedSdk,
} from "../src/scripts/composable-cow/pollerCowShed";

const POLLER = "0x1111111111111111111111111111111111111111";
const HANDLER = "0x2222222222222222222222222222222222222222";
const FUNDER = "0x3333333333333333333333333333333333333333";
const OWNER = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x5555555555555555555555555555555555555555";
const SALT = ethers.utils.hexZeroPad("0x01", 32);
const schedule: ComposableCowPollerSchedule = {
  handler: HANDLER,
  authEpoch: 7,
  funder: FUNDER,
  owner: OWNER,
  salt: SALT,
  staticInput: "0x1234",
};
const poller = new ComposableCowPoller(POLLER);
const pollerInterface = new ethers.utils.Interface([
  "function registerFromShed((address handler,uint96 authEpoch,address funder,address owner,bytes32 salt,bytes staticInput) schedule) returns (bytes32)",
  "function revokeFromShed(address handler,address funder,address owner,bytes32 salt,uint96 authEpoch) returns (bytes32)",
]);

async function main() {
  const cowShedProvider = new ethers.providers.JsonRpcProvider();
  cowShedProvider.getCode = async () => "0x";
  const cowShedSigner = new ethers.Wallet(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    cowShedProvider,
  );
  const cowShedSdk = getPollerCowShedSdk(
    new EthersV5Adapter({
      provider: cowShedProvider,
      signer: cowShedSigner,
    }),
  );
  assert.equal(COW_SHED_2_1_0_VERSION, "2.1.0");
  assert.equal(
    COW_SHED_FACTORY_ADDRESS.toLowerCase(),
    "0x5e284e80f3bd6a7d80a8500d9c49878028110848",
  );
  assert.equal(
    COW_SHED_IMPLEMENTATION_ADDRESS.toLowerCase(),
    "0xf0d400089d5b9faca64e3422ad6614546587cffb",
  );
  assert.equal(cowShedSdk.version, COW_SHED_2_1_0_VERSION);
  assert.equal(
    cowShedSdk
      .getCowShedAccount(SupportedChainId.GNOSIS_CHAIN, FUNDER)
      .toLowerCase(),
    "0x919b82db489524b405e3e4193250970056387c35",
  );
  const cowShedNonce = ethers.utils.hexZeroPad("0x02", 32);
  const cowShedDeadline = 1_800_000_000n;
  const cowShedCalls = [
    {
      target: TOKEN,
      value: 0n,
      callData: "0x",
      allowFailure: false,
      isDelegateCall: false,
    },
  ];
  const signedCowShedCall = await cowShedSdk.signCalls({
    chainId: SupportedChainId.GNOSIS_CHAIN,
    calls: cowShedCalls,
    nonce: cowShedNonce,
    deadline: cowShedDeadline,
    signer: cowShedSigner,
    gasLimit: 1n,
  });
  assert.equal(
    signedCowShedCall.signedMulticall.to.toLowerCase(),
    COW_SHED_FACTORY_ADDRESS.toLowerCase(),
  );
  const cowShedFactoryInterface = new ethers.utils.Interface([
    "function executeHooks((address target,uint256 value,bytes callData,bool allowFailure,bool isDelegateCall)[] calls,bytes32 nonce,uint256 deadline,address user,bytes signature)",
  ]);
  const decodedCowShedCall = cowShedFactoryInterface.decodeFunctionData(
    "executeHooks",
    signedCowShedCall.signedMulticall.data,
  );
  assert.equal(
    ethers.utils.verifyTypedData(
      {
        name: "COWShed",
        version: COW_SHED_2_1_0_VERSION,
        chainId: SupportedChainId.GNOSIS_CHAIN,
        verifyingContract: signedCowShedCall.cowShedAccount,
      },
      COW_SHED_712_TYPES,
      {
        calls: cowShedCalls,
        nonce: cowShedNonce,
        deadline: cowShedDeadline,
      },
      decodedCowShedCall.signature,
    ),
    cowShedSigner.address,
  );

  const expectedScheduleId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address", "bytes32"],
      [FUNDER, HANDLER, OWNER, SALT],
    ),
  );
  assert.equal(poller.getScheduleId(schedule), expectedScheduleId);

  const registerCall = pollerInterface.parseTransaction({
    data: poller.encodeRegisterFromShed(schedule),
  });
  assert.equal(registerCall.name, "registerFromShed");
  assert.equal(registerCall.args.schedule.handler, HANDLER);
  assert(registerCall.args.schedule.authEpoch.eq(schedule.authEpoch));
  assert.equal(registerCall.args.schedule.funder, FUNDER);
  assert.equal(registerCall.args.schedule.owner, OWNER);

  const revokeCall = pollerInterface.parseTransaction({
    data: poller.encodeRevokeFromShed(schedule),
  });
  assert.equal(revokeCall.name, "revokeFromShed");
  assert.equal(revokeCall.args.handler, HANDLER);
  assert.equal(revokeCall.args.funder, FUNDER);
  assert.equal(revokeCall.args.owner, OWNER);
  assert.equal(revokeCall.args.salt, SALT);
  assert(revokeCall.args.authEpoch.eq(schedule.authEpoch));

  const signedPermit: SignedPermit = {
    owner: FUNDER,
    spender: OWNER,
    value: "10",
    nonce: "3",
    deadline: "1800000000",
    v: 27,
    r: ethers.constants.HashZero,
    s: ethers.constants.HashZero,
  };
  const permitCall = optionalPermitCall(TOKEN, signedPermit);
  assert.equal(permitCall.target, MULTICALL3);
  const multicallInterface = new ethers.utils.Interface([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  ]);
  const [calls] = multicallInterface.decodeFunctionData(
    "aggregate3",
    permitCall.callData,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, TOKEN);
  assert.equal(calls[0].allowFailure, true);

  const permitInterface = new ethers.utils.Interface([
    "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  ]);
  const decodedPermit = permitInterface.decodeFunctionData(
    "permit",
    calls[0].callData,
  );
  assert.equal(decodedPermit.owner, FUNDER);
  assert.equal(decodedPermit.spender, OWNER);
  assert(decodedPermit.value.eq(10));

  let simulatedArgs: readonly unknown[] | undefined;
  const token = {
    callStatic: {
      permit: async (...args: readonly unknown[]) => {
        simulatedArgs = args;
      },
    },
  } as unknown as ethers.Contract;
  await assertPermitValid(token, signedPermit);
  assert.equal(simulatedArgs?.[0], FUNDER);
  assert.equal(simulatedArgs?.[1], OWNER);

  console.log("ComposableCowPoller SDK integration tests passed");
}

void main();
