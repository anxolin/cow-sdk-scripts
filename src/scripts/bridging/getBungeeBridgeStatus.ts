import { OrderBookApi, SupportedChainId } from '@cowprotocol/cow-sdk';
import axios from 'axios';

type BridgeStatusResponse = {
  success: boolean;
  result: Result[];
};

type Result = {
  orderId: string;
  bridgeName: string;
  isCowswapTrade: boolean;
  srcTransactionHash: string;
  destTransactionHash: string;
  fromChainId: number;
  toChainId: number;
  srcTxStatus: string;
  destTxStatus: string;
};

/* 
status: {
  orderId: '0x0bfa5c44e95964a907d5f0d69ea65221e3a8fb1871e41aa3195e446c4ce855bbdaee4d2156de6fe6f7d50ca047136d758f96a6f067ee7474',
  bridgeName: 'across',
  isCowswapTrade: true,
  fromChainId: 42161,
  toChainId: 8453,
  srcTransactionHash: '0x649b6fd231cf97972ccff205925f4582c760db7ce54d1b38a91eedca0e933986',
  destTransactionHash: '0xe342cf2cb68ac161968457926f9449084777ca0662c94b88c2c783926552d189',
  srcTxStatus: 'COMPLETED',
  destTxStatus: 'COMPLETED'
}
*/

export async function run() {
  const chainId = SupportedChainId.ARBITRUM_ONE;
  const _orderId =
    '0x0bfa5c44e95964a907d5f0d69ea65221e3a8fb1871e41aa3195e446c4ce855bbdaee4d2156de6fe6f7d50ca047136d758f96a6f067ee7474';

  const status = await getBridgeStatusWithSrcTxHash(chainId, _orderId);
  const statusResponse = {
    orderId: status.orderId,
    bridgeName: status.bridgeName,
    isCowswapTrade: status.isCowswapTrade,
    fromChainId: status.fromChainId,
    toChainId: status.toChainId,
    srcTransactionHash: status.srcTransactionHash,
    destTransactionHash: status.destTransactionHash,
    srcTxStatus: status.srcTxStatus,
    destTxStatus: status.destTxStatus,
  };
  console.log('status:', statusResponse);

  const statusViaTxApi = await getBridgeStatusWithOrderIdViaTxApi(_orderId);
  const statusViaTxApiResponse = {
    orderId: statusViaTxApi.orderId,
    bridgeName: statusViaTxApi.bridgeName,
    isCowswapTrade: statusViaTxApi.isCowswapTrade,
    fromChainId: statusViaTxApi.fromChainId,
    toChainId: statusViaTxApi.toChainId,
    srcTransactionHash: statusViaTxApi.srcTransactionHash,
    destTransactionHash: statusViaTxApi.destTransactionHash,
    srcTxStatus: statusViaTxApi.srcTxStatus,
    destTxStatus: statusViaTxApi.destTxStatus,
  };
  console.log('statusViaTxApi:', statusViaTxApiResponse);

  const statusViaOrderId = await getBridgeStatusWithOrderId(_orderId);
  const statusViaOrderIdResponse = {
    orderId: statusViaOrderId.orderId,
    bridgeName: statusViaOrderId.bridgeName,
    isCowswapTrade: statusViaOrderId.isCowswapTrade,
    fromChainId: statusViaOrderId.fromChainId,
    toChainId: statusViaOrderId.toChainId,
    srcTransactionHash: statusViaOrderId.srcTransactionHash,
    destTransactionHash: statusViaOrderId.destTransactionHash,
    srcTxStatus: statusViaOrderId.srcTxStatus,
    destTxStatus: statusViaOrderId.destTxStatus,
  };
  console.log('statusViaOrderId:', statusViaOrderIdResponse);

  const socketscanLink = getSocketscanLink(_orderId);
  console.log(socketscanLink);
}

export async function getBridgeStatusWithSrcTxHash(
  chainId: SupportedChainId,
  orderId: string
) {
  // fetch order source tx from Orderbook API
  const orderBook = new OrderBookApi({
    chainId,
  });
  const trades = await orderBook.getTrades({ orderUid: orderId });
  const srcTxHash = trades[0].txHash;
  if (!srcTxHash) {
    throw new Error('No source tx hash found');
  }

  // fetch bridge status from Socketscan API using cowswap trade tx hash
  const response = await axios.get<BridgeStatusResponse>(
    `https://microservices.socket.tech/loki/tx?txHash=${srcTxHash}`
  );
  return response.data.result[0];
}

export async function getBridgeStatusWithOrderIdViaTxApi(orderId: string) {
  // fetch bridge status from Socketscan API using cowswap order id
  const response = await axios.get<BridgeStatusResponse>(
    `https://microservices.socket.tech/loki/tx?txHash=${orderId}`
  );
  return response.data.result[0];
}

export async function getBridgeStatusWithOrderId(orderId: string) {
  // fetch bridge status from Socketscan API using cowswap order id
  const response = await axios.get<BridgeStatusResponse>(
    `https://microservices.socket.tech/loki/order?orderId=${orderId}`
  );
  return response.data.result[0];
}

export const getSocketscanLink = (orderId: string) =>
  `https://www.socketscan.io/tx/${orderId}`;
