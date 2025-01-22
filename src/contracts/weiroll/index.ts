import { Planner } from "@weiroll/weiroll.js";
import { ethers } from "ethers";
import { BaseTransaction } from "../../types";

// TODO: Duplicated! Move to a shared location
export enum CommandFlags {
  DELEGATECALL = 0,
  CALL = 1,
  STATICCALL = 2,
  CALL_WITH_VALUE = 3,
  CALLTYPE_MASK = 3,
  EXTENDED_COMMAND = 64,
  TUPLE_RETURN = 128,
}

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

function getWeirollCalldata(planner: Planner) {
  const { commands, state } = planner.plan();
  const weirollInterface = new ethers.utils.Interface(WEIROLL_ABI);

  return weirollInterface.encodeFunctionData("execute", [commands, state]);
}

interface GetWeirollTxArgs {
  planner: Planner;
  value?: bigint;
  isDelegateCall?: boolean;
}

export function getWeirollTx(params: GetWeirollTxArgs): BaseTransaction {
  const { planner, value = 0n, isDelegateCall = true } = params;

  return {
    to: WEIROLL_ADDRESS,
    value,
    callData: getWeirollCalldata(planner),
    isDelegateCall,
  };
}
