import { ethers } from "ethers";

import { getErc20Contract } from "../erc20";
import {
  createWeirollContract,
  createWeirollDelegateCall,
  EvmCall,
  SupportedChainId,
  WeirollCommandFlags,
} from "@cowprotocol/cow-sdk";
import { getCowShedAccount } from "../cowShed";
import { DAI_ADDRESS } from "../../const/mainnet";

const XDAI_BRIDGE_GNOSIS_CHAIN_ADDRESS =
  "0x4aa42145Aa6Ebf72e164C9bBC74fbD3788045016"; // Implementation by the time of this writing https://etherscan.io/address/0x166124b75c798Cedf1B43655E9B5284eBd5203DB

const XDAI_BRIDGE_RELAY_TOKENS_ABI = [
  "function relayTokens(address receiver, uint256 amount)", // bridge DAI
] as const;

export interface BridgeWithXdaiBridgeTxArgs {
  owner: string;
  chainId: SupportedChainId;
}

export async function bridgeWithXdaiBridge({
  owner,
  chainId,
}: BridgeWithXdaiBridgeTxArgs): Promise<EvmCall> {
  const cowShedAccount = getCowShedAccount(chainId, owner);

  // Create bridged token contract
  const bridgedTokenContract = createWeirollContract(
    getErc20Contract(DAI_ADDRESS),
    WeirollCommandFlags.CALL // TODO: I think I should use CALL just for the approve, and STATICCALL for the balanceOf (for now is just testing)
  );

  // Create xDai bridge contract
  const xDaiBridgeContract = createWeirollContract(
    new ethers.Contract(
      XDAI_BRIDGE_GNOSIS_CHAIN_ADDRESS,
      XDAI_BRIDGE_RELAY_TOKENS_ABI
    ),
    WeirollCommandFlags.CALL
  );

  const bridgeDepositCall = createWeirollDelegateCall((planner) => {
    // Get balance of CoW shed proxy
    console.log(
      `[xDaiBridge] Get cow-shed balance for ERC20.balanceOf(${cowShedAccount}) for ${bridgedTokenContract}`
    );
    const bridgedAmount = planner.add(
      bridgedTokenContract.balanceOf(cowShedAccount)
    );

    // Set allowance for omnibridge to transfer bridged tokens
    console.log(
      `[xDaiBridge] xDaiBridgeContract.approve(${XDAI_BRIDGE_GNOSIS_CHAIN_ADDRESS}, ${bridgedAmount}) for ${bridgedTokenContract}`
    );
    planner.add(
      bridgedTokenContract.approve(
        XDAI_BRIDGE_GNOSIS_CHAIN_ADDRESS,
        bridgedAmount
      )
    );

    // Relay tokens from CoW Shed proxy to Gnosis
    console.log(
      `[xDaiBridge] xDaiBridgeContract.relayTokens(${owner}, ${bridgedAmount}) for ${xDaiBridgeContract}`
    );
    planner.add(xDaiBridgeContract.relayTokens(owner, bridgedAmount));
  });

  // Return the transaction
  return bridgeDepositCall;
}
