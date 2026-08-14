import { APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { COMPOSABLE_COW_POLLER_ADDRESS } from "../../const/gnosis";

import {
  SupportedChainId,
  OrderKind,
  TradingSdk,
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderBookApi,
} from "@cowprotocol/cow-sdk";
import { Twap } from "@cowprotocol/sdk-composable";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";

import { MetadataApi } from "@cowprotocol/app-data";
import { BigNumber, ethers } from "ethers";
import {
  confirm,
  debugStringify,
  getExplorerUrl,
  getWallet,
} from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";
import {
  encodePollFunds,
  encodeRegisterFromShed,
  getComposableCowPollerContract,
  scheduleId as derivePollerScheduleId,
} from "../../contracts/composable-cow-poller";
import { getCowShedSdk } from "./cowShed";

interface Token {
  symbol: string;
  address: string;
  decimals: number;
  contract: ethers.Contract;
}

const TOKENS = {
  twapSellToken: "0xaf204776c7245bF4147c2612BF6e5972Ee483701", // sDAI
  twapBuyToken: "0x177127622c4A00F3d409B75571e12cB3c8973d3c", // COW
} as const;

const TWAP_PARTS = 2;
const TWAP_TIME_BETWEEN_PARTS = 120; // 2min
const TWAP_SLIPPAGE_BPS = 1000; // 1000 bps (10%)

// The TWAP handler (ComposableCoW order type). Deterministic across chains.
const TWAP_HANDLER = "0x6cF1e9cA41f7611dEf408122793c358a3d11E5a5";
// Gas budget for the pollFunds pre-hook on each part (SLOADs + getTradeableOrder + transferFrom).
const TOPUP_HOOK_GAS_LIMIT = "350000";

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;

/**
 * Same setup as `postTwapForEOAWithJitFundsSimplified`, without the sell=buy order.
 *
 * There, the shed bundle rode as a post-hook so the setup was gasless. Here the EOA
 * just sends the bundle itself, which trades that gaslessness for a much shorter
 * script: no quote, no appData hooks, no order to place. The TWAP that comes out is
 * identical, and its parts are still funded just-in-time.
 */
export async function run() {
  const wallet = await getWallet(CHAIN_ID);
  const eoaTrader = wallet.address as `0x${string}`;

  // v9 SDK uses a global provider adapter. The composable order types and cow-shed
  // read it via `getGlobalAdapter()`, so it must be set before using them.
  const adapter = new EthersV5Adapter({
    provider: wallet.provider,
    signer: wallet,
  });
  setGlobalAdapter(adapter);

  // Only used to quote a part, so we can pick the TWAP's buy amount
  const sdk = new TradingSdk(
    {
      chainId: CHAIN_ID,
      signer: wallet,
      appCode: APP_CODE,
    },
    {},
    adapter,
  );

  // Get some info about the assets
  const { twapSellToken, twapBuyToken } = await getAssetsInfo({ wallet });

  // TWAP Order:
  const fullSellAmount = ethers.utils.parseUnits("0.2", twapSellToken.decimals); // TWAP order: Sell a total of 0.2 sDAI
  const fullSellAmountFormatted = ethers.utils.formatUnits(
    fullSellAmount,
    twapSellToken.decimals,
  );

  const partSellAmount = fullSellAmount.div(TWAP_PARTS);
  const partSellAmountFormatted = ethers.utils.formatUnits(
    partSellAmount,
    twapSellToken.decimals,
  );

  const cowShedSdk = getCowShedSdk(adapter);
  const cowShed = cowShedSdk.getCowShedAccount(CHAIN_ID, eoaTrader);
  console.log("CowShed account:", cowShed);

  // The poller schedule key is derived from (funder, handler, owner, salt).`pollFunds(id)`
  // The id is used as a pre-hook inside the TWAP's own appData
  const poller = getComposableCowPollerContract(
    COMPOSABLE_COW_POLLER_ADDRESS,
    wallet,
  );
  const twapSalt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const id: string = derivePollerScheduleId({
    handler: TWAP_HANDLER,
    funder: eoaTrader,
    owner: cowShed,
    salt: twapSalt,
  });
  console.log("Poller schedule id:", id);

  // Verify that the shed matches the poller.factory.proxyOf(eoaTrader)
  const pollerShedFactory: string = await poller.COW_SHED_FACTORY();
  const shedFromPollerFactory: string = await new ethers.Contract(
    pollerShedFactory,
    ["function proxyOf(address owner) view returns (address)"],
    wallet.provider,
  ).proxyOf(eoaTrader);
  if (!areAddressesEqual(shedFromPollerFactory, cowShed)) {
    throw new Error(
      `Poller pins CowShed factory ${pollerShedFactory}, which derives ${shedFromPollerFactory} for this funder, not ${cowShed}`,
    );
  }

  // Describe the flow
  console.log(
    `TWAP sell ${fullSellAmountFormatted} ${twapSellToken.symbol} for ${twapBuyToken.symbol} in ${TWAP_PARTS} parts (funded just-in-time).

The setup is a single transaction from the EOA to cow-shed, executing:
  - Register the JIT funding schedule on ComposableCowPoller (the shed registers on the EOA's behalf)
  - Approve the Vault Relayer
  - Create the TWAP. Owner of the TWAP is cow-shed (${cowShed}).

Watch Tower will detect the TWAP and create each part, which will settle and send the proceeds back to the EOA.
Each part carries a pre-hook (baked into the TWAP appData) that calls poller.pollFunds(id), pulling exactly that part's
sell amount from the EOA into cow-shed right before it settles. No external keeper is needed.
`,
  );

  // Generate app data for the TWAP, embedding a pre-hook with the polling
  const metadataApi = new MetadataApi();
  const pollFundsCalldata = encodePollFunds(id);
  const twapAppData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    environment: "prod",
    metadata: {
      hooks: {
        pre: [
          // Call: poller.pollFunds(id)
          {
            target: COMPOSABLE_COW_POLLER_ADDRESS,
            callData: pollFundsCalldata,
            gasLimit: TOPUP_HOOK_GAS_LIMIT,
          },
        ],
      },
    },
  });
  const { appDataContent: twapAppDataContent, appDataHex: twapAppDataHex } =
    await metadataApi.getAppDataInfo(twapAppData);

  const orderBookApi = new OrderBookApi({
    chainId: CHAIN_ID,
  });

  // Quote a single part to derive the TWAP's buy amount: `afterSlippage.buyAmount` is
  // the minimum we accept per part, scaled by the number of parts.
  const { quoteResults: partQuote } = await sdk.getQuote({
    kind: OrderKind.SELL,
    sellToken: twapSellToken.address,
    sellTokenDecimals: twapSellToken.decimals,
    buyToken: twapBuyToken.address,
    buyTokenDecimals: twapBuyToken.decimals,
    amount: partSellAmount.toString(),
    owner: eoaTrader,
    slippageBps: TWAP_SLIPPAGE_BPS,
  });
  const expectedPartBuyAmount = BigNumber.from(
    partQuote.amountsAndCosts.afterNetworkCosts.buyAmount,
  );
  const partBuyAmount = BigNumber.from(
    partQuote.amountsAndCosts.afterSlippage.buyAmount,
  );
  const expectedTwapBuyAmount = expectedPartBuyAmount.mul(TWAP_PARTS);
  const twapBuyAmount = partBuyAmount.mul(TWAP_PARTS);
  const fmt = (amount: BigNumber) =>
    `${ethers.utils.formatUnits(amount, twapBuyToken.decimals)} ${twapBuyToken.symbol}`;
  console.log(
    `TWAP buy amount per part: ~${fmt(expectedPartBuyAmount)} expected, ${fmt(partBuyAmount)} min (after ${TWAP_SLIPPAGE_BPS / 100}% slippage).
TWAP buy amount total: ~${fmt(expectedTwapBuyAmount)} expected, ${fmt(twapBuyAmount)} min.`,
  );

  // Build the TWAP
  const twap = Twap.fromData(
    {
      receiver: eoaTrader, // bought tokens are sent to the trader (the EOA)
      sellAmount: fullSellAmount.toBigInt(),
      buyAmount: twapBuyAmount.toBigInt(),
      numberOfParts: BigInt(TWAP_PARTS),
      timeBetweenParts: BigInt(TWAP_TIME_BETWEEN_PARTS),
      sellToken: twapSellToken.address,
      buyToken: twapBuyToken.address,
      appData: twapAppDataHex, // appData, including the pre-hook to poll funds
    },
    twapSalt, // controlled salt, so the schedule `id` matches the embedded hook
  );

  // `ctx == ComposableCoW.hash(params) == twap.id` is the order's cabinet key.
  // The poller schedule is keyed by the appData-independent `id` instead.
  const ctx = twap.id;
  const { handler, salt } = twap.leaf;

  // Sanity: the handler/salt must be exactly what we derived `id` from, so the
  // `pollFunds(id)` hook baked into the appData resolves to this very schedule.
  if (
    handler.toLowerCase() !== TWAP_HANDLER.toLowerCase() ||
    salt.toLowerCase() !== twapSalt.toLowerCase()
  ) {
    throw new Error(
      `TWAP handler/salt mismatch: handler=${handler} salt=${salt} (expected handler=${TWAP_HANDLER} salt=${twapSalt})`,
    );
  }

  console.log("TWAP context (ctx):", ctx);
  console.log("TWAP params for creation of order", {
    twapParams: twap.leaf,
    twapData: debugStringify(twap.data),
    twapAppDataContent: twapAppDataContent,
  });

  console.log("Uploading TWAP app data to API...");
  await orderBookApi.uploadAppData(twapAppDataHex, twapAppDataContent);

  // The schedule the shed registers: tokens are pulled from the EOA (funder) into the
  // shed (owner, and what the poller checks the caller against).
  const schedule = {
    ...twap.leaf,
    funder: eoaTrader,
    owner: cowShed,
  };
  const registerFromShedCalldata = encodeRegisterFromShed(schedule);

  const approveSellTokenCalldata =
    twapSellToken.contract.interface.encodeFunctionData("approve", [
      COW_VAULT_RELAYER_CONTRACT,
      ethers.constants.MaxUint256,
    ]);

  const deadline = BigInt(Math.ceil(Date.now() / 1000)) + 1800n;
  console.log(
    `Deadline: ${deadline} (${new Date(Number(deadline) * 1000).toISOString()})`,
  );

  // Bundle all the calls that cow-shed needs to execute. Same bundle as the post-hook
  // version, we just send it ourselves instead of having a settlement do it.
  const call = (target: string, callData: string) => ({
    target,
    callData,
    value: 0n,
    isDelegateCall: false,
    allowFailure: false,
  });
  // No `defaultGasLimit` on purpose: signCalls estimates the factory call, so a bundle
  // that would revert fails here rather than on-chain.
  const { signedMulticall: registerApproveAndTwap, gasLimit } =
    await cowShedSdk.signCalls({
      chainId: CHAIN_ID,
      calls: [
        // Register schedule
        call(COMPOSABLE_COW_POLLER_ADDRESS, registerFromShedCalldata),

        // Approve vault relayer
        call(twapSellToken.address, approveSellTokenCalldata),

        // Create TWAP
        call(COMPOSABLE_COW_CONTRACT_ADDRESS[CHAIN_ID], twap.createCalldata),
      ],
      deadline,
      signer: wallet,
    });
  console.log("Signed register+approve+twap calldata:", registerApproveAndTwap);
  console.log("Estimated gas for the cow-shed transaction:", gasLimit);

  // Ask for confirmation before doing anything on-chain
  const confirmed = await confirm(
    `This will:
  1. Approve the ComposableCowPoller to spend up to ${fullSellAmountFormatted} ${twapSellToken.symbol} (the full TWAP sell amount, pulled JIT).
  2. Send ONE transaction to cow-shed, which registers the schedule, approves the Vault Relayer and creates the TWAP.
  ...
  3. [watch-tower] Detects the TWAP and creates each part, which settle and proceeds are sent back to the EOA.

🥳 Each part will poll ${partSellAmountFormatted} ${twapSellToken.symbol} from your EOA before filling.

Unlike postTwapForEOAWithJitFundsSimplified, there is no sell=buy order: you pay gas for the setup instead of a fee.

Your EOA will receive: ~${fmt(expectedTwapBuyAmount)} (expected), at least ${fmt(twapBuyAmount)} (min, after ${TWAP_SLIPPAGE_BPS / 100}% slippage) across the ${TWAP_PARTS} parts.

ok?`,
  );
  if (!confirmed) {
    console.log("Aborted");
    return;
  }

  // 1. Approve the poller to pull the full TWAP sell amount from the EOA over time
  //    NOTE: For permit tokens, this could be another call in the bundle below
  await ensureAllowance({
    token: twapSellToken,
    owner: eoaTrader,
    spender: COMPOSABLE_COW_POLLER_ADDRESS,
    requiredAmount: fullSellAmount,
    label: "ComposableCowPoller",
  });

  // Schedule keys are single-use, so check ours survived the approval.
  const existing = await poller.schedules(id);
  if (existing.funder !== ethers.constants.AddressZero) {
    throw new Error(
      `Schedule key ${id} is already used (funder: ${existing.funder}); re-run to build one with a fresh salt`,
    );
  }

  // 2. Send the bundle. The gas limit is left to the provider so that a bundle which
  //    became unsendable in the meantime reverts on estimation, before spending gas.
  console.log("Sending the cow-shed transaction...");
  const tx = await wallet.sendTransaction({
    to: registerApproveAndTwap.to,
    data: registerApproveAndTwap.data,
    value: registerApproveAndTwap.value,
  });
  console.log("CowShed tx:", getExplorerUrl(CHAIN_ID, tx.hash));
  const receipt = await tx.wait();
  console.log(
    `Mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`,
  );

  // The bundle is all-or-nothing, so a registered schedule means the TWAP exists too.
  const registered = await poller.schedules(id);
  if (registered.funder === ethers.constants.AddressZero) {
    throw new Error(`Schedule ${id} is still not registered after ${tx.hash}`);
  }
  console.log(
    `Schedule registered (funder ${registered.funder}), TWAP (ctx ${ctx}) is live and funded just-in-time.

Monitor parts in https://explorer.cow.fi/gc/address/${cowShed}`,
  );
}

