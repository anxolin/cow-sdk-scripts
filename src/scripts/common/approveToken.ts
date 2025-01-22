import { ethers } from "ethers";
import { getExplorerUrl, getWallet } from "../../utils";
import { sepolia, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { SupportedChainId } from "@cowprotocol/cow-sdk";

const MAX_ALLOWANCE = ethers.constants.MaxUint256;
const ERC20_APPROVAL_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export async function approveTokenForTrading(
  chainId: SupportedChainId,
  tokenAddress: string
) {
  const wallet = await getWallet(chainId);

  // Approve token
  const token = new ethers.Contract(tokenAddress, ERC20_APPROVAL_ABI, wallet);

  // Estimate gas
  const gasLimit = await token.estimateGas.approve(
    COW_VAULT_RELAYER_CONTRACT,
    MAX_ALLOWANCE
  );

  // Approve Vault Relayer for WETH
  console.log(
    `Approve token ${tokenAddress}. Owner=${wallet.address}, spender=${COW_VAULT_RELAYER_CONTRACT}(vault relayer contract), Allowance=${MAX_ALLOWANCE} (max uint256), gasLimit=${gasLimit}`
  );
  const tx = await token.approve(
    COW_VAULT_RELAYER_CONTRACT,
    // ethers max uint256
    MAX_ALLOWANCE,
    {
      gasLimit,
    }
  );

  console.log("Approve tx: ", tx.hash);
  // console.log("tx details ", tx);

  console.log("Waiting for 1 confirmation...");
  const receipt = await tx.wait(1);
  console.log(
    `Transaction confirmed in block: ${
      receipt.blockNumber
    }. See ${getExplorerUrl(chainId, tx.hash)}`
  );
}
