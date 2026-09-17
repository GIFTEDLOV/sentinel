import type {
  EvidenceMetadata,
  IncidentRecord,
  ProtocolConfig,
} from "../models";
import { GENLAYER_RPC_URL, GENLAYER_WALLET_NETWORK, SHARED_GENLAYER_CHAIN } from "./genlayer-network";
import { FINAL_DEPLOYMENT } from "../config/finalDeployment";

export { GENLAYER_CHAIN_NAME, GENLAYER_RPC_URL, GENLAYER_WALLET_NETWORK, SHARED_GENLAYER_CHAIN } from "./genlayer-network";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
}

export function getEthereumProvider(): Eip1193Provider | null {
  return typeof window === "undefined" ? null : window.ethereum ?? null;
}

export async function switchWalletToGenLayerNetwork(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: GENLAYER_WALLET_NETWORK.chainId }] });
  } catch (reason: unknown) {
    const code = typeof reason === "object" && reason !== null && "code" in reason ? (reason as { code?: unknown }).code : undefined;
    if (code !== 4902) throw reason;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: GENLAYER_WALLET_NETWORK.chainId,
        chainName: GENLAYER_WALLET_NETWORK.chainName,
        nativeCurrency: GENLAYER_WALLET_NETWORK.nativeCurrency,
        rpcUrls: GENLAYER_WALLET_NETWORK.rpcUrls,
        blockExplorerUrls: GENLAYER_WALLET_NETWORK.blockExplorerUrls,
      }],
    });
  }
}

export type TransactionHash = string;

export type TransactionLifecycleStatus =
  | "PENDING"
  | "ACCEPTED"
  | "FINALIZED"
  | "FAILED";

export interface TransactionLifecycle {
  hash: TransactionHash;
  status: TransactionLifecycleStatus;
  executionSucceeded: boolean | null;
  triggeredTransactionHashes?: TransactionHash[];
}

export interface ContractReadRequest {
  address: string;
  method: string;
  args: readonly unknown[];
}

/**
 * A deliberately small seam around the selected GenLayer JS SDK.
 * The SDK transport is injected after the exact deployment network is chosen;
 * no browser-local state is allowed to stand in for contract state.
 */
export interface GenLayerTransport {
  readContract<T>(request: ContractReadRequest): Promise<T>;
  getTransactionLifecycle(hash: TransactionHash): Promise<TransactionLifecycle>;
}

export class GenLayerClient {
  public constructor(private readonly transport: GenLayerTransport) {}

  public readProtocol(address: string, protocolId: string): Promise<ProtocolConfig> {
    return this.transport.readContract<ProtocolConfig>({
      address,
      method: "get_protocol",
      args: [protocolId],
    });
  }

  public readIncident(address: string, incidentId: string): Promise<IncidentRecord> {
    return this.transport.readContract<IncidentRecord>({
      address,
      method: "get_incident",
      args: [incidentId],
    });
  }

  public readEvidence(address: string, evidenceId: string): Promise<EvidenceMetadata> {
    return this.transport.readContract<EvidenceMetadata>({
      address,
      method: "get_evidence",
      args: [evidenceId],
    });
  }

  public reconcile(hash: TransactionHash): Promise<TransactionLifecycle> {
    return this.transport.getTransactionLifecycle(hash);
  }
}

export interface SentinelClientConfig {
  network: "studioNext";
  chainId: number;
  rpcUrl: string;
  contractAddress: string | null;
  protectedDemoAddress: string | null;
  protocolId: string | null;
  incidentIds: string[];
}

export const sentinelClientConfig: SentinelClientConfig = {
  network: "studioNext",
  chainId: SHARED_GENLAYER_CHAIN.id,
  rpcUrl: GENLAYER_RPC_URL,
  contractAddress: import.meta.env.VITE_SENTINEL_CONTRACT_ADDRESS || FINAL_DEPLOYMENT.sentinelAddress,
  protectedDemoAddress: import.meta.env.VITE_PROTECTED_DEMO_CONTRACT_ADDRESS || FINAL_DEPLOYMENT.protectedDemoAddress,
  protocolId: import.meta.env.VITE_SENTINEL_PROTOCOL_ID || FINAL_DEPLOYMENT.protocolId,
  incidentIds: (import.meta.env.VITE_SENTINEL_INCIDENT_IDS || FINAL_DEPLOYMENT.incidentId)
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean),
};
