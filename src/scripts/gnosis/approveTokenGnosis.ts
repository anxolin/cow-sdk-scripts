import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { approveTokenForTrading } from "../common/approveToken";
import { GNO_ADDRESS } from "../../const/gnosis";

export async function run() {
  await approveTokenForTrading(SupportedChainId.GNOSIS_CHAIN, GNO_ADDRESS);
}
