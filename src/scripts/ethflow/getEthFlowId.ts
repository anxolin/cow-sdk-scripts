import {
  ETH_FLOW_ADDRESS,
  MAX_VALID_TO_EPOCH,
  OrderKind,
  OrderSigningUtils,
  SupportedChainId,
  WRAPPED_NATIVE_CURRENCIES,
} from "@cowprotocol/cow-sdk";

import { OrderBalance } from "@cowprotocol/contracts";
import { getExplorerUrl } from "../../utils";

export async function run() {
  const chainId = SupportedChainId.MAINNET;
  const originalOrder = {
    buyToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    receiver: "0x5dde7d9b46d1ae3338a3d9f7d6dc2f214738ed15",
    sellAmount: "1000000000000000",
    buyAmount: "1666409",
    appData:
      "0xec632b4acad3a229df259d7e20dbe1046eb56c9d31cc304ea6186c746a6a81e3",
    validTo: 1746218815, // Original valid to
    feeAmount: "0",
    kind: OrderKind.SELL,
    partiallyFillable: false,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,
  };

  const { orderId } = await OrderSigningUtils.generateOrderId(
    chainId,
    {
      ...originalOrder,
      validTo: MAX_VALID_TO_EPOCH,
      sellToken: WRAPPED_NATIVE_CURRENCIES[chainId].address,
    },
    {
      owner: ETH_FLOW_ADDRESS,
    }
  );

  console.log(`🎉 orderId: ${orderId}`);
  console.log(
    `See in explorer: https://explorer.cow.fi/orders/${orderId}?tab=overview`
  );
}
