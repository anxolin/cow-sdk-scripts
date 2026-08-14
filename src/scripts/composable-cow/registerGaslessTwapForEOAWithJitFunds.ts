import { MetadataApi } from "@cowprotocol/app-data";
import {
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderBookApi,
  OrderKind,
  SupportedChainId,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import { Twap } from "@cowprotocol/sdk-composable";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";
import { BigNumber, ethers } from "ethers";

import { APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { confirm, getRpcProvider, getWallet } from "../../utils";
import { getCowShedSdk } from "./cowShed";
import {
  encodePollFunds,
  encodeRegisterFromShed,
  getComposableCowPollerContract,
  scheduleId as deriveScheduleId,
} from "../../contracts/composable-cow-poller";
import {
  getPermitTokenContract,
  optionalPermitCall,
  PERMIT_TYPES,
  permitValueForDebit,
  SignedPermit,
} from "./optionalPermit";

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;
const SDAI = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const COW = "0x177127622c4A00F3d409B75571e12cB3c8973d3c";
const TWAP_HANDLER = "0x6cF1e9cA41f7611dEf408122793c358a3d11E5a5";
const TWAP_PARTS = 2;

export async function run(): Promise<void> {
  const broadcast = process.argv.includes("--broadcast");
  const provider = await getRpcProvider(CHAIN_ID);
  const funder = ethers.utils.getAddress(
    requiredEnv("FUNDER_ADDRESS"),
  ) as `0x${string}`;
  const pollerAddress = ethers.utils.getAddress(
    requiredEnv("COMPOSABLE_COW_POLLER_ADDRESS"),
  );

  const wallet = await getWallet(CHAIN_ID);
  if (!areAddressesEqual(wallet.address, funder)) {
    throw new Error("PRIVATE_KEY does not match FUNDER_ADDRESS");
  }
  const adapter = new EthersV5Adapter({ provider, signer: wallet });
  setGlobalAdapter(adapter);
  const poller = getComposableCowPollerContract(pollerAddress, provider);

  const token = getPermitTokenContract(
    SDAI,
    new ethers.VoidSigner(funder, provider),
  );
  const cowShedSdk = getCowShedSdk(adapter);
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, funder);
  const [decimals, currentPollerAllowance, composableCow, pollerShedFactory] =
    await Promise.all([
      token.decimals(),
      token.allowance(funder, pollerAddress),
      poller.COMPOSABLE_COW(),
      poller.COW_SHED_FACTORY(),
    ]);
  if (
    !areAddressesEqual(composableCow, COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID])
  ) {
    throw new Error(
      "Poller is configured for a different ComposableCoW contract",
    );
  }
  // The Poller only accepts registrations from `proxyOf(funder)` on the factory it pins,
  // so a mismatch here would fail on-chain with UnauthorizedShed.
  const shedFromPollerFactory = await new ethers.Contract(
    pollerShedFactory,
    ["function proxyOf(address owner) view returns (address)"],
    provider,
  ).proxyOf(funder);
  if (!areAddressesEqual(shedFromPollerFactory, cowShed)) {
    throw new Error(
      `Poller pins CowShed factory ${pollerShedFactory}, which derives ${shedFromPollerFactory} for this funder, not ${cowShed}`,
    );
  }
  const fullSellAmount = ethers.utils.parseUnits("0.2", decimals);

  const salt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  // The ID excludes appData, so pollFunds(id) can be embedded in the TWAP's own
  // appData without creating a circular hash dependency.
  const scheduleKey = {
    handler: TWAP_HANDLER,
    funder,
    owner: cowShed,
    salt,
  };
  const scheduleId = deriveScheduleId(scheduleKey);
  // Cross-check the local derivation against the deployment we are about to use.
  const onchainScheduleId = await poller.scheduleId({
    ...scheduleKey,
    staticInput: "0x",
  });
  if (onchainScheduleId.toLowerCase() !== scheduleId.toLowerCase()) {
    throw new Error("Local scheduleId derivation disagrees with the Poller");
  }
  // Schedule keys are single-use: once registered or revoked, the key is burned forever and
  // re-registering needs a new salt. A fresh random salt makes a clash implausible, but the
  // key can also be burned deliberately by a revoke, so check before and after signing.
  const assertScheduleKeyFree = async () => {
    const { funder: usedBy } = await poller.schedules(scheduleId);
    if (usedBy !== ethers.constants.AddressZero) {
      throw new Error(
        `Schedule key ${scheduleId} is already used; rebuild with a fresh salt`,
      );
    }
  };

  const metadataApi = new MetadataApi();
  const twapAppData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    environment: "prod",
    metadata: {
      hooks: {
        pre: [
          {
            target: pollerAddress,
            callData: encodePollFunds(scheduleId),
            gasLimit: "350000",
          },
        ],
      },
    },
  });
  const { appDataContent, appDataHex } =
    await metadataApi.getAppDataInfo(twapAppData);
  const partBuyAmount = BigNumber.from(requiredEnv("TWAP_MIN_PART_BUY_AMOUNT"));

  // CowShed owns the parent TWAP, while bought COW still goes to the EOA.
  const twap = Twap.fromData(
    {
      receiver: funder,
      sellAmount: fullSellAmount.toBigInt(),
      buyAmount: partBuyAmount.mul(TWAP_PARTS).toBigInt(),
      numberOfParts: BigInt(TWAP_PARTS),
      timeBetweenParts: 120n,
      sellToken: SDAI,
      buyToken: COW,
      appData: appDataHex,
    },
    salt,
  );
  const schedule = {
    ...twap.leaf,
    funder,
    owner: cowShed,
  };
  const validTo = Math.floor(Date.now() / 1000) + 1800;
  // This small same-token order only carries the setup hooks. The EOA keeps the
  // TWAP sell funds until pollFunds pulls each part just before settlement.
  const setupTrade = {
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
  const [currentVaultAllowance, baseNonce, tokenName] = await Promise.all([
    token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
    token.nonces(funder),
    token.name(),
  ]);
  const setupNonce = baseNonce.toBigInt();
  // The setup-order permit consumes nonce N in its pre-hook. The Poller permit
  // executes later inside CowShed, so it must use nonce N+1.
  const domain = {
    name: tokenName,
    version: process.env.SDAI_PERMIT_VERSION ?? "1",
    chainId: CHAIN_ID,
    verifyingContract: SDAI,
  };
  const permit = (spender: string, value: bigint, nonce: bigint) => ({
    owner: funder,
    spender,
    value: value.toString(),
    nonce: nonce.toString(),
    deadline: validTo.toString(),
  });
  const pollerPermit = permit(
    pollerAddress,
    permitValueForDebit(currentPollerAllowance, fullSellAmount).toBigInt(),
    setupNonce + 1n,
  );

  const needsPollerPermit = currentPollerAllowance.lt(fullSellAmount);
  const needsVaultPermit = currentVaultAllowance.lt(
    BigNumber.from(setupTrade.amount),
  );
  // Registration now rides inside the CowShed bundle, so there is no separate Poller
  // signature. What is left is the bundle, the setup order, and permits only when an
  // allowance is actually short.
  const steps = [
    ...(needsPollerPermit
      ? [
          `Permit Poller to pull ${ethers.utils.formatUnits(fullSellAmount, decimals)} sDAI when needed.`,
        ]
      : []),
    "Sign the CowShed setup bundle (registers the schedule, approves VaultRelayer, creates the TWAP).",
    ...(needsVaultPermit
      ? ["Permit the setup order's VaultRelayer debit."]
      : []),
    "Sign and submit the setup order.",
  ];
  const signatureCount = steps.length;
  console.log(`Gasless JIT TWAP registration:
${steps.map((step, index) => `  ${index + 1}. ${step}`).join("\n")}

After setup settles, each TWAP part calls pollFunds(${scheduleId}) before settlement.`);
  console.log({
    mode: broadcast ? "broadcast" : "dry-run",
    funder,
    cowShed,
    pollerAddress,
    pollerShedFactory,
    scheduleId,
    parentTwapId: twap.id,
    signatureCount,
    needsPollerPermit,
    needsVaultPermit,
    pollerPermit: needsPollerPermit ? pollerPermit : undefined,
    twap: twap.leaf,
  });
  // Prove the exact registration calldata the bundle will carry is accepted, by eth_call-ing
  // it as the shed. Nothing is signed or sent; a revert here means the bundle would fail.
  const registerCallData = encodeRegisterFromShed(schedule);
  try {
    const returned = await provider.call({
      from: cowShed,
      to: pollerAddress,
      data: registerCallData,
    });
    console.log(
      `Simulated registerFromShed as the CowShed: returns ${returned}` +
        (returned.endsWith(scheduleId.slice(2)) ? " (matches scheduleId)" : ""),
    );
  } catch (error) {
    throw new Error(
      `registerFromShed would revert when called by ${cowShed}: ${(error as Error).message}`,
    );
  }

  if (!broadcast) {
    console.log("Dry-run complete: no signatures or submission.");
    return;
  }
  if (
    !(await confirm(
      `Sign ${signatureCount} setup requests, valid until ${new Date(validTo * 1000).toISOString()}?`,
    ))
  ) {
    return;
  }

  await new OrderBookApi({ chainId: CHAIN_ID }).uploadAppData(
    appDataHex,
    appDataContent,
  );
  const sdk = new TradingSdk(
    { chainId: CHAIN_ID, signer: wallet, appCode: APP_CODE },
    {},
    adapter,
  );
  const signPermit = async (
    message: ReturnType<typeof permit>,
    number: number,
  ) => {
    console.log(
      `Signature ${number}/${signatureCount}: ${message.spender} permit`,
    );
    const signature = await wallet._signTypedData(
      domain,
      PERMIT_TYPES,
      message,
    );
    return { ...message, ...ethers.utils.splitSignature(signature) };
  };
  // If needed, let the Poller pull each TWAP part from the EOA just in time.
  let signatureNumber = 0;
  const signedPollerPermit = needsPollerPermit
    ? await signPermit(pollerPermit, ++signatureNumber)
    : undefined;
  const optionalPollerPermit = signedPollerPermit
    ? optionalPermitCall(SDAI, signedPollerPermit)
    : undefined;
  // Authorize the exact CowShed setup calls embedded below. This one signature now also
  // authorizes the Poller registration: the shed is `proxyOf(funder)`, so the Poller
  // treats a call from it as the funder's own.
  console.log(
    `Signature ${++signatureNumber}/${signatureCount}: CowShed setup bundle`,
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
      ...(optionalPollerPermit
        ? [call(optionalPollerPermit.target, optionalPollerPermit.callData)]
        : []),
      call(pollerAddress, encodeRegisterFromShed(schedule)),
      call(
        SDAI,
        token.interface.encodeFunctionData("approve", [
          COW_VAULT_RELAYER_CONTRACT,
          fullSellAmount,
        ]),
      ),
      call(COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID], twap.createCalldata),
    ],
    deadline: BigInt(validTo),
    signer: wallet,
    defaultGasLimit: 1_000_000n,
  });
  if (
    !areAddressesEqual(bundle.cowShedAccount, cowShed) ||
    bundle.signedMulticall.value !== 0n
  ) {
    throw new Error("CowShed SDK returned an unexpected setup call");
  }

  const setupOrderAppData = (signedPermit?: SignedPermit) => {
    const optionalSetupPermit = signedPermit
      ? optionalPermitCall(SDAI, signedPermit)
      : undefined;
    return {
      appCode: APP_CODE,
      metadata: {
        hooks: {
          ...(optionalSetupPermit
            ? {
                pre: [
                  {
                    target: optionalSetupPermit.target,
                    callData: optionalSetupPermit.callData,
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
  // A placeholder keeps the appData shape identical between the draft and final quotes,
  // so the fee the permit must cover is the fee the order is actually signed for.
  const placeholderSetupPermit = needsVaultPermit
    ? {
        ...permit(COW_VAULT_RELAYER_CONTRACT, 0n, setupNonce),
        v: 0,
        r: ethers.constants.HashZero,
        s: ethers.constants.HashZero,
      }
    : undefined;
  await assertScheduleKeyFree();
  const { quoteResults: draftQuote } = await sdk.getQuote(setupTrade, {
    quoteRequest: { validTo },
    appData: setupOrderAppData(placeholderSetupPermit),
  });
  const setupDebit = BigNumber.from(draftQuote.orderToSign.sellAmount).add(
    draftQuote.orderToSign.feeAmount,
  );
  if (!setupDebit.eq(setupTrade.amount)) {
    throw new Error("Setup quote exceeds the requested debit");
  }
  const signedSetupPermit = needsVaultPermit
    ? await signPermit(
        permit(
          COW_VAULT_RELAYER_CONTRACT,
          permitValueForDebit(currentVaultAllowance, setupDebit).toBigInt(),
          setupNonce,
        ),
        ++signatureNumber,
      )
    : undefined;
  console.warn(
    `Warning: signatures 1-${signatureCount - 1} become executable when the final quote is requested.`,
  );
  const { quoteResults: finalQuote, postSwapOrderFromQuote } =
    await sdk.getQuote(setupTrade, {
      quoteRequest: { validTo },
      appData: setupOrderAppData(signedSetupPermit),
    });
  if (
    JSON.stringify({ ...finalQuote.orderToSign, appData: undefined }) !==
    JSON.stringify({ ...draftQuote.orderToSign, appData: undefined })
  ) {
    throw new Error("Final setup quote differs from the signed permit draft");
  }
  await assertScheduleKeyFree();

  console.log(
    `Signature ${++signatureNumber}/${signatureCount}: hook-aware setup order`,
  );
  const { orderId } = await postSwapOrderFromQuote();
  console.log(`Submitted: https://explorer.cow.fi/gc/orders/${orderId}`);
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
