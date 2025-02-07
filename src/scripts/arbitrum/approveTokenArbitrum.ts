import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { approveTokenForTrading } from "../common/approveToken";
import { USDC_ADDRESS } from "../../const/arbitrum";

export async function run() {
  await approveTokenForTrading(SupportedChainId.ARBITRUM_ONE, USDC_ADDRESS);
}
