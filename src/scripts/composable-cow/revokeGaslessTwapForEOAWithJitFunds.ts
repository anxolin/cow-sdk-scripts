import {
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderKind,
  SupportedChainId,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import { ComposableCowPoller, Twap } from "@cowprotocol/sdk-composable";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";
import { BigNumber, ethers } from "ethers";

import { APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { confirm, getRpcProvider, getWallet } from "../../utils";
import { getCowShedSdk } from "./cowShed";
import {
  getPermitTokenContract,
  optionalPermitCall,
  PERMIT_TYPES,
  SignedPermit,
} from "./optionalPermit";

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;
const SDAI = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";

export async function run(): Promise<void> {
  const broadcast = process.argv.includes("--broadcast");
  const provider = await getRpcProvider(CHAIN_ID);
  const funder = ethers.utils.getAddress(
    requiredEnv("FUNDER_ADDRESS"),
  ) as `0x${string}`;
  const pollerAddress = ethers.utils.getAddress(
    requiredEnv("COMPOSABLE_COW_POLLER_ADDRESS"),
  );
  const scheduleId = requiredBytes32("SCHEDULE_ID");
  const parentTwapId = requiredBytes32("PARENT_TWAP_ID");
  const wallet = await getWallet(CHAIN_ID);
  if (!areAddressesEqual(wallet.address, funder)) {
    throw new Error("PRIVATE_KEY does not match FUNDER_ADDRESS");
  }

  const adapter = new EthersV5Adapter({ provider, signer: wallet });
  setGlobalAdapter(adapter);
  const poller = new ComposableCowPoller(pollerAddress);
  const cowShedSdk = getCowShedSdk(adapter);
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, funder);
  const token = getPermitTokenContract(
    SDAI,
    new ethers.VoidSigner(funder, provider),
  );
  const [schedule, composableCow] = await Promise.all([
    poller.getSchedule(scheduleId, provider),
    poller.getComposableCowAddress(provider),
  ]);
  if (
    !areAddressesEqual(composableCow, COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID])
  ) {
    throw new Error(
      "Poller is configured for a different ComposableCoW contract",
    );
  }
  if (schedule.handler === ethers.constants.AddressZero) {
    throw new Error("Poller schedule is not active");
  }
  if (!areAddressesEqual(schedule.funder, funder)) {
    throw new Error("The configured funder does not own the Poller schedule");
  }
  if (!areAddressesEqual(schedule.owner, cowShed)) {
    throw new Error("The Poller schedule is not owned by the funder's CowShed");
  }
  const parentTwap = Twap.fromParams({
    handler: schedule.handler,
    salt: schedule.salt,
    staticInput: schedule.staticInput,
  });
  if (parentTwapId.toLowerCase() !== parentTwap.id.toLowerCase()) {
    throw new Error("PARENT_TWAP_ID does not match the Poller schedule");
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  console.log({
    mode: broadcast ? "broadcast" : "dry-run",
    scheduleId,
    parentTwapId,
    funder,
    cowShed,
    deadline: deadline.toString(),
  });
  if (!broadcast) {
    console.log("Dry-run complete: no signatures or submission.");
    return;
  }
  if (
    !(await confirm(
      "Sign two requests to revoke this JIT-funded TWAP, plus a permit if its Vault Relayer allowance is insufficient?",
    ))
  ) {
    return;
  }

  const [decimals, currentAllowance] = await Promise.all([
    token.decimals(),
    token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
  ]);
  // The revoke bundle encodes the current auth epoch, so re-check it before submission.
  const assertRevokeReplaySafe = async () => {
    const current = await poller.getSchedule(scheduleId, provider);
    if (
      current.handler === ethers.constants.AddressZero ||
      !BigNumber.from(current.authEpoch).eq(schedule.authEpoch)
    ) {
      throw new Error("Poller schedule changed before submission");
    }
  };

  // Required signature 1/2: CowShed revokes the Poller schedule and removes the parent
  // TWAP authorization. Being `proxyOf(funder)`, the shed needs no separate Poller
  // signature from the EOA.
  console.log("Required signature 1/2: CowShed revoke bundle");
  const call = (target: string, callData: string) => ({
    target,
    callData,
    value: 0n,
    isDelegateCall: false,
    allowFailure: false,
  });
  const bundle = await cowShedSdk.signCalls({
    chainId: CHAIN_ID,
    calls: [
      call(
        pollerAddress,
        poller.encodeRevokeFromShed(schedule),
      ),
      call(
        COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID],
        parentTwap.removeCalldata,
      ),
    ],
    deadline,
    signer: wallet,
    defaultGasLimit: 500_000n,
  });
  if (
    !areAddressesEqual(bundle.cowShedAccount, cowShed) ||
    bundle.signedMulticall.value !== 0n
  ) {
    throw new Error("CowShed SDK returned an unexpected revoke call");
  }

  const validTo = Number(deadline);

  // The revoke order still needs a Vault Relayer allowance. Its exact debit
  // (sell amount plus fee) is quote-dependent, so the permit is signed after a draft quote.
  const revokeOrderAppData = (signedPermit?: SignedPermit) => {
    const optionalPermit = signedPermit
      ? optionalPermitCall(SDAI, signedPermit)
      : undefined;
    return {
      appCode: APP_CODE,
      metadata: {
        hooks: {
          ...(optionalPermit
            ? {
                pre: [
                  {
                    target: optionalPermit.target,
                    callData: optionalPermit.callData,
                    gasLimit: "150000",
                  },
                ],
              }
            : {}),
          post: [
            {
              target: bundle.signedMulticall.to,
              callData: bundle.signedMulticall.data,
              gasLimit: bundle.gasLimit.toString(),
            },
          ],
        },
      },
    };
  };
  const trade = {
    kind: OrderKind.SELL,
    sellToken: SDAI,
    sellTokenDecimals: decimals,
    buyToken: SDAI,
    buyTokenDecimals: decimals,
    amount: ethers.utils.parseUnits("0.01", decimals).toString(),
    receiver: funder,
    owner: funder,
    partiallyFillable: false,
    slippageBps: 0,
  };
  const sdk = new TradingSdk(
    { chainId: CHAIN_ID, signer: wallet, appCode: APP_CODE },
    {},
    adapter,
  );
  await assertRevokeReplaySafe();
  const needsPermit = currentAllowance.lt(trade.amount);
  const createPermitContext = async () => {
    const [tokenName, tokenNonce] = await Promise.all([
      token.name(),
      token.nonces(funder),
    ]);
    const message = (value: BigNumber) => ({
      owner: funder,
      spender: COW_VAULT_RELAYER_CONTRACT,
      value: value.toString(),
      nonce: tokenNonce.toString(),
      deadline: deadline.toString(),
    });
    return {
      message,
      domain: {
        name: tokenName,
        version: process.env.SDAI_PERMIT_VERSION ?? "1",
        chainId: CHAIN_ID,
        verifyingContract: SDAI,
      },
      placeholder: {
        ...message(ethers.constants.Zero),
        v: 0,
        r: ethers.constants.HashZero,
        s: ethers.constants.HashZero,
      },
    };
  };
  const permitContext = needsPermit ? await createPermitContext() : undefined;
  const initialQuote = await sdk.getQuote(trade, {
    quoteRequest: { validTo },
    appData: revokeOrderAppData(permitContext?.placeholder),
  });
  const debit = BigNumber.from(
    initialQuote.quoteResults.orderToSign.sellAmount,
  ).add(initialQuote.quoteResults.orderToSign.feeAmount);
  if (!debit.eq(trade.amount)) {
    throw new Error("Revoke quote exceeds the requested debit");
  }
  let postSwapOrderFromQuote = initialQuote.postSwapOrderFromQuote;
  if (permitContext) {
    console.log("Optional signature 2/3: revoke-order permit");
    const message = permitContext.message(currentAllowance.add(debit));
    const permitSignature = ethers.utils.splitSignature(
      await wallet._signTypedData(permitContext.domain, PERMIT_TYPES, message),
    );
    const signedPermit = { ...message, ...permitSignature };
    // Rebuild with the permit hook. All economic fields must remain unchanged.
    const final = await sdk.getQuote(trade, {
      quoteRequest: { validTo },
      appData: revokeOrderAppData(signedPermit),
    });
    if (
      JSON.stringify({
        ...final.quoteResults.orderToSign,
        appData: undefined,
      }) !==
      JSON.stringify({
        ...initialQuote.quoteResults.orderToSign,
        appData: undefined,
      })
    ) {
      throw new Error("Final revoke quote differs from the permit draft");
    }
    postSwapOrderFromQuote = final.postSwapOrderFromQuote;
  } else {
    console.log(
      "Existing Vault Relayer allowance covers the revoke order; skipping permit signature.",
    );
  }
  await assertRevokeReplaySafe();

  console.log(
    needsPermit
      ? "Signature 3/3: hook-aware revoke order"
      : "Required signature 2/2: hook-aware revoke order",
  );
  const { orderId } = await postSwapOrderFromQuote();
  console.log(`Submitted: https://explorer.cow.fi/gc/orders/${orderId}`);
  console.warn(
    "Submission is not fulfillment. After settlement, clear the EOA's Poller allowance and withdraw any remaining sDAI from CowShed.",
  );
}

function requiredBytes32(name: string): string {
  const value = requiredEnv(name);
  if (!ethers.utils.isHexString(value, 32)) {
    throw new Error(`${name} must be a bytes32 hex string`);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
