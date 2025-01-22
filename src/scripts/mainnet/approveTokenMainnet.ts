import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { approveTokenForTrading } from "../common/approveToken";
import { USDC_ADDRESS } from "../../const/mainnet";

export async function run() {
  await approveTokenForTrading(SupportedChainId.MAINNET, USDC_ADDRESS);
}
