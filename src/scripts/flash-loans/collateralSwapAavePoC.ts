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
import { collateralSwapAdapterHookAbi } from "./abi/CollateralSwapAdapterHook";
import { MetadataApi } from '@cowprotocol/app-data';
import { utils } from 'ethers'
import {
  OrderBalance,
  OrderKind,
  hashOrder,
  type Order} from '@cowprotocol/contracts'
import { GPv2Settlement__factory } from "@cowprotocol/cow-sdk/dist/common/generated";


const TOKENS = {
  oldUnderlying: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", // WXDAI
  oldCollateral: "0xd0Dd6cEF72143E22cCED4867eb0d5F2328715533", // aGnoWXDAI
  debt: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", // GNO
  newUnderlying: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0", // USDC.e
  newCollateral: "0xC0333cb85B59a788d8C7CAe5e1Fd6E229A3E5a65", // aUSDC.e
} as const;

const AAVE_POOL_ADDRESS = "0xb50201558B00496A145fE76f7424749556E326D8"; // See https://search.onaave.com/?q=sepolia
const AAVE_ADAPTER_FACTORY = "0x1186B5ad42E3e6d6c6901FC53b4A367540E6EcFE";
const AAVE_COLLATERAL_SWAP_ADAPTER_HOOK = "0xe80eE1e73f120b1106179Ae3D582CA4Fd768d517";

const DEFAULT_GAS_LIMIT = "1000000"; // FIXME: This should not be necessary, it should estimate correctly!
const VALID_FOR = 1758300000;
const CHAIN_ID = SupportedChainId.GNOSIS_CHAIN;
const FLASHLOAN_FEE = "10000000000000000"; // 0.05% of the flashloan amount
const OLD_COLLATERAL_AMOUNT = "20000000000000000000";
const NEW_COLLATERAL_AMOUNT = "18000000";
const KIND_SELL = "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";

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
    flashLoanAsset: TOKENS.oldUnderlying,
    flashLoanAmount: OLD_COLLATERAL_AMOUNT,
    flashLoanFee: FLASHLOAN_FEE
  }

  const hookAmounts = {
    flashLoanAmount: flashLoanParams.flashLoanAmount,
    flashLoanFeeAmount: flashLoanParams.flashLoanFee,
    sellAssetAmount: OLD_COLLATERAL_AMOUNT,
    buyAssetAmount: NEW_COLLATERAL_AMOUNT
  }

  let order = {
    sellToken: TOKENS.oldUnderlying,
    buyToken: TOKENS.newUnderlying,
    receiver: "0", // to be updated later
    feeAmount: "0",
    sellAmount: "19990000000000000000",
    buyAmount: NEW_COLLATERAL_AMOUNT,
    validTo: VALID_FOR,
    kind: KIND_SELL,
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

  console.log("Get deterministic address params", AAVE_COLLATERAL_SWAP_ADAPTER_HOOK, hookOrderData);

  const expectedInstanceAddress: string = await adapterFactory.getInstanceDeterministicAddress(
    AAVE_COLLATERAL_SWAP_ADAPTER_HOOK,
    hookOrderData
  )

  console.log("expectedInstanceAddress", expectedInstanceAddress);
  order.receiver = expectedInstanceAddress;

  const confirmed = await confirm(
    `Do you want to approve token ${TOKENS.oldCollateral} to spender ${expectedInstanceAddress}?`
  );
  if (confirmed) {
    const oldCollateral = getErc20Contract(TOKENS.oldCollateral, wallet);
    const tx = await oldCollateral.approve(expectedInstanceAddress, OLD_COLLATERAL_AMOUNT);
    await tx.wait();
    console.log("approved: ", tx.hash);
  }

  const appCode = 'aave-v3-flashloan'
  const flashLoanHint = {
    amount: OLD_COLLATERAL_AMOUNT, // this is actually in UNDERLYING but aave tokens are 1:1
    receiver: AAVE_ADAPTER_FACTORY,
    liquidityProvider: AAVE_POOL_ADDRESS,
    protocolAdapter: AAVE_ADAPTER_FACTORY,
    token: TOKENS.oldUnderlying
  };
  console.log("flashLoanHint", flashLoanHint);

  // Prepare deployment of the helper contract
  const preHookCalldata = adapterFactory.interface.encodeFunctionData(
    "deployAndTransferFlashLoan",
    [
      trader,
      AAVE_COLLATERAL_SWAP_ADAPTER_HOOK,
      hookAmounts,
      order,
    ]
  );

  const adapterHookInstance = new ethers.Contract(
    expectedInstanceAddress,
    collateralSwapAdapterHookAbi
  );

  const postHookCalldata = adapterHookInstance.interface.encodeFunctionData(
    "collateralSwapWithFlashLoan",
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
    kind: OrderKind.SELL,
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
    "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775", // order.kind
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
        "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775", // order.kind
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
    "kind": "sell",
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
