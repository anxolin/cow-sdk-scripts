import { SupportedChainId } from '@cowprotocol/cow-sdk';
import axios, { isAxiosError } from 'axios';
import { BungeeBuildTxResponse, BungeeQuoteResponse, Route } from './types';

const API_KEY = '72a5b4b0-e727-48be-8aa1-5da9d62fe635'; // SOCKET PUBLIC API KEY from docs

export const socketGatewayMapping: Record<
  SupportedChainId,
  string | undefined
> = {
  /**
   * #CHAIN-INTEGRATION
   * This needs to be changed if you want to support a new chain
   */
  [SupportedChainId.MAINNET]: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
  [SupportedChainId.GNOSIS_CHAIN]: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
  [SupportedChainId.ARBITRUM_ONE]: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
  [SupportedChainId.BASE]: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
  [SupportedChainId.SEPOLIA]: undefined,
};

/**
 * Makes a GET request to Bungee APIs for quote
 * https://docs.bungee.exchange/bungee-manual/socket-api-reference/quote-controller-get-quote/
 */
export async function getBungeeQuote(params: {
  fromChainId: string;
  toChainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  userAddress: string;
  recipient: string;
  singleTxOnly: boolean;
  sort: string;
  isContractCall: boolean;
  disableSwapping: boolean;
  includeBridges: string[];
}) {
  try {
    const response = await axios.get<BungeeQuoteResponse>(
      `https://api.socket.tech/v2/quote`,
      {
        headers: {
          'API-KEY': API_KEY,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        params, // query params
      }
    );

    const json = response.data;
    return json;
  } catch (error) {
    if (isAxiosError(error)) {
      console.error('🔴 Error getting bungee quote:', error.response?.data);
    } else {
      console.error('🔴 Error getting bungee quote:', error);
    }
    throw error;
  }
}

/**
 * Makes a POST request to Bungee APIs for swap/bridge transaction data
 * https://docs.bungee.exchange/bungee-manual/socket-api-reference/app-controller-get-single-tx
 */
export async function getBungeeRouteTransactionData(route: Route) {
  try {
    const response = await axios.post<BungeeBuildTxResponse>(
      'https://api.socket.tech/v2/build-tx',
      { route },
      {
        headers: {
          'API-KEY': API_KEY,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const json = response.data;
    return json;
  } catch (error) {
    if (isAxiosError(error)) {
      console.error(
        '🔴 Error getting bungee route transaction data:',
        error.response?.data
      );
    } else {
      console.error('🔴 Error getting bungee route transaction data:', error);
    }
    throw error;
  }
}

export const decodeBungeeTxData = (txData: string) => {
  // remove first two characters = 0x
  const txDataWithout0x = txData.slice(2);
  // first four bytes are the routeId
  const routeId = `0x${txDataWithout0x.slice(0, 8)}`;
  // rest is the encoded function data
  const encodedFunctionData = `0x${txDataWithout0x.slice(8)}`;
  return { routeId, encodedFunctionData };
};
