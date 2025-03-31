import { BigNumber, ethers } from "ethers";

import { CowShedHooks, SupportedChainId } from "@cowprotocol/cow-sdk";
import { BaseTransaction } from "../../types";
import { jsonReplacer } from "../../utils";
import { SigningScheme } from "@cowprotocol/contracts";

const COW_SHED_CACHE = new Map<SupportedChainId, CowShedHooks>();
const DEFAULT_GAS_LIMIT = BigNumber.from(500_000);

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

export function getCowShedHooks(chainId: SupportedChainId) {
  let cowShedHooks = COW_SHED_CACHE.get(chainId)!;

  if (cowShedHooks) {
    // Return cached cow-shed hooks
    return cowShedHooks;
  }

  // Create new cow-shed hooks and cache it
  cowShedHooks = new CowShedHooks(chainId);
  COW_SHED_CACHE.set(chainId, cowShedHooks);
  return cowShedHooks;
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
  const cowShedHooks = getCowShedHooks(chainId);
  const cowShedAccount = cowShedHooks.proxyOf(wallet.address);

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
  const signature = await cowShedHooks.signCalls(
    calls,
    nonce,
    deadline,
    wallet,
    SigningScheme.EIP712
  );
  console.log("\n[cow-shed] ✍️ Signature:", signature);

  //  Get the signed transaction's calldata
  const callData = cowShedHooks.encodeExecuteHooksForFactory(
    calls,
    nonce,
    deadline,
    wallet.address, // TODO: Check if this is correct 👀
    signature
  );
  console.log("\n[cow-shed] 🔗 Call data for signed transaction:", callData);

  // Estimate the gas limit for the transaction
  // TODO: Freaking estimate gas will fail because the tokens are not yet in the cow-shed! I need to estimate some other way (tenderly, changing the state of ethereum to have already the tokens --> add a transfer for the minimum amount received)
  console.log("\n[cow-shed] ⛽️ Estimating gas limit...");
  const cowShedFactoryAddress = cowShedHooks.getFactoryAddress();
  const gasEstimate = await wallet
    .estimateGas({
      to: cowShedFactoryAddress,
      data: callData,
      value: 0,
    })
    .catch(() => {
      console.error(
        `\n[cow-shed] ❌ Estimate of gas failed (expected until we deal with the swap simulation). Using ${DEFAULT_GAS_LIMIT} as fallback...`
      );
      return DEFAULT_GAS_LIMIT;
    });

  // Return the details, including the signed transaction data
  return {
    cowShedAccount,
    preAuthenticatedTx: {
      callData,
      to: cowShedFactoryAddress,
      value: 0n,
    },
    gasLimit: gasEstimate.toBigInt(),
  };
}

export function getCowShedAccount(
  chainId: SupportedChainId,
  ownerAddress: string
): string {
  const cowShedHooks = getCowShedHooks(chainId);
  return cowShedHooks.proxyOf(ownerAddress);
}
