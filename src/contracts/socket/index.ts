import { SupportedChainId } from '@cowprotocol/cow-sdk';
import {
  Contract as WeirollContract,
  Planner as WeirollPlanner,
} from '@weiroll/weiroll.js';
import { ethers } from 'ethers';
import { BaseTransaction } from '../../types';
import { getWallet } from '../../utils';
import { getCowShedAccount } from '../cowShed';
import { getErc20Contract } from '../erc20';
import { CommandFlags, getWeirollTx } from '../weiroll';
import { bytesLibAbi, socketGatewayAbi, SocketRequest } from './types';
import {
  decodeBungeeTxData,
  getBungeeQuote,
  getBungeeRouteTransactionData,
  socketBridgeFunctionSignatures,
  verifyBungeeTxData,
} from './utils';

export interface BridgeWithBungeeParams {
  owner: string;
  sourceChain: SupportedChainId;
  sourceToken: string;
  sourceTokenAmount: bigint;
  targetToken: string;
  targetChain: number;
  recipient: string;
  includeBridges: string[];
}

export async function bridgeWithBungee(
  params: BridgeWithBungeeParams
): Promise<BaseTransaction> {
  const {
    owner,
    sourceChain,
    sourceToken,
    sourceTokenAmount,
    targetChain,
    targetToken,
    recipient,
    includeBridges,
  } = params;

  // Get cow-shed account
  const cowShedAccount = getCowShedAccount(sourceChain, owner);

  const planner = new WeirollPlanner();

  // Get bungee quote
  const quote = await getBungeeQuote({
    fromChainId: sourceChain.toString(),
    fromTokenAddress: sourceToken,
    toChainId: targetChain.toString(),
    toTokenAddress: targetToken,
    fromAmount: sourceTokenAmount.toString(),
    userAddress: cowShedAccount, // bridge input token will be in cowshed account
    recipient: recipient,
    sort: 'output', // optimize for output amount
    singleTxOnly: true, // should be only single txn on src chain, no destination chain txn
    isContractCall: true, // get quotes that are compatible with contracts
    disableSwapping: true, // should not show routes that require swapping
    includeBridges,
  });
  if (!quote) {
    throw new Error('No quote found');
  }
  console.log('🔗 Socket quote:', quote.result.routes);
  // check if routes are found
  if (!quote.result.routes.length) {
    throw new Error('No routes found');
  }
  // check if only single user tx is present
  if (quote.result.routes[0].userTxs.length > 1) {
    throw new Error('Multiple user txs found');
  }
  // check if the user tx is fund-movr
  if (quote.result.routes[0].userTxs[0].userTxType !== 'fund-movr') {
    throw new Error('User tx is not fund-movr');
  }

  // use the first route to prepare the bridge tx
  const route = quote.result.routes[0];
  const txData = await getBungeeRouteTransactionData(route);
  const { routeId, encodedFunctionData } = decodeBungeeTxData(
    txData.result.txData
  );
  console.log('🔗 Socket txData:', txData.result.txData);
  console.log('🔗 Socket routeId:', routeId);

  // validate bungee tx data returned from socket API using SocketVerifier contract
  const expectedSocketRequest: SocketRequest = {
    amount: route.fromAmount,
    recipient: route.recipient,
    toChainId: targetChain.toString(),
    token: sourceToken,
    signature: socketBridgeFunctionSignatures[includeBridges[0]],
  };
  await verifyBungeeTxData(
    sourceChain,
    txData.result.txData,
    routeId,
    expectedSocketRequest
  );

  // Create bridged token contract
  const bridgedTokenContract = WeirollContract.createContract(
    getErc20Contract(sourceToken),
    CommandFlags.CALL
  );

  // Get balance of CoW shed proxy
  console.log(
    `[socket] Get cow-shed balance for ERC20.balanceOf(${cowShedAccount}) for ${bridgedTokenContract.address}`
  );

  // Get bridged amount (balance of the intermediate token at swap time)
  const sourceAmountIncludingSurplusBytes = planner.add(
    bridgedTokenContract.balanceOf(cowShedAccount).rawValue()
  );

  // Check & set allowance for SocketGateway to transfer bridged tokens
  // check if allowance is sufficient
  const {
    approvalData: {
      approvalTokenAddress,
      allowanceTarget,
      minimumApprovalAmount,
    },
  } = txData.result;
  const intermediateTokenContract = getErc20Contract(
    approvalTokenAddress,
    await getWallet(sourceChain)
  );
  const allowance = await intermediateTokenContract.allowance(
    cowShedAccount,
    allowanceTarget
  );
  console.log('current cowshed allowance', allowance);
  if (allowance < minimumApprovalAmount) {
    // set allowance
    const approvalTokenContract = WeirollContract.createContract(
      getErc20Contract(approvalTokenAddress),
      CommandFlags.CALL
    );
    console.log(
      `[socket] approvalTokenContract.approve(${allowanceTarget}, ${sourceAmountIncludingSurplusBytes}) for ${approvalTokenContract}`
    );
    const allowanceToSet = ethers.utils.parseUnits(
      '1000',
      await intermediateTokenContract.decimals()
    );
    planner.add(approvalTokenContract.approve(allowanceTarget, allowanceToSet));
  }

  const bytesLibContractAddress = '0x8f6BA63528De7266d8cDfDdec7ACFA8446c62aB4';
  const bytesLibContract = WeirollContract.createContract(
    new ethers.Contract(bytesLibContractAddress, bytesLibAbi),
    CommandFlags.CALL
  );
  const encodedFunctionDataWithNewAmount = planner.add(
    bytesLibContract.replaceBytes(
      encodedFunctionData,
      4, // first 4 bytes are the function selector
      32, // first 32 bytes of the params are the amount
      sourceAmountIncludingSurplusBytes
    )
  );

  const socketGatewayContract = WeirollContract.createContract(
    new ethers.Contract(txData.result.txTarget, socketGatewayAbi),
    CommandFlags.CALL
  );
  // Call executeRoute on SocketGateway
  planner.add(
    socketGatewayContract.executeRoute(
      routeId,
      encodedFunctionDataWithNewAmount
    )
  );

  // Return the transaction
  return getWeirollTx({ planner });
}
