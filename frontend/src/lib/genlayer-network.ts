import { studioDevnet } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

const DEFAULT_RPC_URL = "https://studio-next.genlayer.com/api";
const DEFAULT_CHAIN_ID = 61997;
const DEFAULT_CHAIN_NAME = "GenLayer Studio Next";
const DEFAULT_SYMBOL = "GEN";

function parseChainId(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_CHAIN_ID;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`VITE_GENLAYER_CHAIN_ID must be a positive integer; received ${value}.`);
  }
  return parsed;
}

export function createGenLayerNetworkConfig(overrides?: {
  chainId?: string;
  chainName?: string;
  rpcUrl?: string;
  symbol?: string;
}): {
  chain: GenLayerChain;
  wallet: {
    chainId: `0x${string}`;
    chainName: string;
    nativeCurrency: typeof studioDevnet.nativeCurrency;
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
} {
  const chainId = parseChainId(overrides?.chainId);
  const chainName = overrides?.chainName?.trim() || DEFAULT_CHAIN_NAME;
  const rpcUrl = overrides?.rpcUrl?.trim() || DEFAULT_RPC_URL;
  const symbol = overrides?.symbol?.trim() || DEFAULT_SYMBOL;
  const nativeCurrency = {
    ...studioDevnet.nativeCurrency,
    name: symbol,
    symbol,
    decimals: 18,
  };
  const chain = {
    ...studioDevnet,
    id: chainId,
    name: chainName,
    nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
  } satisfies GenLayerChain;
  return {
    chain,
    wallet: {
      chainId: `0x${chainId.toString(16).toUpperCase()}`,
      chainName,
      nativeCurrency,
      rpcUrls: [rpcUrl],
      blockExplorerUrls: [],
    },
  };
}

export const genLayerNetwork = createGenLayerNetworkConfig({
  chainId: import.meta.env.VITE_GENLAYER_CHAIN_ID,
  chainName: import.meta.env.VITE_GENLAYER_CHAIN_NAME,
  rpcUrl: import.meta.env.VITE_GENLAYER_RPC_URL,
  symbol: import.meta.env.VITE_GENLAYER_SYMBOL,
});

export const SHARED_GENLAYER_CHAIN = genLayerNetwork.chain;
export const GENLAYER_WALLET_NETWORK = genLayerNetwork.wallet;
export const GENLAYER_CHAIN_NAME = SHARED_GENLAYER_CHAIN.name;
export const GENLAYER_RPC_URL = SHARED_GENLAYER_CHAIN.rpcUrls.default.http[0];

