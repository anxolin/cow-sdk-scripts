import "dotenv/config";

import {
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderKind,
  SupportedChainId,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import {
  ComposableCowPoller,
  type ComposableCowPollerSchedule,
  Twap,
} from "@cowprotocol/sdk-composable";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";
import { BigNumber, ethers } from "ethers";

import { APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { confirm, getRpcProvider, getWallet } from "../../utils";
import {
  COW_SHED_FACTORY_ADDRESS,
  getPollerCowShedSdk,
} from "./pollerCowShed";
import {
  assertPermitValid,
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
  const cowShedSdk = getPollerCowShedSdk(adapter);
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, funder);
  const token = getPermitTokenContract(
    SDAI,
    new ethers.VoidSigner(funder, provider),
  );
  const [schedule, composableCow] = await Promise.all([
    poller.getSchedule(scheduleId),
    poller.getComposableCowAddress(),
  ]);
  if (
    !areAddressesEqual(composableCow, COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID])
  ) {
    throw new Error(
      "Poller is configured for a different ComposableCoW contract",
    );
  }
  if (areAddressesEqual(schedule.funder, ethers.constants.AddressZero)) {
    throw new Error("Poller schedule does not exist");
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
    authEpoch: BigNumber.from(schedule.authEpoch).toString(),
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
      "Sign two required revoke requests, plus a permit only if the Vault Relayer allowance is insufficient?",
    ))
  ) {
    return;
  }

  const [decimals, currentAllowance, tokenNonce, tokenName] =
    await Promise.all([
      token.decimals(),
      token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
      token.nonces(funder),
      token.name(),
    ]);
  const revokeDebit = ethers.utils.parseUnits("0.01", decimals);
  const needsPermit = currentAllowance.lt(revokeDebit);
  const signatureCount = 2 + Number(needsPermit);
  let signatureNumber = 1;

  console.log(
    `Signature ${signatureNumber++}/${signatureCount}: CowShed revoke bundle`,
  );
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
    nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
    signer: wallet,
    defaultGasLimit: 500_000n,
  });
  if (
    !areAddressesEqual(bundle.cowShedAccount, cowShed) ||
    !areAddressesEqual(bundle.signedMulticall.to, COW_SHED_FACTORY_ADDRESS) ||
    bundle.signedMulticall.value !== 0n
  ) {
    throw new Error("CowShed SDK returned an unexpected revoke call");
  }

  const permitMessage = {
    owner: funder,
    spender: COW_VAULT_RELAYER_CONTRACT,
    value: revokeDebit.toString(),
    nonce: tokenNonce.toString(),
    deadline: deadline.toString(),
  };
  let signedPermit: SignedPermit | undefined;
  if (needsPermit) {
    console.log(
      `Signature ${signatureNumber++}/${signatureCount}: Vault Relayer permit`,
    );
    const permitSignature = ethers.utils.splitSignature(
      await wallet._signTypedData(
        {
          name: tokenName,
          version: process.env.SDAI_PERMIT_VERSION ?? "1",
          chainId: CHAIN_ID,
          verifyingContract: SDAI,
        },
        PERMIT_TYPES,
        permitMessage,
      ),
    );
    signedPermit = { ...permitMessage, ...permitSignature };
    await assertPermitValid(token, signedPermit);
  } else {
    console.log(
      "Existing Vault Relayer allowance covers the revoke order; skipping permit signature.",
    );
  }

  const revokeOrderAppData = (permit?: SignedPermit) => {
    const permitCall = permit ? optionalPermitCall(SDAI, permit) : undefined;
    return {
      appCode: APP_CODE,
      metadata: {
        hooks: {
          ...(permitCall
            ? {
                pre: [
                  {
                    target: permitCall.target,
                    callData: permitCall.callData,
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
    amount: revokeDebit.toString(),
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
  const assertScheduleFresh = async () => {
    const current = await poller.getSchedule(scheduleId);
    if (!sameSchedule(current, schedule)) {
      throw new Error(
        "Poller schedule changed before submission; rebuild and re-sign the revoke",
      );
    }
  };
  const assertPermitStateFresh = async () => {
    const [currentNonce, latestAllowance] = await Promise.all([
      token.nonces(funder),
      token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
    ]);
    if (needsPermit) {
      if (!currentNonce.eq(tokenNonce) || !latestAllowance.eq(currentAllowance)) {
        throw new Error(
          "Token permit state changed; rebuild and re-sign the revoke",
        );
      }
    } else if (latestAllowance.lt(revokeDebit)) {
      throw new Error(
        "Vault Relayer allowance became insufficient; rebuild the revoke",
      );
    }
  };

  await Promise.all([assertScheduleFresh(), assertPermitStateFresh()]);
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(trade, {
    quoteRequest: { validTo: Number(deadline) },
    appData: revokeOrderAppData(signedPermit),
  });
  const quotedDebit = BigNumber.from(quoteResults.orderToSign.sellAmount).add(
    quoteResults.orderToSign.feeAmount,
  );
  if (!quotedDebit.eq(revokeDebit)) {
    throw new Error("Revoke quote exceeds the permitted debit");
  }
  await Promise.all([assertScheduleFresh(), assertPermitStateFresh()]);

  console.log(
    `Signature ${signatureNumber}/${signatureCount}: hook-aware revoke order`,
  );
  const { orderId } = await postSwapOrderFromQuote();
  console.log(`Submitted: https://explorer.cow.fi/gc/orders/${orderId}`);
  console.warn(
    "Submission is not fulfillment. After settlement, clear the EOA's Poller allowance and withdraw any remaining sDAI from CowShed.",
  );
}

function sameSchedule(
  left: ComposableCowPollerSchedule,
  right: ComposableCowPollerSchedule,
): boolean {
  return (
    areAddressesEqual(left.handler, right.handler) &&
    BigNumber.from(left.authEpoch).eq(right.authEpoch) &&
    areAddressesEqual(left.funder, right.funder) &&
    areAddressesEqual(left.owner, right.owner) &&
    left.salt.toLowerCase() === right.salt.toLowerCase() &&
    left.staticInput.toLowerCase() === right.staticInput.toLowerCase()
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