async function ensureAllowance(params: {
  token: Token;
  owner: string;
  spender: string;
  requiredAmount: BigNumber;
  label: string;
}) {
  const { token, owner, spender, requiredAmount, label } = params;
  const allowance: BigNumber = await token.contract.allowance(owner, spender);
  console.log(
    `Allowance for ${label}: ${ethers.utils.formatUnits(
      allowance,
      token.decimals,
    )} ${token.symbol}`,
  );
  if (allowance.gte(requiredAmount)) {
    return;
  }

  console.log(`Approving ${token.symbol} for ${label}...`);
  const tx = await token.contract.approve(spender, ethers.constants.MaxUint256);
  console.log(
    `Approving ${token.symbol} for ${label}. tx:`,
    getExplorerUrl(CHAIN_ID, tx.hash),
  );
  await tx.wait();
  console.log(`${token.symbol} approved for ${label}`);
}

async function getAssetsInfo(params: { wallet: ethers.Wallet }): Promise<{
  twapSellToken: Token;
  twapBuyToken: Token;
}> {
  const { wallet } = params;

  const twapSellToken = await getErc20Contract(TOKENS.twapSellToken, wallet);
  const twapBuyToken = await getErc20Contract(TOKENS.twapBuyToken, wallet);

  const [
    twapSellTokenSymbol,
    twapSellTokenDecimals,
    twapBuyTokenSymbol,
    twapBuyTokenDecimals,
  ] = await Promise.all([
    twapSellToken.symbol(),
    twapSellToken.decimals(),
    twapBuyToken.symbol(),
    twapBuyToken.decimals(),
  ]);

  return {
    twapSellToken: {
      symbol: twapSellTokenSymbol,
      address: twapSellToken.address,
      decimals: twapSellTokenDecimals,
      contract: twapSellToken,
    },
    twapBuyToken: {
      symbol: twapBuyTokenSymbol,
      address: twapBuyToken.address,
      decimals: twapBuyTokenDecimals,
      contract: twapBuyToken,
    },
  };
}
