import { QuoteResults, SupportedChainId } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import inquirer from "inquirer";

export async function getWallet(chainId: SupportedChainId) {
  const envName = `RPC_URL_${chainId}`;
  const rpcUrl = process.env[envName];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL found for chain ${chainId}. Please define env ${envName}`
    );
  }

  // Make sure the specified provider is for the correct chain
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const { chainId: providerChainId, name: providerName } =
    await provider.getNetwork();

  if (providerChainId !== chainId) {
    throw new Error(
      `Provider is not connected to chain ${chainId}. Provider is connected to chain ${providerChainId} (${providerName})`
    );
  }

  return new ethers.Wallet(getPk(), provider);
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
