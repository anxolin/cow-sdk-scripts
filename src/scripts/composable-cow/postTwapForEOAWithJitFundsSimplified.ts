import { APP_CODE, COW_VAULT_RELAYER_CONTRACT } from "../../const";
import { COMPOSABLE_COW_POLLER_ADDRESS } from "../../const/gnosis";

import {
  SupportedChainId,
  OrderKind,
  TradingSdk,
  COMPOSABLE_COW_CONTRACT_ADDRESS,
  OrderBookApi,
} from "@cowprotocol/cow-sdk";
import {
  ComposableCowPoller,
  TWAP_ADDRESS,
  Twap,
} from "@cowprotocol/sdk-composable";
import { areAddressesEqual, setGlobalAdapter } from "@cowprotocol/sdk-common";
import { EthersV5Adapter } from "@cowprotocol/sdk-ethers-v5-adapter";

import { MetadataApi } from "@cowprotocol/app-data";
import { BigNumber, ethers } from "ethers";
import {
  confirm,
  debugStringify,
  getExplorerUrl,
  getWallet,
  printQuote,
} from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";
import { getCowShedSdk } from "./cowShed";

// Higher than in postTwapForEOAWithJitFunds: the bundle also registers the schedule.
const DEFAULT_GAS_LIMIT = 1_000_000n;

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
const FIRST_ORDER_SLIPPAGE_BPS = 50; // 50 bps (0.5%)
const FIRST_ORDER_SELL_AMOUNT = "1"; // sell=buy order: sell 1 unit of the TWAP sell token

// Gas budget for the pollFunds pre-hook on each part (SLOADs + getTradeableOrder + transferFrom).
const TOPUP_HOOK_GAS_LIMIT = "350000";

const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;

