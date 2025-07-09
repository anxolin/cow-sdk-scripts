export const orderHelperFactoryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_helperImplementation",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deployOrderHelper",
    inputs: [
      { name: "_owner", type: "address", internalType: "address" },
      { name: "_borrower", type: "address", internalType: "address" },
      {
        name: "_oldCollateral",
        type: "address",
        internalType: "address",
      },
      {
        name: "_oldCollateralAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_newCollateral",
        type: "address",
        internalType: "address",
      },
      {
        name: "_minSupplyAmount",
        type: "uint256",
        internalType: "uint256",
      },
      { name: "_validTo", type: "uint32", internalType: "uint32" },
    ],
    outputs: [
      {
        name: "orderHelperAddress",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getOrderHelperAddress",
    inputs: [
      { name: "_owner", type: "address", internalType: "address" },
      { name: "_borrower", type: "address", internalType: "address" },
      {
        name: "_oldCollateral",
        type: "address",
        internalType: "address",
      },
      {
        name: "_oldCollateralAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_newCollateral",
        type: "address",
        internalType: "address",
      },
      {
        name: "_minSupplyAmount",
        type: "uint256",
        internalType: "uint256",
      },
      { name: "_validTo", type: "uint32", internalType: "uint32" },
    ],
    outputs: [
      {
        name: "orderHelperAddress",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "NewOrderHelper",
    inputs: [
      {
        name: "helper",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  { type: "error", name: "ContractAlreadyDeployed", inputs: [] },
  { type: "error", name: "FailedDeployment", inputs: [] },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [
      { name: "balance", type: "uint256", internalType: "uint256" },
      { name: "needed", type: "uint256", internalType: "uint256" },
    ],
  },
  { type: "error", name: "InvalidImplementationContract", inputs: [] },
  { type: "error", name: "OrderHelperDeploymentFailed", inputs: [] },
] as const;
