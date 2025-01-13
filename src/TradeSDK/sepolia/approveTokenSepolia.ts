import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { approveTokenForTrading } from "../common/approveToken";
import { WETH_ADDRESS } from "../../const/sepolia";

export async function run() {
  await approveTokenForTrading(SupportedChainId.SEPOLIA, WETH_ADDRESS);
}
