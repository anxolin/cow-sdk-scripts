import { APP_CODE, arbitrum, base } from '../../const';

import {
  COW_PROTOCOL_VAULT_RELAYER_ADDRESS,
  OrderKind,
  SupportedChainId,
  TradeParameters,
  TradingSdk,
} from '@cowprotocol/cow-sdk';
import { ethers } from 'ethers';

import { MetadataApi } from '@cowprotocol/app-data';
import { createCowShedTx, getCowShedHooks } from '../../contracts/cowShed';
import { confirm, getWallet, jsonReplacer } from '../../utils';

import { getErc20Contract } from '../../contracts/erc20';
import { bridgeWithBungee } from '../../contracts/socket';

/**
 * 1. Get quote from Cowswap for USDT Arb to USDC Arb
 * 2. Get quote from Bungee for the quoted USDC Arb to USDC Base via CCTP/Across
 * 3. Get transaction calldata for SocketGateway contract to execute the bridge
 * 4. Prepare weiroll batch txn post-swap hook with the following steps:
 *   1. Fetch cowshed contract balance of USDC Arb
 *   2. Approve USDC Arb allowance from Cowshed to SocketGateway contract iff allowance is insufficient
 *   3. Modify the SocketGateway execution calldata to replace the bridge input amount with cowshed balance via
 *      - uses a BytesLib contract that can modify a bytes value
 *      - this is because SocketGateway is a proxy contract and the impl calldata is supposed to be a bytes param of the bridge function call
 *      - weiroll calls BytesLib contract to modify the bytes param
 *   4. Execute bridge on SocketGateway
 * 5. Create authenticated cowshed txn
 * 6. Generate app data for hook
 * 7. Get final quote from Cowswap for the modified swap
 * 8. Approve VaultRelayer contract if allowance is insufficient
 * 9. Post order on Cowswap
 */
