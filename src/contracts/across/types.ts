export type Route = {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
};

export interface ChainConfig {
  chainId: number;
  usdc: string;
  weth?: string;
  wbtc?: string;
  dai?: string;
  usdt?: string;
  uma?: string;
}
