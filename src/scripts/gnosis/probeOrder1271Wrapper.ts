import {
  MetadataApi,
  OrderBookApi,
  OrderQuoteSideKindSell,
  SigningScheme,
  SupportedChainId,
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { gnosis, APP_CODE } from "../../const";
import { getWallet } from "../../utils";

const { WXDAI_ADDRESS, GNO_ADDRESS } = gnosis;

/**
 * Step 2 of the "enforceable hooks / wrapper" investigation — the make-or-break gate.
 *
 * QUESTION: will the CoW orderbook accept an order whose owner is an EIP-1271 contract that does
 * NOT return the magic value at post time (it would only "bless" the digest during settlement),
 * *when* the order carries `metadata.wrappers`? If yes, the whole "wrapper blesses at settlement"
 * design is viable; if it's rejected at submission, it isn't.
 *
 * We deploy a minimal `Mock1271Signer` on Gnosis whose `isValidSignature` returns magic only when
 * `valid == true`. With `valid == false` it mimics an unblessed shed (invalid at post). We then
 * post three orders owned by it and compare:
 *   A) valid=false, NO wrappers   → expected REJECT (baseline: orderbook validates 1271 at post)
 *   B) valid=false, WITH wrappers → THE QUESTION (does the orderbook defer validation?)
 *   C) valid=true,  WITH wrappers → expected ACCEPT (sanity: 1271 + wrappers posting works)
 *
 * Env: PRIVATE_KEY, RPC_URL_100. The signer needs a little xDAI (deploys the stub). Set MOCK_1271
 * to reuse an already-deployed stub and skip deployment.
 */

const CHAIN = SupportedChainId.GNOSIS_CHAIN;
const SELL_AMOUNT = ethers.utils.parseUnits("1", 18).toString(); // 1 WXDAI

// Placeholder wrapper address (reference CoWSafeWrapper); ours isn't deployed/allowlisted. We only
// test orderbook acceptance here, not an actual fill.
const WRAPPER_ADDRESS = "0x531636e6e18F3A52c283aCCda39D7185E4597A37";

// Mock1271Signer (compiled with foundry 0.8.30): isValidSignature returns 0x1626ba7e iff valid.
const MOCK_1271_BYTECODE =
  "0x6080806040523460155761019a908161001a8239f35b5f80fdfe608080604052600436101561001c575b50361561001a575f80fd5b005b5f3560e01c9081631626ba7e146100f7575080636c64edee1461008c5763c199121914610049575f61000f565b34610088575f7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261008857602060ff5f54166040519015158152f35b5f80fd5b346100885760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610088576004358015158091036100885760ff7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff005f54169116175f555f80f35b346100885760407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126100885760243567ffffffffffffffff8111610088573660238201121561008857806004013567ffffffffffffffff811161008857369101602401116100885760209060ff5f54165f14610195577f1626ba7e000000000000000000000000000000000000000000000000000000008152f35b5f8152f3";
const MOCK_1271_ABI = [
  "function isValidSignature(bytes32, bytes) view returns (bytes4)",
  "function setValid(bool v)",
  "function valid() view returns (bool)",
];

const metadataApi = new MetadataApi();
const orderBookApi = new OrderBookApi({ chainId: CHAIN });

async function buildAppData(withWrappers: boolean) {
  const doc = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: withWrappers
      ? { wrappers: [{ address: WRAPPER_ADDRESS, data: "0x", is_omittable: false }] }
      : {},
  });
  const { appDataContent, appDataHex } = await metadataApi.getAppDataInfo(doc);
  return { appData: appDataContent, appDataHash: appDataHex };
}

async function probe(label: string, owner: string, withWrappers: boolean) {
  const { appData, appDataHash } = await buildAppData(withWrappers);
  try {
    // Quote (no signature needed for a quote)
    const { quote } = await orderBookApi.getQuote({
      sellToken: WXDAI_ADDRESS,
      buyToken: GNO_ADDRESS,
      from: owner,
      receiver: owner,
      sellAmountBeforeFee: SELL_AMOUNT,
      kind: OrderQuoteSideKindSell.SELL,
      signingScheme: SigningScheme.EIP1271,
      appData,
      appDataHash,
    } as any);

    // Post as a 1271 order: owner is the stub; the signature blob is unused by the stub.
    const orderId = await orderBookApi.sendOrder({
      ...quote,
      sellAmount: (BigInt(quote.sellAmount) + BigInt(quote.feeAmount)).toString(),
      feeAmount: "0",
      from: owner,
      receiver: owner,
      appData,
      appDataHash,
      signingScheme: SigningScheme.EIP1271,
      signature: "0x",
    } as any);

    console.log(`✅ ${label}\n   ACCEPTED -> https://explorer.cow.fi/gc/orders/${orderId}`);
  } catch (e: any) {
    const body = e?.body ?? e?.response?.data ?? e?.message;
    console.log(`❌ ${label}\n   REJECTED -> ${JSON.stringify(body)}`);
  }
}

export async function run() {
  const wallet = await getWallet(CHAIN);

  let stubAddress = process.env.MOCK_1271;
  const stub = new ethers.Contract(stubAddress ?? ethers.constants.AddressZero, MOCK_1271_ABI, wallet);
  if (!stubAddress) {
    console.log("Deploying Mock1271Signer...");
    const factory = new ethers.ContractFactory(MOCK_1271_ABI, MOCK_1271_BYTECODE, wallet);
    const deployed = await factory.deploy();
    await deployed.deployed();
    stubAddress = deployed.address;
    console.log(`Mock1271Signer deployed: ${stubAddress}`);
  } else {
    console.log(`Reusing Mock1271Signer: ${stubAddress}`);
  }
  const signer = stub.attach(stubAddress);

  // Ensure valid=false (mimics an unblessed shed)
  await (await signer.setValid(false)).wait();
  await probe("A) valid=false, NO wrappers (baseline, expect REJECT)", stubAddress, false);
  await probe("B) valid=false, WITH wrappers (THE QUESTION)", stubAddress, true);

  // Baseline: make the signature valid
  await (await signer.setValid(true)).wait();
  await probe("C) valid=true, WITH wrappers (sanity, expect ACCEPT)", stubAddress, true);
}
