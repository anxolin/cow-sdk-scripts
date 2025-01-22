import { sepolia, APP_CODE } from "../../const";
const { WETH_ADDRESS, COW_ADDRESS } = sepolia;
import {
  SupportedChainId,
  OrderKind,
  TradeParameters,
  TradingSdk,
  SwapAdvancedSettings,
  SigningScheme,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { getExplorerUrl, getWallet, jsonReplacer } from "../../utils";

export async function run() {
  const wallet = await getWallet(SupportedChainId.SEPOLIA);

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: SupportedChainId.SEPOLIA,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Define trade parameters
  console.log("Presign (for smart contract wallet, typically)");
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: ethers.utils.parseUnits("0.1", 18).toString(), // 0.1 WETH
    sellToken: WETH_ADDRESS,
    sellTokenDecimals: 18,
    buyToken: COW_ADDRESS, // For COW
    buyTokenDecimals: 18,
    slippageBps: 50,
  };

  const advancedParameters: SwapAdvancedSettings = {
    quoteRequest: {
      // Specify the signing scheme
      signingScheme: SigningScheme.PRESIGN,
    },
  };

  // Specify the smart contract (works with EOA too, but there's no much point on doing that, other than for this test)
  const smartContractWalletAddress = wallet.address; // Pretend the EOA is the Smart Contract Wallet, normally it won't be
  console.log(
    "\n1. In pre-sign flow, we first post the order (but the order is not signed yet)"
  );
  const orderId = await sdk.postSwapOrder(parameters, advancedParameters);
  console.log(
    `Order created, id: https://explorer.cow.fi/sepolia/orders/${orderId}?tab=overview`
  );

  console.log(
    "\n2. We get the pre-sign unsigned transaction (transaction that if executed, would sign the order with the smart contract wallet)"
  );
  const preSignTransaction = await sdk.getPreSignTransaction({
    orderId,
    account: smartContractWalletAddress,
  });
  console.log(
    `Pre-sign unsigned transaction: ${JSON.stringify(
      preSignTransaction,
      jsonReplacer,
      2
    )}`
  );

  // Send tx using ethers
  console.log("\n3. Sign and send to Ethereum the pre-sign transaction");
  const tx = await wallet.sendTransaction({
    data: preSignTransaction.data,
    to: preSignTransaction.to,
    value: preSignTransaction.value,
    gasLimit: preSignTransaction.gas,
  });
  console.log(`Sent tx: ${tx.hash}`);

  // Wait for the tx to be mined
  console.log("\n4. Wait for the tx to be mined");
  const receipt = await tx.wait(1);
  console.log(
    `Transaction confirmed in block: ${
      receipt.blockNumber
    }. See ${getExplorerUrl(SupportedChainId.SEPOLIA, tx.hash)}`
  );
}
