import { BigNumber, ethers } from "ethers";

import { CowShedSdk, SupportedChainId } from "@cowprotocol/cow-sdk";
import { BaseTransaction } from "../../types";
import { jsonReplacer } from "../../utils";

const DEFAULT_GAS_LIMIT = 500_000n;

const cowShedSdk = new CowShedSdk();

export interface SignAndEncodeTxArgs {
  tx: BaseTransaction;
  chainId: SupportedChainId;
  wallet: ethers.Wallet;
}

export interface CowShedTx {
  cowShedAccount: string;
  preAuthenticatedTx: BaseTransaction;
  gasLimit: bigint;
}

function getNonce(): string {
  return ethers.utils.formatBytes32String(Date.now().toString());
}

function getDeadline(): bigint {
  return ethers.constants.MaxUint256.toBigInt();
}

export async function createCowShedTx({
  tx,
  wallet,
  chainId,
}: SignAndEncodeTxArgs): Promise<CowShedTx> {
  // Get the cow-shed for the wallet
  const cowShedAccount = getCowShedAccount(chainId, wallet.address);

  console.log(
    `[cow-shed] Using ${cowShedAccount} as CoW-shed (owner=${wallet.address})`
  );

  // Prepare the calls for the cow-shed
  const calls = [
    {
      callData: tx.callData,
      target: tx.to,
      value: tx.value,
      isDelegateCall: !!tx.isDelegateCall,
      allowFailure: false,
    },
  ];
  const nonce = getNonce();
  const deadline = getDeadline();

  // Sign the calls using cow-shed's owner
  console.log(
    "\n[cow-shed] Signing calls...",
    JSON.stringify(calls, jsonReplacer, 2)
  );

  const { signedMulticall, gasLimit } = await cowShedSdk.signCalls({
    chainId,
    calls,
    nonce,
    deadline,
    signer: wallet,
    defaultGasLimit: DEFAULT_GAS_LIMIT,
  });

  // Return the details, including the signed transaction data
  return {
    cowShedAccount,
    preAuthenticatedTx: {
      callData: signedMulticall.data,
      to: signedMulticall.to,
      value: signedMulticall.value,
    },
    gasLimit,
  };
}

export function getCowShedAccount(
  chainId: SupportedChainId,
  ownerAddress: string
): string {
  return cowShedSdk.getCowShedAccount(chainId, ownerAddress);
}
