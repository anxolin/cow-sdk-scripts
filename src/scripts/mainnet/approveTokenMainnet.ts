import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { approveTokenForTrading } from "../common/approveToken";
import { DAI_ADDRESS, USDC_ADDRESS } from "../../const/mainnet";

export async function run() {
  await approveTokenForTrading(SupportedChainId.MAINNET, DAI_ADDRESS);
  await approveTokenForTrading(SupportedChainId.MAINNET, USDC_ADDRESS);
}
