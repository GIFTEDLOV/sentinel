import type {
  EvidenceMetadata,
  IncidentDossier,
  IncidentRecord,
  ProtocolConfig,
  ProofActivity,
  ProtectedDemoState,
} from "../models";
import { sentinelClientConfig } from "./genlayer-client";
import type { GenLayerTransport } from "./genlayer-client";
import { csvToIds, decodeEvidence, decodeIncident, decodeProtectedDemoState, decodeProtocol } from "./decoders";
import { createStudioNextClient } from "./genlayer-transport";
import { FINAL_DEPLOYMENT } from "../config/finalDeployment";

export interface DashboardSnapshot {
  protocol: ProtocolConfig | null;
  incidents: IncidentRecord[];
  target: ProtectedDemoState | null;
}

function configuredAddress(value: string | null): value is string {
  return value !== null && value.startsWith("0x") && value.length === 42;
}

export function hasSentinelDeployment(): boolean {
  return configuredAddress(sentinelClientConfig.contractAddress);
}

export async function readProtocol(transport?: GenLayerTransport): Promise<ProtocolConfig | null> {
  if (!hasSentinelDeployment() || !sentinelClientConfig.protocolId) return null;
  const client = transport ?? createStudioNextClient();
  const raw = await client.readContract<unknown>({
    address: sentinelClientConfig.contractAddress as string,
    method: "get_protocol",
    args: [sentinelClientConfig.protocolId],
  });
  return decodeProtocol(raw, sentinelClientConfig.protocolId);
}

export async function readIncident(incidentId: string, transport?: GenLayerTransport): Promise<IncidentRecord> {
  if (!hasSentinelDeployment()) throw new Error("Sentinel deployment is not configured.");
  const client = transport ?? createStudioNextClient();
  const raw = await client.readContract<unknown>({
    address: sentinelClientConfig.contractAddress as string,
    method: "get_incident",
    args: [incidentId],
  });
  return decodeIncident(raw, incidentId);
}

export async function readEvidence(evidenceId: string, transport?: GenLayerTransport): Promise<EvidenceMetadata> {
  if (!hasSentinelDeployment()) throw new Error("Sentinel deployment is not configured.");
  const client = transport ?? createStudioNextClient();
  const raw = await client.readContract<unknown>({
    address: sentinelClientConfig.contractAddress as string,
    method: "get_evidence",
    args: [evidenceId],
  });
  return decodeEvidence(raw, evidenceId);
}

export async function readProtectedDemoState(transport?: GenLayerTransport): Promise<ProtectedDemoState | null> {
  if (!configuredAddress(sentinelClientConfig.protectedDemoAddress)) return null;
  const client = transport ?? createStudioNextClient();
  const address = sentinelClientConfig.protectedDemoAddress;
  const [owner, authorizedSentinel, controllerConfigured, paused, remediated, totalProcessed, treasury, lastOutflow, counters] = await Promise.all([
    client.readContract<unknown>({ address, method: "get_owner", args: [] }),
    client.readContract<unknown>({ address, method: "get_authorized_sentinel", args: [] }),
    client.readContract<unknown>({ address, method: "is_controller_configured", args: [] }),
    client.readContract<unknown>({ address, method: "is_paused", args: [] }),
    client.readContract<unknown>({ address, method: "is_remediated", args: [] }),
    client.readContract<unknown>({ address, method: "get_total_processed", args: [] }),
    client.readContract<unknown>({ address, method: "get_treasury_state", args: [] }),
    client.readContract<unknown>({ address, method: "get_last_outflow", args: [] }),
    client.readContract<unknown>({ address, method: "get_pause_counters", args: [] }),
  ]);
  return decodeProtectedDemoState(address, { owner, authorizedSentinel, controllerConfigured, paused, remediated, totalProcessed, treasury, lastOutflow, counters });
}

export async function readDashboard(): Promise<DashboardSnapshot> {
  if (!hasSentinelDeployment()) return { protocol: null, incidents: [], target: await readProtectedDemoState() };
  const transport = createStudioNextClient();
  const [protocol, target] = await Promise.all([readProtocol(transport), readProtectedDemoState(transport)]);
  const incidents = await Promise.all(
    sentinelClientConfig.incidentIds.map((incidentId) => readIncident(incidentId, transport)),
  );
  return { protocol, incidents, target };
}

export async function readIncidentDossier(incidentId: string): Promise<IncidentDossier> {
  const transport = createStudioNextClient();
  const incident = await readIncident(incidentId, transport);
  const configuredIds = incidentId === FINAL_DEPLOYMENT.incidentId ? Object.values(FINAL_DEPLOYMENT.evidenceIds) : [];
  const evidenceIds = [...new Set([...csvToIds(incident.evidenceIdsCsv), ...configuredIds])];
  const evidence = await Promise.all(evidenceIds.map((evidenceId) => readEvidence(evidenceId, transport)));
  const target = await readProtectedDemoState(transport);
  return {
    incident,
    evidence,
    target,
    authentication: "UNVERIFIED",
  };
}

const PROOF_LEDGER: Array<[string, string, string]> = [
  ["Controlled outflow", "Incident signal", FINAL_DEPLOYMENT.proof.outflow],
  ["Incident assessment", "Emergency consensus", FINAL_DEPLOYMENT.proof.incidentAssessment],
  ["Pause request", "Containment", FINAL_DEPLOYMENT.proof.pause],
  ["Remediation", "Containment", FINAL_DEPLOYMENT.proof.remediation],
  ["Begin recovery", "Recovery consensus", FINAL_DEPLOYMENT.proof.beginRecovery],
  ["Recovery assessment", "Recovery consensus", FINAL_DEPLOYMENT.proof.recoveryAssessment],
  ["Unpause request", "Restoration", FINAL_DEPLOYMENT.proof.unpause],
  ["Post-recovery process", "Permanent protection", FINAL_DEPLOYMENT.proof.postRecoveryProcess],
];

export async function readProofActivity(): Promise<ProofActivity[]> {
  const transport = createStudioNextClient();
  return Promise.all(PROOF_LEDGER.map(async ([label, stage, hash]) => {
    try {
      const lifecycle = await transport.getTransactionLifecycle(hash);
      return { label, stage, hash, status: lifecycle.status, consensus: lifecycle.status === "FINALIZED" ? "MAJORITY_AGREE" : "PENDING", execution: lifecycle.executionSucceeded === true ? "FINISHED_WITH_RETURN" : lifecycle.executionSucceeded === false ? "FINISHED_WITH_ERROR" : "UNKNOWN", executionSucceeded: lifecycle.executionSucceeded };
    } catch {
      return { label, stage, hash, status: "READ_ERROR", consensus: "UNKNOWN", execution: "UNKNOWN", executionSucceeded: null };
    }
  }));
}
