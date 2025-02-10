import { Contract, ethers, Signer } from "ethers";
import { BaseTransaction } from "../../types";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import {
  acrossSpokePoolMapping,
  mathContractMapping,
} from "./acrossSpokePoolMapping";
import { getCowShedAccount } from "../cowShed";
import {
  Planner as WeirollPlanner,
  Contract as WeirollContract,
} from "@weiroll/weiroll.js";
import { getAcrossQuote } from "./utils";
import { getErc20Contract } from "../erc20";
import { CommandFlags, getWeirollTx } from "../weiroll";
import { acrossSpokePoolAbi } from "./acrossSpokePoolAbi";
import { mathContractAbi } from "./mathContractAbi";

export interface BridgeWithAcrossParams {
  owner: string;
  sourceChain: SupportedChainId;
  sourceToken: string;
  sourceTokenAmount: bigint;
  targetToken: string;
  targetChain: number;
  recipient: string;
  bridgeAllFromSwap: boolean;
}

export async function bridgeWithAcross(
  params: BridgeWithAcrossParams
): Promise<BaseTransaction> {
  const {
    owner,
    sourceChain,
    sourceToken,
    sourceTokenAmount,
    targetChain,
    targetToken,
    bridgeAllFromSwap,
    recipient,
  } = params;

  const spokePoolAddress = acrossSpokePoolMapping[sourceChain];
  const mathContractAddress = mathContractMapping[sourceChain];
  if (!spokePoolAddress || !mathContractAddress) {
    throw new Error("Spoke pool or math contract not found");
  }

  if (!bridgeAllFromSwap) {
    throw new Error("Bridge User Amount: not implemented");
  }

  // Get cow-shed account
  const cowShedAccount = getCowShedAccount(sourceChain, owner);

  const planner = new WeirollPlanner();

  // Get across quote
  const quote = await getAcrossQuote(
    {
      originChainId: sourceChain,
      destinationChainId: targetChain,
      inputToken: sourceToken,
      outputToken: targetToken,
    },
    BigInt(sourceTokenAmount),
    recipient
  );
  const depositParams = quote.deposit;
  const relayFeePercentage = quote.fees.totalRelayFee.pct; // TODO: review fee model

  // Create bridged token contract
  const bridgedTokenContract = WeirollContract.createContract(
    getErc20Contract(sourceToken),
    CommandFlags.CALL // TODO: I think I should use CALL just for the approve, and STATICCALL for the balanceOf (for now is just testing)
  );

  // Create SpokePool contract
  const spokePoolContract = WeirollContract.createContract(
    new ethers.Contract(spokePoolAddress, acrossSpokePoolAbi),
    CommandFlags.CALL
  );

  // Create Math contract
  const mathContract = WeirollContract.createContract(
    new ethers.Contract(mathContractAddress, mathContractAbi),
    CommandFlags.CALL
  );

  // Get balance of CoW shed proxy
  console.log(
    `[omnibridge] Get cow-shed balance for ERC20.balanceOf(${cowShedAccount}) for ${bridgedTokenContract}`
  );

  // Get bridged amount (balance of the intermediate token at swap time)
  const actualIntermediateAmount = planner.add(
    bridgedTokenContract.balanceOf(cowShedAccount)
  );

  // Get the output amount using the actual received intermediate amount
  const actualOutputAmount = planner.add(
    mathContract.multiplyAndSubtract(
      actualIntermediateAmount,
      BigInt(relayFeePercentage)
    )
  );

  // Prepare deposit params
  const quoteTimestamp = BigInt(depositParams.quoteTimestamp);
  const fillDeadline = BigInt(Math.floor(Date.now() / 1000) + 7200); // 2 hours from now
  const exclusivityDeadlineOffset = BigInt(depositParams.exclusivityDeadline);

  // Deposit into spoke pool
  planner.add(
    spokePoolContract.depositV3(
      cowShedAccount,
      recipient,
      depositParams.inputToken,
      depositParams.outputToken,
      actualIntermediateAmount,
      actualOutputAmount,
      depositParams.destinationChainId,
      depositParams.exclusiveRelayer,
      quoteTimestamp,
      fillDeadline,
      exclusivityDeadlineOffset,
      depositParams.message
    )
  );

  // Return the transaction
  return getWeirollTx({ planner });
}

function isZeroAddress(address: string) {
  return (
    address.toLocaleLowerCase() ===
    ethers.constants.AddressZero.toLocaleLowerCase()
  );
}

export { getIntermediateTokenFromTargetToken } from "./utils";
