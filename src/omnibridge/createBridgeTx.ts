import * as weiroll from "@weiroll/weiroll.js";

import { BaseTransaction } from "../types";
import { ethers } from "ethers";
import { CommandFlags } from "@weiroll/weiroll.js/dist/planner";

// TODO: Move to a shared location
export const WEIROLL_ADDRESS = "0x9585c3062Df1C247d5E373Cfca9167F7dC2b5963";

// TODO: Move to a shared location
export const WEIROLL_ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "command_index", type: "uint256" },
      { internalType: "address", name: "target", type: "address" },
      { internalType: "string", name: "message", type: "string" },
    ],
    name: "ExecutionFailed",
    type: "error",
  },
  {
    inputs: [
      { internalType: "bytes32[]", name: "commands", type: "bytes32[]" },
      { internalType: "bytes[]", name: "state", type: "bytes[]" },
    ],
    name: "execute",
    outputs: [{ internalType: "bytes[]", name: "", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
];

const OMINIBRIDGE_GNOSIS_CHAIN_ADDRESS =
  "0x88ad09518695c6c3712AC10a214bE5109a655671"; // Implementation by the time of this writing https://etherscan.io/address/0x8eB3b7D8498a6716904577b2579e1c313d48E347

const OMNIBRIDGE_RELAY_TOKENS_ABI = [
  // "function relayTokens(address token, uint256 value)", // Bridge
  "function relayTokens(address token, receiver address, uint256 value)", // bridge and send to receiver
] as const;

const ERC20_BALANCE_OF_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export interface CreateBridgeTxArgs {
  owner: string;
  cowShedProxy: string;
  bridgedToken: string;
}

export async function createBridgeTx({
  owner,
  cowShedProxy,
  bridgedToken,
}: CreateBridgeTxArgs): Promise<BaseTransaction> {
  // TODO: Use cow-shed and weiroll to create a bridge transaction
  const planner = new weiroll.Planner();

  // Create bridged token contract
  const bridgedTokenContract = weiroll.Contract.createContract(
    new ethers.Contract(bridgedToken, ERC20_BALANCE_OF_ABI),
    CommandFlags.STATICCALL
  );

  // Get balance of CoW shed proxy
  const bridgedAmount = planner.add(
    bridgedTokenContract.balanceOf(cowShedProxy)
  );

  // Create omnibridge contract
  const omnibridgeContract = weiroll.Contract.createContract(
    new ethers.Contract(
      OMINIBRIDGE_GNOSIS_CHAIN_ADDRESS,
      OMNIBRIDGE_RELAY_TOKENS_ABI
    ),
    CommandFlags.CALL
  );

  // Set allowance for omnibridge to transfer bridged tokens
  planner.add(
    bridgedTokenContract.approve(
      OMINIBRIDGE_GNOSIS_CHAIN_ADDRESS,
      bridgedAmount
    )
  );

  // Relay tokens from CoW Shed proxy to Gnosis
  planner.add(
    omnibridgeContract.relayTokens(bridgedToken, owner, bridgedAmount)
  );

  // Return the transaction
  return {
    to: WEIROLL_ADDRESS,
    value: 0n,
    callData: getWeirollCalldata(planner),
    isDelegateCall: true,
  };
}

function getWeirollCalldata(planner: weiroll.Planner) {
  const { commands, state } = planner.plan();
  const weirollInterface = new ethers.utils.Interface(WEIROLL_ABI);

  return weirollInterface.encodeFunctionData("execute", [commands, state]);
}
