import { ethers } from "ethers";
import { getPk } from "../../common/utils";
import { sepolia } from "../../const";
const { WETH_ADDRESS, COW_VAULT_RELAYER_CONTRACT } = sepolia;

const MAX_ALLOWANCE = ethers.constants.MaxUint256;
const WETH_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export async function run() {
  console.log("Approve WETH");
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(getPk(), provider);

  // Approve WETH
  const weth = new ethers.Contract(
    // WETH (Sepolia)
    WETH_ADDRESS,
    // ABI
    WETH_ABI,
    // signer
    wallet
  );

  // Estimate gas
  const gasLimit = await weth.estimateGas.approve(
    COW_VAULT_RELAYER_CONTRACT,
    MAX_ALLOWANCE
  );

  // Approve Vault Relayer for WETH
  console.log(
    `Approve WETH from ${wallet.address} for vault relayer contract (${COW_VAULT_RELAYER_CONTRACT}), using allowance of ${MAX_ALLOWANCE} and ${gasLimit} gas limit`
  );
  const tx = await weth.approve(
    COW_VAULT_RELAYER_CONTRACT,
    // ethers max uint256
    MAX_ALLOWANCE,
    {
      gasLimit,
    }
  );

  console.log("Approve WETH tx: ", tx.hash);
  // console.log("tx details ", tx);

  console.log("Waiting for 1 confirmation...");
  const receipt = await tx.wait(1);
  console.log(
    `Transaction confirmed in block: ${receipt.blockNumber}. See https://sepolia.etherscan.io/tx/${tx.hash}`
  );
}
