import { ethers } from "ethers";

const ERC20_BALANCE_OF_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export function getErc20Contract(tokenAddress: string): ethers.Contract {
  return new ethers.Contract(tokenAddress, ERC20_BALANCE_OF_ABI);
}