import {
  SupportedChainId,
  OrderSigningUtils,
  UnsignedOrder,
  SellTokenSource
} from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { confirm, getWallet } from "../../utils";
import { getErc20Contract } from "../../contracts/erc20";
import { aaveAdapterFactoryAbi } from "./abi/AaveAdapterFactory";
import { repayWithCollateralAdapterHookAbi } from "./abi/RepayWithCollateralAdapterHook";
import { MetadataApi } from '@cowprotocol/app-data';
import { utils } from 'ethers'
import {
  OrderBalance,
  OrderKind,
  hashOrder,
  type Order} from '@cowprotocol/contracts'
import { GPv2Settlement__factory } from "@cowprotocol/cow-sdk/dist/common/generated";


const TOKENS = {
  underlying: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0", // USDC.e
  collateral: "0xC0333cb85B59a788d8C7CAe5e1Fd6E229A3E5a65", // aUSDC.e
  debt: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", // GNO
} as const;

const AAVE_POOL_ADDRESS = "0xb50201558B00496A145fE76f7424749556E326D8"; // See https://search.onaave.com/?q=sepolia
const AAVE_ADAPTER_FACTORY = "0x1186B5ad42E3e6d6c6901FC53b4A367540E6EcFE";
const AAVE_REPAY_DEBT_WITH_COLLATERAL_ADAPTER_HOOK = "0x9b80D127764c477165B31A9d1C49893Ece648A19";

const DEFAULT_GAS_LIMIT = "1000000"; // FIXME: This should not be necessary, it should estimate correctly!
const VALID_FOR = 1758320000;
const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;
const FLASHLOAN_FEE = "1000"; // 0.05% of the flashloan amount
const FLASHLOAN_AMOUNT = "2000000";
const SELL_AMOUNT = "1999000"; // Enough to cover the debt. ~ 1.9 USDC.e
const BUY_AMOUNT = "11000000000000000"; // 0.011 GNO
const KIND_BUY = "0x6ed88e868af0a1983e3886d5f3e95a2fafbd6c3450bc229e27342283dc429ccc";

function getEmptyPermitSig() {
  return {
    amount: 0,
    deadline: 0,
    v: 0,
    r: ethers.constants.HashZero, // bytes32(0) in Solidity
    s: ethers.constants.HashZero  // bytes32(0) in Solidity
  };
}

