import {
  QuoteResults,
  SupportedChainId,
  TargetChainId,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import inquirer from "inquirer";

const PROVIDERS_CACHE: Partial<
  Record<TargetChainId, ethers.providers.JsonRpcProvider>
> = {};

export async function getRpcProvider(chainId: TargetChainId) {
  if (PROVIDERS_CACHE[chainId]) {
    return PROVIDERS_CACHE[chainId];
  }

  const envName = `RPC_URL_${chainId}`;
  const rpcUrl = process.env[envName];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL found for chain ${chainId}. Please define env ${envName}`
    );
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Make sure the specified provider is for the correct chain
  const { chainId: providerChainId, name: providerName } =
    await provider.getNetwork();

  if (providerChainId !== chainId) {
    throw new Error(
      `Provider is not connected to chain ${chainId}. Provider is connected to chain ${providerChainId} (${providerName})`
    );
  }

  PROVIDERS_CACHE[chainId] = provider;
  return provider;
}

export async function getWallet(chainId: SupportedChainId) {
  return new ethers.Wallet(getPk(), await getRpcProvider(chainId));
}

export function getPk() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error("PRIVATE_KEY is not set");
  }

  return pk;
}

export async function confirm(message: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: false,
    },
  ]);

  return confirmed;
}

export const jsonReplacer = (key: string, value: any) => {
  // Handle BigInt
  if (typeof value === "bigint") {
    return value.toString();
  }
  // Handle BigNumber (if you're using ethers.BigNumber)
  if (value?._isBigNumber) {
    return value.toString();
  }
  return value;
};

export function printQuote(quoteResults: QuoteResults) {
  console.log(`\n📉 Suggested slippage: ${quoteResults.suggestedSlippageBps}`);

  console.log(
    "\n🤝 Quote: ",
    JSON.stringify(quoteResults.quoteResponse, jsonReplacer, 2)
  );
  console.log(
    "\n💰 Amounts and costs: ",
    JSON.stringify(quoteResults.amountsAndCosts, jsonReplacer, 2)
  );
  console.log(
    "\n💿 App Data: ",
    JSON.stringify(quoteResults.appDataInfo, jsonReplacer, 2)
  );

  console.log(
    "\n✍️ Order to sign: ",
    JSON.stringify(quoteResults.orderToSign, jsonReplacer, 2)
  );

  console.log(
    "\n📝 Order Typed Data: ",
    JSON.stringify(quoteResults.orderTypedData, jsonReplacer, 2)
  );
}

export function getExplorerUrl(chainId: SupportedChainId, txHash: string) {
  if (chainId === SupportedChainId.MAINNET) {
    return `https://etherscan.io/tx/${txHash}`;
  }
  if (chainId === SupportedChainId.SEPOLIA) {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (chainId === SupportedChainId.GNOSIS_CHAIN) {
    return `https://gnosisscan.io/tx/${txHash}`;
  }

  if (chainId === SupportedChainId.ARBITRUM_ONE) {
    return `https://arbiscan.io/tx/${txHash}`;
  }

  if (chainId === SupportedChainId.BASE) {
    return `https://basescan.org/tx/${txHash}`;
  }

  throw new Error(`Unsupported Explorer for chainId ${chainId}`);
}

export function predictDeterministicAddress(params: {
  implementation: string;
  salt: string;
  factoryAddress: string;
}): string {
  const { implementation, salt, factoryAddress } = params;
  // EIP-1167 minimal proxy creation code
  const creationCode =
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" +
    implementation.slice(2) +
    "5af43d82803e903d91602b57fd5bf3";

  // CREATE2 formula: keccak256(0xff ++ address ++ salt ++ keccak256(creationCode))
  const initCodeHash = ethers.utils.keccak256(creationCode);

  const packed = ethers.utils.solidityPack(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factoryAddress, salt, initCodeHash]
  );

  const hash = ethers.utils.keccak256(packed);

  // Return last 20 bytes (40 characters) as address
  return ethers.utils.getAddress("0x" + hash.slice(-40));
}
