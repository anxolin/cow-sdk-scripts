import { createAcrossClient } from "@across-protocol/app-sdk";
import { getAddress, type Address } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains"; // TODO: Can we use ethers for the example?
import { ChainConfig, Route } from "./types";
import { chainIdMap } from "./chainMapping";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import axios from "axios";

export async function getAcrossQuote(
  params: Route,
  inputAmount: bigint,
  recipient: string
) {
  const { inputToken, originChainId, destinationChainId } = params;
  const url = `https://app.across.to/api/suggested-fees?token=${inputToken}&originChainId=${originChainId}&destinationChainId=${destinationChainId}&amount=${inputAmount}&recipient=${recipient}`;
  return axios.get(url).then((res) => res.data);
}

export function getOutputTokenFromIntermediateToken(params: {
  sourceChain: SupportedChainId;
  intermediateTokenAddress: Address;
  destinationChain: number;
}): Address | undefined {
  const { intermediateTokenAddress, sourceChain, destinationChain } = params;
  const chainConfigs = getChainConfigs(sourceChain, destinationChain);
  if (!chainConfigs) return;

  const { sourceChainConfig, targetChainConfig } = chainConfigs;

  // Find the token symbol for the intermediate token
  const intermediateTokenSymbol = getTokenSymbol(
    intermediateTokenAddress,
    sourceChainConfig
  );
  if (!intermediateTokenSymbol) return;

  // Use the tokenSymbol to find the outputToken in the target chain
  return getTokenAddress(intermediateTokenSymbol, targetChainConfig);
}

export function getIntermediateTokenFromTargetToken(params: {
  sourceChain: SupportedChainId;
  targetToken: string;
  targetChain: number;
}): string | undefined {
  const { sourceChain, targetToken, targetChain } = params;
  const chainConfigs = getChainConfigs(sourceChain, targetChain);
  if (!chainConfigs) return;

  const { sourceChainConfig, targetChainConfig } = chainConfigs;

  // Find the token symbol for the target token
  const targetTokenSymbol = getTokenSymbol(targetToken, targetChainConfig);
  if (!targetTokenSymbol) return;

  // Use the tokenSymbol to find the outputToken in the target chain
  return getTokenAddress(targetTokenSymbol, sourceChainConfig);
}
function getTokenSymbol(
  tokenAddress: string,
  chainConfig: ChainConfig
): string | undefined {
  return Object.keys(chainConfig).find(
    (key) => chainConfig[key as keyof ChainConfig] === tokenAddress
  );
}

function getTokenAddress(
  tokenSymbol: string,
  chainConfig: ChainConfig
): Address | undefined {
  return chainConfig[tokenSymbol as keyof ChainConfig] as Address;
}

function getChainConfigs(
  sourceChainId: SupportedChainId,
  targetChainId: SupportedChainId
):
  | { sourceChainConfig: ChainConfig; targetChainConfig: ChainConfig }
  | undefined {
  const sourceChainConfig = getChainConfig(sourceChainId);
  const targetChainConfig = getChainConfig(targetChainId);

  if (!sourceChainConfig || !targetChainConfig) return;

  return { sourceChainConfig, targetChainConfig };
}

function getChainConfig(chainId: number): ChainConfig | undefined {
  return Object.values(chainIdMap).find((config) => config.chainId === chainId);
}
