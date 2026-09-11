import { ethers } from "ethers";

export const MULTICALL3 =
  "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_INTERFACE = new ethers.utils.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
const PERMIT_TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function nonces(address owner) external view returns (uint256)",
  "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
] as const;
const PERMIT_TOKEN_INTERFACE = new ethers.utils.Interface(PERMIT_TOKEN_ABI);

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export type SignedPermit = {
  owner: string;
  spender: string;
  value: string;
  nonce: string;
  deadline: string;
  v: number;
  r: string;
  s: string;
};

export function getPermitTokenContract(
  token: string,
  signer?: ethers.Signer | ethers.providers.Provider,
) {
  return new ethers.Contract(token, PERMIT_TOKEN_INTERFACE, signer);
}

export function optionalPermitCall(token: string, permit: SignedPermit) {
  const callData = PERMIT_TOKEN_INTERFACE.encodeFunctionData(
    "permit",
    permitArgs(permit),
  );
  return {
    target: MULTICALL3,
    callData: MULTICALL3_INTERFACE.encodeFunctionData("aggregate3", [
      [{ target: token, allowFailure: true, callData }],
    ]),
  };
}

export async function assertPermitValid(
  token: ethers.Contract,
  permit: SignedPermit,
): Promise<void> {
  await token.callStatic.permit(...permitArgs(permit));
}

function permitArgs(permit: SignedPermit) {
  return [
    permit.owner,
    permit.spender,
    permit.value,
    permit.deadline,
    permit.v,
    permit.r,
    permit.s,
  ] as const;
}