export async function run() {
  /**
   * Swap from USDT to USDC on Arbitrum,
   * then bridge USDC to Base using Socket CCTP
   */
  const sourceChain = SupportedChainId.ARBITRUM_ONE;
  const targetChain = SupportedChainId.BASE;

  const wallet = await getWallet(sourceChain);
  const walletAddress = await wallet.getAddress();
  console.log('🔑 Wallet address:', walletAddress);
  
  const sellToken = arbitrum.USDT_ADDRESS;
  const sellTokenDecimals = await getErc20Contract(
    sellToken,
    wallet
  ).decimals();
  const sellTokenSymbol = await getErc20Contract(sellToken, wallet).symbol();

  const sellAmount = ethers.utils.parseUnits('1', sellTokenDecimals).toString();
  const buyToken = base.USDC_ADDRESS;
  const buyTokenDecimals = await getErc20Contract(
    buyToken,
    await getWallet(targetChain)
  ).decimals();
  const buyTokenSymbol = await getErc20Contract(
    buyToken,
    await getWallet(targetChain)
  ).symbol();

  // Initialize the SDK with the wallet
  const sdk = new TradingSdk({
    chainId: sourceChain,
    signer: wallet, // Use a signer
    appCode: APP_CODE,
  });

  // Get the intermediary token
  const intermediaryToken = arbitrum.USDC_ADDRESS;

  // Get intermediate token decimals
  const intermediateTokenContract = getErc20Contract(intermediaryToken, wallet);
  const intermediateTokenDecimals = await intermediateTokenContract.decimals();
  const intermediateTokenSymbol = await intermediateTokenContract.symbol();

  // Estimate how many intermediate tokens we can bridge
  const cowShedHooks = getCowShedHooks(sourceChain);
  const cowShedAccount = cowShedHooks.proxyOf(wallet.address);
  let quote = await sdk.getQuote({
    kind: OrderKind.SELL,
    amount: sellAmount,
    sellToken,
    sellTokenDecimals,
    buyToken: intermediaryToken,
    buyTokenDecimals: intermediateTokenDecimals,
    partiallyFillable: false, // Fill or Kill
    receiver: cowShedAccount,
  });
  const intermediateTokenAmount =
    quote.quoteResults.amountsAndCosts.afterSlippage.buyAmount;

  // console.log('quote', JSON.stringify(quote, jsonReplacer, 2));

  // Get raw transaction to bridge all available DAI from cow-shed using xDAI Bridge
  const bridgeWithBungeeTx = await bridgeWithBungee({
    owner: wallet.address,
    sourceChain: sourceChain,
    sourceToken: intermediaryToken,
    sourceTokenAmount: intermediateTokenAmount,
    targetChain: targetChain,
    targetToken: buyToken,
    recipient: wallet.address,
    useBridge: 'cctp',
  });

  console.log(
    '\n💰 Bridge tx:',
    JSON.stringify(bridgeWithBungeeTx, jsonReplacer, 2)
  );

  // Sign and encode the transaction
  const { preAuthenticatedTx: authenticatedBridgeTx, gasLimit } =
    await createCowShedTx({
    tx: bridgeWithBungeeTx,
    chainId: sourceChain,
    wallet,
  });

  // Define trade parameters. Sell sell token for intermediary token, to be received by cow-shed
  const parameters: TradeParameters = {
    kind: OrderKind.SELL, // Sell
    amount: sellAmount,
    sellToken,
    sellTokenDecimals,
    buyToken: intermediaryToken,
    buyTokenDecimals: intermediateTokenDecimals,
    partiallyFillable: false, // Fill or Kill
    receiver: cowShedAccount,
  };

  const metadataApi = new MetadataApi();
  const appData = await metadataApi.generateAppDataDoc({
    appCode: APP_CODE,
    metadata: {
      hooks: {
        post: [
          {
            callData: authenticatedBridgeTx.callData,
            gasLimit: gasLimit.toString(),
            target: authenticatedBridgeTx.to,
            dappId: 'bridge-socket',
          },
        ],
      },
    },
  });

  console.log(
    '🕣 Getting quote...',
    JSON.stringify(parameters, jsonReplacer, 2)
  );

  quote = await sdk.getQuote(parameters, { appData });
  const { postSwapOrderFromQuote, quoteResults } = quote;

  console.log('quoteResults', {
    amountsAndCosts: quoteResults.amountsAndCosts,
  });

  const minIntermediateTokenAmount =
    quoteResults.amountsAndCosts.afterSlippage.buyAmount;
  const minIntermediateTokenAmountFormatted = ethers.utils.formatUnits(
    minIntermediateTokenAmount,
    intermediateTokenDecimals
  );
  const sellAmountFormatted = ethers.utils.formatUnits(
    sellAmount,
    sellTokenDecimals
  );

  console.log(
    `You will sell ${sellAmountFormatted} ${sellTokenSymbol} and receive at least ${minIntermediateTokenAmountFormatted} ${intermediateTokenSymbol} (intermediate token). Then, it will be bridged to Base for ${buyTokenSymbol} via Across via Socket.`
  );

  const confirmed = await confirm(
    `You will bridge at least ${minIntermediateTokenAmountFormatted} ${intermediateTokenSymbol}. ok?`
  );
  if (!confirmed) {
    console.log('🚫 Aborted');
    return;
  }

  // check owner allowance to VaultRelayer
  const vaultRelayerContract = COW_PROTOCOL_VAULT_RELAYER_ADDRESS[sourceChain];
  const sellTokenContract = getErc20Contract(sellToken, wallet);
  const sellTokenAllowance = await sellTokenContract.allowance(
    walletAddress,
    vaultRelayerContract
  );
  const sellTokenAllowanceFormatted = ethers.utils.formatUnits(
    sellTokenAllowance,
    sellTokenDecimals
  );
  console.log('sellTokenAllowanceFormatted', sellTokenAllowanceFormatted);
  // If allowance is insufficient, grant allowance
  if (sellTokenAllowanceFormatted < sellAmount) {
    console.log('🚫 Insufficient allowance');
    const confirmed_allowance = await confirm(
      `Grant allowance to VaultRelayer?`
    );
    if (!confirmed_allowance) {
      console.log('🚫 Aborted');
      return;
    }
    const tx = await sellTokenContract.approve(
      vaultRelayerContract,
      // sellAmount
      ethers.utils.parseUnits('1000', sellTokenDecimals)
    );
    console.log('Allowance granted tx', tx);
    await tx.wait(2);
  }

  // Post the order
  const orderId = await postSwapOrderFromQuote();

  // Print the order creation
  console.log(
    `ℹ️ Order created, id: https://explorer.cow.fi/orders/${orderId}?tab=overview`
  );

  console.log(`🎉 The USDC is now waiting for you in Base`);
}
