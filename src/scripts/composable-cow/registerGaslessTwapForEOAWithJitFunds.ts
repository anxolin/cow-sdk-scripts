import "dotenv/config";

import { MetadataApi } from "@cowprotocol/sdk-app-data";
import {
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderBookApi,
  OrderKind,
  SupportedChainId,
  TradingSdk,
} from "@cowprotocol/cow-sdk";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import {
  ComposableCowPoller,
  TWAP_ADDRESS,
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
} from "./optionalPermit";

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;
const SDAI = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const COW = "0x177127622c4A00F3d409B75571e12cB3c8973d3c";
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
  const poller = new ComposableCowPoller(pollerAddress);
  const token = getPermitTokenContract(
    SDAI,
    new ethers.VoidSigner(funder, provider),
  );
  const cowShedSdk = getPollerCowShedSdk(adapter);
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, funder);
  const [decimals, composableCow, pollerCowShedFactory] = await Promise.all([
    token.decimals(),
    poller.getComposableCowAddress(),
    poller.getCowShedFactoryAddress(),
  ]);
  if (
    !areAddressesEqual(composableCow, COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID])
  ) {
    throw new Error(
      "Poller is configured for a different ComposableCoW contract",
    );
  }
  if (!areAddressesEqual(pollerCowShedFactory, COW_SHED_FACTORY_ADDRESS)) {
    throw new Error(
      "Poller COW_SHED_FACTORY does not match this script's CowShed factory",
    );
  }

  const fullSellAmount = ethers.utils.parseUnits("0.2", decimals);
  const salt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const scheduleId = poller.getScheduleId({
    handler: TWAP_ADDRESS,
    funder,
    owner: cowShed,
    salt,
  });

  // The ID excludes appData, so pollFunds(id) can be embedded in the TWAP's
  // own appData without creating a circular hash dependency.
  const metadataApi = new MetadataApi();
  const twapAppData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    environment: "prod",
    metadata: {
      hooks: {
        pre: [
          {
            target: pollerAddress,
            callData: poller.encodePollFunds(scheduleId),
            gasLimit: "350000",
          },
        ],
      },
    },
  });
  const { appDataContent, appDataHex } =
    await metadataApi.getAppDataInfo(twapAppData);
  const partBuyAmount = BigNumber.from(requiredEnv("TWAP_MIN_PART_BUY_AMOUNT"));
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
  const storedSchedule = await poller.getSchedule(scheduleId);
  if (!areAddressesEqual(storedSchedule.funder, ethers.constants.AddressZero)) {
    throw new Error("Poller schedule is already registered");
  }
  const schedule = {
    ...twap.leaf,
    authEpoch: storedSchedule.authEpoch,
    funder,
    owner: cowShed,
  };
  const validTo = Math.floor(Date.now() / 1000) + 1800;
  const setupDebit = ethers.utils.parseUnits("0.01", decimals);
  const setupTrade = {
    kind: OrderKind.SELL,
    sellToken: SDAI,
    sellTokenDecimals: decimals,
    buyToken: SDAI,
    buyTokenDecimals: decimals,
    amount: setupDebit.toString(),
    receiver: funder,
    owner: funder,
    partiallyFillable: false,
    slippageBps: 0,
  };

  console.log({
    mode: broadcast ? "broadcast" : "dry-run",
    funder,
    cowShed,
    scheduleId,
    authEpoch: BigNumber.from(schedule.authEpoch).toString(),
    parentTwapId: twap.id,
    twap: twap.leaf,
  });
  if (!broadcast) {
    console.log("Dry-run complete: no signatures or submission.");
    return;
  }
  if (
    !(await confirm(
      `Sign two required setup requests, plus any allowance permits, valid until ${new Date(validTo * 1000).toISOString()}?`,
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

  // Capture permit state immediately before signing. The setup permit executes
  // in the order's pre-hook; the Poller permit executes later in the post-hook.
  const [pollerAllowance, vaultAllowance, tokenNonce, tokenName] =
    await Promise.all([
      token.allowance(funder, pollerAddress),
      token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
      token.nonces(funder),
      token.name(),
    ]);
  const maxAllowance = ethers.constants.MaxUint256;
  // Add this schedule's full notional without consuming capacity reserved for
  // other active schedules. An unlimited allowance needs no new permit.
  const needsPollerPermit = !pollerAllowance.eq(maxAllowance);
  const needsSetupPermit = vaultAllowance.lt(setupDebit);
  const signatureCount =
    2 + Number(needsPollerPermit) + Number(needsSetupPermit);
  let signatureNumber = 1;
  const domain = {
    name: tokenName,
    version: process.env.SDAI_PERMIT_VERSION ?? "1",
    chainId: CHAIN_ID,
    verifyingContract: SDAI,
  };
  const permit = (spender: string, value: BigNumber, nonce: BigNumber) => ({
    owner: funder,
    spender,
    value: value.toString(),
    nonce: nonce.toString(),
    deadline: validTo.toString(),
  });
  const signPermit = async (message: ReturnType<typeof permit>) => {
    console.log(
      `Signature ${signatureNumber++}/${signatureCount}: ${message.spender} permit`,
    );
    const signature = await wallet._signTypedData(domain, PERMIT_TYPES, message);
    const signedPermit = {
      ...message,
      ...ethers.utils.splitSignature(signature),
    };
    // A later permit cannot be simulated until the earlier nonce is consumed.
    // Both signatures share the same token domain, so simulating the first one
    // validates that domain before either signature is published.
    if (BigNumber.from(message.nonce).eq(tokenNonce)) {
      await assertPermitValid(token, signedPermit);
    }
    return signedPermit;
  };

  const signedSetupPermit = needsSetupPermit
    ? await signPermit(
        permit(
          COW_VAULT_RELAYER_CONTRACT,
          setupDebit,
          tokenNonce,
        ),
      )
    : undefined;
  const pollerPermitNonce = tokenNonce.add(needsSetupPermit ? 1 : 0);
  const pollerPermitValue = maxAllowance.sub(pollerAllowance).lt(fullSellAmount)
    ? maxAllowance
    : pollerAllowance.add(fullSellAmount);
  const signedPollerPermit = needsPollerPermit
    ? await signPermit(
        permit(
          pollerAddress,
          pollerPermitValue,
          pollerPermitNonce,
        ),
      )
    : undefined;

  console.log(
    `Signature ${signatureNumber++}/${signatureCount}: CowShed setup bundle`,
  );
  const call = (target: string, callData: string) => ({
    target,
    callData,
    value: 0n,
    isDelegateCall: false,
    allowFailure: false,
  });
  const pollerPermitCall = signedPollerPermit
    ? optionalPermitCall(SDAI, signedPollerPermit)
    : undefined;
  const setupPermitCall = signedSetupPermit
    ? optionalPermitCall(SDAI, signedSetupPermit)
    : undefined;
  const bundle = await cowShedSdk.signCalls({
    chainId: CHAIN_ID,
    calls: [
      // Duplicate the pre-hook permit so an early bundle relay consumes nonce N
      // before the Poller permit at N+1. Replays are tolerated by Multicall3.
      ...(setupPermitCall
        ? [call(setupPermitCall.target, setupPermitCall.callData)]
        : []),
      ...(pollerPermitCall
        ? [call(pollerPermitCall.target, pollerPermitCall.callData)]
        : []),
      call(
        pollerAddress,
        poller.encodeRegisterFromShed(schedule),
      ),
      call(
        SDAI,
        token.interface.encodeFunctionData("approve", [
          COW_VAULT_RELAYER_CONTRACT,
          ethers.constants.MaxUint256,
        ]),
      ),
      call(COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID], twap.createCalldata),
    ],
    deadline: BigInt(validTo),
    nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
    signer: wallet,
    defaultGasLimit: 1_000_000n,
  });
  if (
    !areAddressesEqual(bundle.cowShedAccount, cowShed) ||
    !areAddressesEqual(bundle.signedMulticall.to, COW_SHED_FACTORY_ADDRESS) ||
    bundle.signedMulticall.value !== 0n
  ) {
    throw new Error("CowShed SDK returned an unexpected setup call");
  }

  const setupOrderAppData = () => {
    return {
      appCode: APP_CODE,
      metadata: {
        hooks: {
          ...(setupPermitCall
            ? {
                pre: [
                  {
                    target: setupPermitCall.target,
                    callData: setupPermitCall.callData,
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
  const assertRegistrationFresh = async () => {
    const current = await poller.getSchedule(scheduleId);
    if (
      !areAddressesEqual(current.funder, ethers.constants.AddressZero) ||
      !BigNumber.from(current.authEpoch).eq(schedule.authEpoch)
    ) {
      throw new Error(
        "Poller schedule changed before submission; rebuild and re-sign the registration",
      );
    }
  };
  const assertPermitStateFresh = async () => {
    const [currentNonce, currentPollerAllowance, currentVaultAllowance] =
      await Promise.all([
        token.nonces(funder),
        token.allowance(funder, pollerAddress),
        token.allowance(funder, COW_VAULT_RELAYER_CONTRACT),
      ]);
    if (
      (needsPollerPermit || needsSetupPermit) &&
      !currentNonce.eq(tokenNonce)
    ) {
      throw new Error("Token permit nonce changed; rebuild and re-sign the setup");
    }
    if (
      needsPollerPermit
        ? !currentPollerAllowance.eq(pollerAllowance)
        : currentPollerAllowance.lt(fullSellAmount)
    ) {
      throw new Error("Poller allowance changed; rebuild and re-sign the setup");
    }
    if (
      needsSetupPermit
        ? !currentVaultAllowance.eq(vaultAllowance)
        : currentVaultAllowance.lt(setupDebit)
    ) {
      throw new Error(
        "Vault Relayer allowance changed; rebuild and re-sign the setup",
      );
    }
  };

  await Promise.all([assertRegistrationFresh(), assertPermitStateFresh()]);
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    setupTrade,
    {
      quoteRequest: { validTo },
      appData: setupOrderAppData(),
    },
  );
  const quotedDebit = BigNumber.from(quoteResults.orderToSign.sellAmount).add(
    quoteResults.orderToSign.feeAmount,
  );
  if (!quotedDebit.eq(setupDebit)) {
    throw new Error("Setup quote exceeds the permitted debit");
  }
  await Promise.all([assertRegistrationFresh(), assertPermitStateFresh()]);

  console.log(
    `Signature ${signatureNumber}/${signatureCount}: hook-aware setup order`,
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
