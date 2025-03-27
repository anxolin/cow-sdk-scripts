import { base, arbitrum, APP_CODE } from "../../const";

import { SupportedChainId, TargetChainId } from "@cowprotocol/cow-sdk";
import { ethers, providers, utils } from "ethers";
import { OrderBookApi } from "@cowprotocol/cow-sdk";

import { getRpcProvider, getWallet } from "../../utils";
import { Interface } from "ethers/lib/utils";
import { latest as latestAppData } from "@cowprotocol/app-data";

export const ACROSS_SPOOK_CONTRACT_ADDRESSES: Partial<
  Record<TargetChainId, string>
> = {
  [SupportedChainId.MAINNET]: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  [SupportedChainId.ARBITRUM_ONE]: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a",
  [SupportedChainId.BASE]: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  [SupportedChainId.SEPOLIA]: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662",
};

const ACROSS_DEPOSIT_EVENT_INTERFACE = new Interface([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);

const ACROSS_DEPOSIT_EVENT_TOPIC =
  ACROSS_DEPOSIT_EVENT_INTERFACE.getEventTopic("FundsDeposited");

const COW_TRADE_EVENT_INTERFACE = new Interface([
  "event Trade (address owner, address sellToken, address buyToken, uint256 sellAmount, uint256 buyAmount, uint256 feeAmount, bytes orderUid)",
]);

const COW_TRADE_EVENT_TOPIC = COW_TRADE_EVENT_INTERFACE.getEventTopic("Trade");

export const HOOK_DAPP_ID = "cow-sdk://bridging/providers/across";

export async function run() {
  const chainId = SupportedChainId.ARBITRUM_ONE;
  const orderId =
    "0x6a6fbd658557d9cc9fcc42caefef9cb3afd48e670596890bcf81e86cabc2abba016f34d4f2578c3e9dffc3f2b811ba30c0c9e7f367e42a99";
  const settlementTx =
    "0xc34b4dcc30d0b8490abbcb730a6df7b3cae5aa6bd2234beaf6e0e21733e26e6f";

  const rpc = await getRpcProvider(chainId);
  const depositId = await getDepositId(chainId, orderId, settlementTx, rpc);
  console.log(`🎉 depositId for order ${orderId}: ${depositId}`);
}
async function getDepositId(
  chainId: SupportedChainId,
  orderId: string,
  settlementTx: string,
  rpc: providers.JsonRpcProvider
) {
  const txReceipt = await rpc.getTransactionReceipt(settlementTx);

  // const tx = await rpc.getTransaction(settlementTx);

  // Get deposit events
  const depositEvents = getAcrossDepositEvents(chainId, txReceipt.logs);

  if (depositEvents.length === 0) {
    // This should never happen, means the hook was not triggered
    throw new Error(
      "No deposit events found in the settlement tx. Are you sure the hook was triggered?"
    );
  }

  // TODO: Uncomment this line after testing. Why? Because, if there's only one deposit, there's no point on continuing the algorithm. We know the depositId already. This is commented to test the algorithm
  if (depositEvents.length === 1) {
    return depositEvents[0].depositId;
  }

  // Just print some stuff
  for (const deposit of depositEvents) {
    console.log(
      `Across Deposit - depositId: ${
        deposit.depositId
      }, Input: ${deposit.inputAmount.toString()}, Output: ${deposit.outputAmount.toString()}`
    );
  }

  // Get CoW Trade events
  const cowTradeEvents = getCowTradeEvents(chainId, txReceipt.logs);

  // Fetch from API the details of all the settlement orders
  const orderbookApi = new OrderBookApi({ chainId });
  const ordersFromSettlement = await Promise.all(
    cowTradeEvents.map((tradeEvent) => orderbookApi.getOrder(orderId))
  );

  // Filter orders, leaving only cross-chain orders using Across provider
  const crossChainOrdersAcross = ordersFromSettlement.filter((order) => {
    // Get all post hooks from order
    const postHooks = getPostHooks(order.fullAppData ?? undefined);

    // Get the bridging hook from across
    const bridgingHook = postHooks.find((hook) => {
      return hook.dappId?.startsWith(HOOK_DAPP_ID);
    });

    // Return only orders that have a bridging hook
    return bridgingHook !== undefined;
  });

  // Find relative position for the orderId in the settlement tx
  const orderIndex = crossChainOrdersAcross.findIndex(
    (order) => order.uid === orderId
  );

  // Get the depositId from the relative position
  const depositId = depositEvents[orderIndex].depositId;

  return depositId;
}

function getAcrossDepositEvents(
  chainId: SupportedChainId,
  logs: providers.Log[]
): AcrossDepositEvent[] {
  const spookContractAddress =
    ACROSS_SPOOK_CONTRACT_ADDRESSES[chainId]?.toLowerCase();

  if (!spookContractAddress) {
    return [];
  }

  // Get accross deposit events
  const depositEvents = logs.filter((log) => {
    return (
      log.address.toLocaleLowerCase() === spookContractAddress &&
      log.topics[0] === ACROSS_DEPOSIT_EVENT_TOPIC
    );
  });

  // Parse logs
  return depositEvents.map((event) => {
    const {
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      destinationChainId,
      depositId,
      quoteTimestamp,
      fillDeadline,
      exclusivityDeadline,
      depositor,
      recipient,
      exclusiveRelayer,
      message,
    } = ACROSS_DEPOSIT_EVENT_INTERFACE.parseLog(event)
      .args as unknown as AcrossDepositEvent;
    return {
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      destinationChainId,
      depositId,
      quoteTimestamp,
      fillDeadline,
      exclusivityDeadline,
      depositor,
      recipient,
      exclusiveRelayer,
      message,
    };
  });
}

function getCowTradeEvents(
  chainId: SupportedChainId,
  logs: providers.Log[]
): CowTradeEvent[] {
  const cowTradeEvents = logs.filter((log) => {
    return log.address.toLocaleLowerCase() === COW_TRADE_EVENT_TOPIC;
  });

  return cowTradeEvents.map((event) => {
    const {
      owner,
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      feeAmount,
      orderUid,
    } = COW_TRADE_EVENT_INTERFACE.parseLog(event)
      .args as unknown as CowTradeEvent;
    return {
      owner,
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      feeAmount,
      orderUid,
    };
  });
}

interface AcrossDepositEvent {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  destinationChainId: string;
  depositId: string;
  quoteTimestamp: string;
  fillDeadline: string;
  exclusivityDeadline: string;
  depositor: string;
  recipient: string;
  exclusiveRelayer: string;
  message: string;
}

interface CowTradeEvent {
  owner: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  orderUid: string;
}

export function getPostHooks(fullAppData?: string): latestAppData.CoWHook[] {
  if (!fullAppData) {
    return [];
  }

  const appData = JSON.parse(fullAppData);
  if (!isAppDoc(appData)) {
    return [];
  }

  if (!appData.metadata.hooks) {
    return [];
  }

  return appData.metadata.hooks.post || [];
}

// TODO: Move to app-data project
export function isAppDoc(
  appData: unknown
): appData is latestAppData.AppDataRootSchema {
  return (
    typeof appData === "object" &&
    appData !== null &&
    "version" in appData &&
    "metadata" in appData
  );
}
