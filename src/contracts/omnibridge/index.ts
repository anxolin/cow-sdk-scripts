import { ethers } from "ethers";

import { getErc20Contract } from "../erc20";
import { getCowShedAccount } from "../cowShed";
import {
  createWeirollContract,
  createWeirollDelegateCall,
  EvmCall,
  SupportedChainId,
  WeirollCommandFlags,
} from "@cowprotocol/cow-sdk";

const OMNIBRIDGE_GNOSIS_CHAIN_ADDRESS =
  "0x88ad09518695c6c3712AC10a214bE5109a655671"; // Implementation by the time of this writing https://etherscan.io/address/0x8eB3b7D8498a6716904577b2579e1c313d48E347

const OMNIBRIDGE_RELAY_TOKENS_ABI = [
  // "function relayTokens(address token, uint256 value)", // Bridge
  "function relayTokens(address token, address receiver, uint256 value)", // bridge and send to receiver
] as const;

export interface BridgeWithOmnibridgeArgs {
  owner: string;
  bridgedToken: string;
  chainId: SupportedChainId;
}

export async function bridgeWithOmnibridge({
  owner,
  bridgedToken,
  chainId,
}: BridgeWithOmnibridgeArgs): Promise<EvmCall> {
  const cowShedAccount = getCowShedAccount(chainId, owner);

  // Create bridged token contract
  const bridgedTokenContract = createWeirollContract(
    getErc20Contract(bridgedToken),
    WeirollCommandFlags.CALL // TODO: I think I should use CALL just for the approve, and STATICCALL for the balanceOf (for now is just testing)
  );

  // Create omnibridge contract
  const omnibridgeContract = createWeirollContract(
    new ethers.Contract(
      OMNIBRIDGE_GNOSIS_CHAIN_ADDRESS,
      OMNIBRIDGE_RELAY_TOKENS_ABI
    ),
    WeirollCommandFlags.CALL
  );

  const bridgeDepositCall = createWeirollDelegateCall((planner) => {
    // Get balance of CoW shed proxy
    console.log(
      `[omnibridge] Get cow-shed balance for ERC20.balanceOf(${cowShedAccount}) for ${bridgedTokenContract}`
    );
    const bridgedAmount = planner.add(
      bridgedTokenContract.balanceOf(cowShedAccount)
    );

    // Set allowance for omnibridge to transfer bridged tokens
    console.log(
      `[omnibridge] bridgedTokenContract.approve(${OMNIBRIDGE_GNOSIS_CHAIN_ADDRESS}, ${bridgedAmount}) for ${bridgedTokenContract}`
    );
    planner.add(
      bridgedTokenContract.approve(
        OMNIBRIDGE_GNOSIS_CHAIN_ADDRESS,
        bridgedAmount
      )
    );

    // Relay tokens from CoW Shed proxy to Gnosis
    console.log(
      `[omnibridge] omnibridgeContract.relayTokens(${bridgedToken}, ${owner}, ${bridgedAmount}) for ${omnibridgeContract}`
    );
    planner.add(
      omnibridgeContract.relayTokens(bridgedToken, owner, bridgedAmount)
    );
  });

  // Return the transaction
  return bridgeDepositCall;
}