export async function run() {
  const wallet = await getWallet(CHAIN_ID);
  const trader = wallet.address;

  const adapterFactory = new ethers.Contract(
    AAVE_ADAPTER_FACTORY,
    aaveAdapterFactoryAbi,
    wallet
  );
  
  const flashLoanParams = {
    borrower: AAVE_ADAPTER_FACTORY,
    lender: AAVE_POOL_ADDRESS,
    flashLoanAsset: TOKENS.underlying,
    flashLoanAmount: FLASHLOAN_AMOUNT,
    flashLoanFee: FLASHLOAN_FEE
  }

  const hookAmounts = {
    flashLoanAmount: flashLoanParams.flashLoanAmount,
    flashLoanFeeAmount: flashLoanParams.flashLoanFee,
    sellAssetAmount: FLASHLOAN_AMOUNT,
    buyAssetAmount: BUY_AMOUNT
  }

  let order = {
    sellToken: TOKENS.underlying,
    buyToken: TOKENS.debt,
    receiver: "0", // to be updated later
    feeAmount: "0",
    sellAmount: SELL_AMOUNT,
    buyAmount: BUY_AMOUNT,
    validTo: VALID_FOR,
    kind: KIND_BUY,
    partiallyFillable: false,
    appData: ethers.constants.HashZero,
    sellTokenBalance: "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9",
    buyTokenBalance: "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9",
  }

  const hookOrderData = {
    owner: trader,
    sellAsset: order.sellToken,
    buyAsset: order.buyToken,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    kind: order.kind,
    validTo: VALID_FOR, // max value for timestamp expiration for Order
    flashLoanAmount: hookAmounts.flashLoanAmount,
    flashLoanFeeAmount: hookAmounts.flashLoanFeeAmount,
    hookSellAssetAmount: hookAmounts.sellAssetAmount,
    hookBuyAssetAmount: hookAmounts.buyAssetAmount
  }

  console.log("Get deterministic address params", AAVE_REPAY_DEBT_WITH_COLLATERAL_ADAPTER_HOOK, hookOrderData);

  const expectedInstanceAddress: string = await adapterFactory.getInstanceDeterministicAddress(
    AAVE_REPAY_DEBT_WITH_COLLATERAL_ADAPTER_HOOK,
    hookOrderData
  )

  console.log("expectedInstanceAddress", expectedInstanceAddress);
  order.receiver = expectedInstanceAddress;

  const confirmed = await confirm(
    `Do you want to approve token ${TOKENS.collateral} to spender ${expectedInstanceAddress}?`
  );
  if (confirmed) {
    const collateral = getErc20Contract(TOKENS.collateral, wallet);
    const tx = await collateral.approve(expectedInstanceAddress, FLASHLOAN_AMOUNT);
    await tx.wait();
    console.log("approved: ", tx.hash);
  }

  const appCode = 'aave-v3-flashloan'
  const flashLoanHint = {
    amount: FLASHLOAN_AMOUNT, // this is actually in UNDERLYING but aave tokens are 1:1
    receiver: AAVE_ADAPTER_FACTORY,
    liquidityProvider: AAVE_POOL_ADDRESS,
    protocolAdapter: AAVE_ADAPTER_FACTORY,
    token: TOKENS.underlying
  };
  console.log("flashLoanHint", flashLoanHint);

  // Prepare deployment of the helper contract
  const preHookCalldata = adapterFactory.interface.encodeFunctionData(
    "deployAndTransferFlashLoan",
    [
      trader,
      AAVE_REPAY_DEBT_WITH_COLLATERAL_ADAPTER_HOOK,
      hookAmounts,
      order,
    ]
  );

  const adapterHookInstance = new ethers.Contract(
    expectedInstanceAddress,
    repayWithCollateralAdapterHookAbi
  );

  const postHookCalldata = adapterHookInstance.interface.encodeFunctionData(
    "repayDebtWithFlashLoan",
    [getEmptyPermitSig()]
  );

  const stringify = require('json-stringify-deterministic');
  const appDataDoc = {
    appCode: appCode,
    metadata: {
      flashloan: flashLoanHint,
      hooks: {
        pre: [
          {
            target: AAVE_ADAPTER_FACTORY,
            callData: preHookCalldata,
            gasLimit: DEFAULT_GAS_LIMIT,
          },
        ],
        post: [
          {
            target: expectedInstanceAddress,
            callData: postHookCalldata,
            gasLimit: DEFAULT_GAS_LIMIT,
          }
        ],
      }

    }
  }

  // TODO: Update the metadataApi dependency to avoid this hack
  //const metadataApi = new MetadataApi();
  const fullAppData = stringify(appDataDoc);
  console.log("fullAppData", fullAppData, "\n");

  const module = await import('ethers/lib/utils')
  const { keccak256, toUtf8Bytes } = module.default || module
  const appDataHash = keccak256(toUtf8Bytes(fullAppData))
  console.log("appDataHash", appDataHash);
  
  const cowOrder: Order = {
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    receiver: order.receiver,
    feeAmount: "0",
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    validTo: VALID_FOR, 
    appData: appDataHash,
    kind: OrderKind.BUY,
    partiallyFillable: false,
    sellTokenBalance: OrderBalance.ERC20,
    buyTokenBalance: OrderBalance.ERC20,
  }
  const orderHash = hashOrder(await OrderSigningUtils.getDomain(CHAIN_ID), cowOrder);
  console.log("orderHash", orderHash, "\n");
 
  // TODO: There should be an easier way to encode an order
  const types = [
    "address", // sellToken
    "address", // buyToken
    "address", // receiver
    "uint256", // sellAmount 
    "uint256", // buyAmount
    "uint32", // validTo
    "bytes32", // appData
    "uint256", // feeAmount
    "bytes32", // kind
    "bool", // partiallyFillable
    "bytes32", // sellTokenBalance
    "bytes32", // buyTokenBalance
  ];
  const encodedOrder = utils.defaultAbiCoder.encode(types, [
    cowOrder.sellToken,
    cowOrder.buyToken, 
    cowOrder.receiver,
    cowOrder.sellAmount,
    cowOrder.buyAmount,
    cowOrder.validTo,
    cowOrder.appData,
    cowOrder.feeAmount,
    KIND_BUY,
    cowOrder.partiallyFillable,
    "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9", // order.sellTokenBalance
    "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9", // order.buyTokenBalance
  ]);
  console.log("encodedOrder", encodedOrder);


  const signedOrder = await OrderSigningUtils.signOrder(cowOrder as UnsignedOrder, CHAIN_ID, wallet);
  console.log("signedOrder", signedOrder.signature); 
 
  // TODO: ugly. Find a better way to encode the order+signature
  const fullSingature = utils.defaultAbiCoder.encode(
    ["tuple(address sellToken, address buyToken, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, bytes32 kind, bool partiallyFillable, bytes32 sellTokenBalance, bytes32 buyTokenBalance)", "bytes"], 
    [
      [
        cowOrder.sellToken,
        cowOrder.buyToken, 
        cowOrder.receiver,
        cowOrder.sellAmount,
        cowOrder.buyAmount,
        cowOrder.validTo,
        cowOrder.appData,
        cowOrder.feeAmount,
        KIND_BUY,
        cowOrder.partiallyFillable,
        "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9", // order.sellTokenBalance
        "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9"
      ],
      signedOrder.signature
    ]);
  console.log("fullSignature", fullSingature, "\n"); 


  const data = {
    "sellToken": cowOrder.sellToken,
    "buyToken": cowOrder.buyToken,
    "receiver": cowOrder.receiver,
    "feeAmount": "0",
    "sellAmount": cowOrder.sellAmount,
    "buyAmount": cowOrder.buyAmount,
    "validTo": cowOrder.validTo,
    "kind": "buy",
    "partiallyFillable": false,
    "sellTokenBalance": "erc20",
    "buyTokenBalance": "erc20",
    "signingScheme": "eip1271",
    "signature": fullSingature,
    "from": expectedInstanceAddress.toString(),
    "quoteId": 0,
    "appData": fullAppData,
  }

  console.log("data", data);
  console.log("json", JSON.stringify(data), "\n");

  // Post the order
  const response = await fetch("https://barn.api.cow.fi/xdai/api/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
  }

  console.log("response", response); 
  
}