/**
 * Simplified variant of `postTwapForEOAWithJitFunds`: one transaction less.
 *
 * The schedule is registered inside the cow-shed bundle instead of by its own EOA
 * transaction. The poller accepts `registerFromShed` from `proxyOf(funder)`, so the
 * shed's authorization replaces the funder's own call. Only the allowances are left
 * for the EOA to send.
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

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk(
    {
      chainId: CHAIN_ID,
      signer: wallet, // Use a signer
      appCode: APP_CODE,
    },
    {},
    adapter,
  );

  // Get some info about the assets
  const { twapSellToken, twapBuyToken } = await getAssetsInfo({ wallet });

  // First order (sell=buy order):
  //   The sell=buy order'sonly purpose is to get the post-hook (which registers the
  //   schedule and creates the TWAP) executed gaslessly via a settlement.
  //
  //   It does NOT move the full TWAP sell amount: This is why no the recipient of the funds is still the EOA.
  //   as opposed to what src/scripts/composable-cow/postTwapForEOA.ts does
  //
  //   Thanks to JIT funding, each part is pulled from the EOA right before it settles.
  const firstOrderSellAmount = ethers.utils.parseUnits(
    FIRST_ORDER_SELL_AMOUNT,
    twapSellToken.decimals,
  ); // sell=buy order: Sell 1 sDAI (and buy back sDAI, minus the fee)
  const firstOrderSellAmountFormatted = ethers.utils.formatUnits(
    firstOrderSellAmount,
    twapSellToken.decimals,
  );

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
  const poller = new ComposableCowPoller(COMPOSABLE_COW_POLLER_ADDRESS);
  const twapSalt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const id = poller.getScheduleId({
    handler: TWAP_ADDRESS,
    funder: eoaTrader,
    owner: cowShed,
    salt: twapSalt,
  });
  console.log("Poller schedule id:", id);
  const [storedSchedule, pollerShedFactory] = await Promise.all([
    poller.getSchedule(id),
    poller.getCowShedFactoryAddress(),
  ]);
  if (storedSchedule.handler !== ethers.constants.AddressZero) {
    throw new Error(`Schedule ${id} is already active`);
  }

  // Verify that the shed matches the poller.factory.proxyOf(eoaTrader)
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

The setup is done with a gasless sell=buy order with a post-hook:
  - Sell=buy order: SELL ${firstOrderSellAmountFormatted} ${twapSellToken.symbol} for ${twapSellToken.symbol} (sell == buy)
  - Order executes a post-hook (via cow-shed):
      - Register the JIT funding schedule on ComposableCowPoller (the shed registers on the EOA's behalf)
      - Approve the Vault Relayer
      - Create the TWAP. Owner of the TWAP is cow-shed (${cowShed}).

The EOA gets the ${twapSellToken.symbol} back (minus the fee), which means that the EOA is the recipient of the first order.
The order will have the side-effects described above.

Watch Tower will detect the TWAP and create each part, which will settle and send the proceeds back to the EOA.
Each part carries a pre-hook (baked into the TWAP appData) that calls poller.pollFunds(id), pulling exactly that part's
sell amount from the EOA into cow-shed right before it settles. No external keeper is needed.
`,
  );

  // Generate app data for the TWAP, embedding a pre-hook with the polling
  const metadataApi = new MetadataApi();
  const pollFundsCalldata = poller.encodePollFunds(id);
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

  // Quote a single part (sell token -> buy token) to derive a sensible buy amount
  // limit. We pass our slippage tolerance so `afterSlippage.buyAmount` is the
  // minimum we are willing to receive per part. The TWAP's total buy amount is
  // then that per-part minimum scaled by the number of parts.
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
  // Expected amount (net of costs, before slippage) and the minimum we will sign
  // (after slippage), both per part and scaled to the whole TWAP.
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
  const { handler, salt, staticInput } = twap.leaf;

  // Sanity: the handler/salt must be exactly what we derived `id` from, so the
  // `pollFunds(id)` hook baked into the appData resolves to this very schedule.
  if (
    handler.toLowerCase() !== TWAP_ADDRESS.toLowerCase() ||
    salt.toLowerCase() !== twapSalt.toLowerCase()
  ) {
    throw new Error(
      `TWAP handler/salt mismatch: handler=${handler} salt=${salt} (expected handler=${TWAP_ADDRESS} salt=${twapSalt})`,
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
    authEpoch: storedSchedule.authEpoch,
    funder: eoaTrader,
    owner: cowShed,
  };
  const registerFromShedCalldata = poller.encodeRegisterFromShed(schedule);

  // Simulate the registration as the shed: a revert inside the post-hook is silent.
  try {
    const returned = await wallet.provider.call({
      from: cowShed,
      to: COMPOSABLE_COW_POLLER_ADDRESS,
      data: registerFromShedCalldata,
    });
    console.log(
      `Simulated registerFromShed as the CowShed: returns ${returned}` +
        (returned.endsWith(id.slice(2)) ? " (matches the schedule id)" : ""),
    );
  } catch (error) {
    throw new Error(
      `registerFromShed would revert when called by ${cowShed}: ${(error as Error).message}`,
    );
  }

  const approveSellTokenCalldata =
    twapSellToken.contract.interface.encodeFunctionData("approve", [
      COW_VAULT_RELAYER_CONTRACT,
      ethers.constants.MaxUint256,
    ]);

  const deadline = BigInt(Math.ceil(Date.now() / 1000)) + 1800n;
  console.log(
    `Deadline: ${deadline} (${new Date(Number(deadline) * 1000).toISOString()})`,
  );

  // Bundle all the calls that cow-shed needs to execute. Note that now the schedule has been moved here :) (comparing with postTwapForEOAWithJitFunds.ts version)
  const call = (target: string, callData: string) => ({
    target,
    callData,
    value: 0n,
    isDelegateCall: false,
    allowFailure: false,
  });
  const {
    signedMulticall: registerApproveAndTwap,
    gasLimit: registerApproveAndTwapGasLimit,
  } = await cowShedSdk.signCalls({
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
    defaultGasLimit: DEFAULT_GAS_LIMIT,
  });
  console.log("Signed register+approve+twap calldata:", registerApproveAndTwap);

  // Perform sell=buy order
  const { quoteResults, postSwapOrderFromQuote } = await sdk.getQuote(
    {
      kind: OrderKind.SELL,
      sellToken: twapSellToken.address,
      sellTokenDecimals: twapSellToken.decimals,
      buyToken: twapSellToken.address, // sell == buy
      buyTokenDecimals: twapSellToken.decimals,
      amount: firstOrderSellAmount.toString(), // sell 1 sDAI
      receiver: eoaTrader, // bought tokens stay with the trader; cow-shed needs no funds until each part is settled
      owner: eoaTrader,
      partiallyFillable: false,
      validFor: 1800,
      slippageBps: FIRST_ORDER_SLIPPAGE_BPS,
    },
    {
      appData: {
        appCode: APP_CODE,
        metadata: {
          hooks: {
            post: [
              // Register the schedule, approve the Vault Relayer and create the TWAP
              {
                callData: registerApproveAndTwap.data,
                gasLimit: registerApproveAndTwapGasLimit.toString(),
                target: registerApproveAndTwap.to,
                dappId:
                  "cow-sdk-scripts://composable-cow/post-twap-for-eoa-jit-simplified",
              },
            ],
          },
        },
      },
    },
  );

  // Print the quote
  printQuote(quoteResults);

  // Max fee for the first order: what we sell minus what we are guaranteed back.
  const firstOrderMaxFee = firstOrderSellAmount.sub(
    quoteResults.amountsAndCosts.afterSlippage.buyAmount,
  );
  const firstOrderMaxFeeFormatted = ethers.utils.formatUnits(
    firstOrderMaxFee,
    twapSellToken.decimals,
  );

  // Ask for confirmation before doing anything on-chain
  const confirmed = await confirm(
    `This will:
  1. Approve the Vault Relayer to spend ${firstOrderSellAmountFormatted} ${twapSellToken.symbol} (for the sell=buy order).
  2. Approve the ComposableCowPoller to spend up to ${fullSellAmountFormatted} ${twapSellToken.symbol} (the full TWAP sell amount, pulled JIT).
  3. Place the sell=buy order (SELL ${firstOrderSellAmountFormatted} ${twapSellToken.symbol} for ${twapSellToken.symbol}), whose post-hook registers the schedule and creates the TWAP.
  ...
  4. [watch-tower] Detects the TWAP and creates each part, which settle and proceeds are sent back to the EOA.

🥳 Each part will poll ${partSellAmountFormatted} ${twapSellToken.symbol} from your EOA before filling.

No separate registration transaction: the schedule is registered by your cow-shed, inside the post-hook.

Your EOA will receive: ~${fmt(expectedTwapBuyAmount)} (expected), at least ${fmt(twapBuyAmount)} (min, after ${TWAP_SLIPPAGE_BPS / 100}% slippage) across the ${TWAP_PARTS} parts.
You will pay at most ${firstOrderMaxFeeFormatted} ${twapSellToken.symbol} for placing and setting up the TWAP.

ok?`,
  );
  if (!confirmed) {
    console.log("Aborted");
    return;
  }

  // 1. Approve the Vault Relayer for the whole sell=buy amount: all of it is pulled
  //    at settlement, even though only the fee is actually spent.
  await ensureAllowance({
    token: twapSellToken,
    owner: eoaTrader,
    spender: COW_VAULT_RELAYER_CONTRACT,
    requiredAmount: firstOrderSellAmount,
    label: "Vault Relayer",
  });

  // 2. Approve the poller to pull the full TWAP sell amount from the EOA over time
  //    NOTE: For permit tokens, we can include the permit call as part of the first order
  await ensureAllowance({
    token: twapSellToken,
    owner: eoaTrader,
    spender: COMPOSABLE_COW_POLLER_ADDRESS,
    requiredAmount: fullSellAmount,
    label: "ComposableCowPoller",
  });

  // No registration transaction here: the cow-shed bundle does it in the post-hook.
  const current = await poller.getSchedule(id);
  if (
    current.handler !== ethers.constants.AddressZero ||
    !BigNumber.from(current.authEpoch).eq(schedule.authEpoch)
  ) {
    throw new Error(`Schedule ${id} changed before submission`);
  }

  // 3. Place the sell=buy order. Its post-hook registers the schedule and creates the TWAP.
  const { orderId } = await postSwapOrderFromQuote();
  console.log(
    `Sell=buy order created, id: https://explorer.cow.fi/gc/orders/${orderId}?tab=overview`,
  );
  console.log(
    `Once it settles, the TWAP (ctx ${ctx}) will be registered and funded (just-in-time).

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
