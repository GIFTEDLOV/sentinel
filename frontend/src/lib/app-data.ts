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
import { invalidateVerified, readSharedVerified, readVerified, verifiedReadKey, type VerifiedRead, type VerifiedReadIdentity } from "./verified-read-cache";

export interface DashboardSnapshot {
  protocol: ProtocolConfig | null;
  incidents: IncidentRecord[];
  target: ProtectedDemoState | null;
}

export interface VerifiedSnapshot<T> {
  data: T;
  verifiedAt: number;
}

interface ReadOptions {
  forceFresh?: boolean;
}

const DASHBOARD_KEY = verifiedReadKey("dashboard");
const PROTOCOL_KEY = verifiedReadKey("protocol");
const TARGET_KEY = verifiedReadKey("protected-demo");
const PROOF_ACTIVITY_KEY = verifiedReadKey("proof-activity");
const REFRESH_COOLDOWN_MS = 30_000;
let dashboardRefreshAt = 0;
let protocolRefreshAt = 0;
let targetRefreshAt = 0;
let proofRefreshAt = 0;
const dossierRefreshAt = new Map<string, number>();

function readIdentity(extra: Pick<VerifiedReadIdentity, "protocolId" | "incidentId"> = {}): VerifiedReadIdentity {
  return {
    chainId: sentinelClientConfig.chainId,
    sentinelAddress: sentinelClientConfig.contractAddress ?? null,
    protectedDemoAddress: sentinelClientConfig.protectedDemoAddress ?? null,
    protocolId: extra.protocolId ?? sentinelClientConfig.protocolId ?? null,
    incidentId: extra.incidentId ?? null,
  };
}

function incidentKey(incidentId: string): string {
  return verifiedReadKey("incident", incidentId);
}

function evidenceKey(evidenceId: string): string {
  return verifiedReadKey("evidence", evidenceId);
}

function dossierKey(incidentId: string): string {
  return verifiedReadKey("dossier", incidentId);
}

function snapshot<T>(record: VerifiedRead<T>): VerifiedSnapshot<T> {
  return { data: record.data, verifiedAt: record.verifiedAt };
}

function configuredAddress(value: string | null): value is string {
  return value !== null && value.startsWith("0x") && value.length === 42;
}

export function hasSentinelDeployment(): boolean {
  return configuredAddress(sentinelClientConfig.contractAddress);
}

async function readProtocolSnapshot(transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<ProtocolConfig | null>> {
  const protocolId = sentinelClientConfig.protocolId ?? null;
  return readSharedVerified(PROTOCOL_KEY, readIdentity({ protocolId }), async () => {
    if (!hasSentinelDeployment() || !protocolId) return null;
    const client = transport ?? createStudioNextClient();
    const raw = await client.readContract<unknown>({
      address: sentinelClientConfig.contractAddress as string,
      method: "get_protocol",
      args: [protocolId],
    });
    return decodeProtocol(raw, protocolId);
  }, options);
}

export function getCachedProtocol(): VerifiedSnapshot<ProtocolConfig | null> | null {
  const protocolId = sentinelClientConfig.protocolId ?? null;
  const record = readVerified<ProtocolConfig | null>(PROTOCOL_KEY, readIdentity({ protocolId }));
  return record ? snapshot(record) : null;
}

export async function refreshProtocol(): Promise<VerifiedSnapshot<ProtocolConfig | null>> {
  const cached = getCachedProtocol();
  if (cached && Date.now() - protocolRefreshAt < REFRESH_COOLDOWN_MS) return cached;
  protocolRefreshAt = Date.now();
  return snapshot(await readProtocolSnapshot(undefined, { forceFresh: true }));
}

export async function readProtocol(transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<ProtocolConfig | null> {
  return (await readProtocolSnapshot(transport, options)).data;
}

async function readIncidentSnapshot(incidentId: string, transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<IncidentRecord>> {
  return readSharedVerified(incidentKey(incidentId), readIdentity({ incidentId }), async () => {
    if (!hasSentinelDeployment()) throw new Error("Sentinel deployment is not configured.");
    const client = transport ?? createStudioNextClient();
    const raw = await client.readContract<unknown>({
      address: sentinelClientConfig.contractAddress as string,
      method: "get_incident",
      args: [incidentId],
    });
    return decodeIncident(raw, incidentId);
  }, options);
}

export async function readIncident(incidentId: string, transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<IncidentRecord> {
  return (await readIncidentSnapshot(incidentId, transport, options)).data;
}

async function readEvidenceSnapshot(evidenceId: string, transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<EvidenceMetadata>> {
  return readSharedVerified(evidenceKey(evidenceId), readIdentity(), async () => {
    if (!hasSentinelDeployment()) throw new Error("Sentinel deployment is not configured.");
    const client = transport ?? createStudioNextClient();
    const raw = await client.readContract<unknown>({
      address: sentinelClientConfig.contractAddress as string,
      method: "get_evidence",
      args: [evidenceId],
    });
    return decodeEvidence(raw, evidenceId);
  }, options);
}

export async function readEvidence(evidenceId: string, transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<EvidenceMetadata> {
  return (await readEvidenceSnapshot(evidenceId, transport, options)).data;
}

async function readTargetSnapshot(transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<ProtectedDemoState | null>> {
  return readSharedVerified(TARGET_KEY, readIdentity(), async () => {
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
  }, options);
}

export function getCachedProtectedDemoState(): VerifiedSnapshot<ProtectedDemoState | null> | null {
  const record = readVerified<ProtectedDemoState | null>(TARGET_KEY, readIdentity());
  return record ? snapshot(record) : null;
}

export async function refreshProtectedDemoState(): Promise<VerifiedSnapshot<ProtectedDemoState | null>> {
  const cached = getCachedProtectedDemoState();
  if (cached && Date.now() - targetRefreshAt < REFRESH_COOLDOWN_MS) return cached;
  targetRefreshAt = Date.now();
  return snapshot(await readTargetSnapshot(undefined, { forceFresh: true }));
}

export async function readProtectedDemoState(transport?: GenLayerTransport, options: ReadOptions = { forceFresh: true }): Promise<ProtectedDemoState | null> {
  return (await readTargetSnapshot(transport, options)).data;
}

async function readDashboardSnapshot(options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<DashboardSnapshot>> {
  return readSharedVerified(DASHBOARD_KEY, readIdentity(), async () => {
    const transport = createStudioNextClient();
    const [protocol, target, incidents] = await Promise.all([
      readProtocolSnapshot(transport, { forceFresh: true }),
      readTargetSnapshot(transport, { forceFresh: true }),
      Promise.all(sentinelClientConfig.incidentIds.map((incidentId) => readIncidentSnapshot(incidentId, transport, { forceFresh: true }))),
    ]);
    return { protocol: protocol.data, incidents: incidents.map((item) => item.data), target: target.data };
  }, options);
}

export function getCachedDashboard(): VerifiedSnapshot<DashboardSnapshot> | null {
  const record = readVerified<DashboardSnapshot>(DASHBOARD_KEY, readIdentity());
  return record ? snapshot(record) : null;
}

export async function refreshDashboard(): Promise<VerifiedSnapshot<DashboardSnapshot>> {
  const cached = getCachedDashboard();
  if (cached && Date.now() - dashboardRefreshAt < REFRESH_COOLDOWN_MS) return cached;
  dashboardRefreshAt = Date.now();
  const next = snapshot(await readDashboardSnapshot({ forceFresh: true }));
  protocolRefreshAt = dashboardRefreshAt;
  targetRefreshAt = dashboardRefreshAt;
  return next;
}

export async function readDashboard(options: ReadOptions = { forceFresh: true }): Promise<DashboardSnapshot> {
  return (await readDashboardSnapshot(options)).data;
}

async function readIncidentDossierSnapshot(incidentId: string, options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<IncidentDossier>> {
  return readSharedVerified(dossierKey(incidentId), readIdentity({ incidentId }), async () => {
    const transport = createStudioNextClient();
    const cachedIncident = readVerified<IncidentRecord>(incidentKey(incidentId), readIdentity({ incidentId }));
    const cachedTarget = getCachedProtectedDemoState();
    const [incidentRecord, targetRecord] = await Promise.all([
      readIncidentSnapshot(incidentId, transport, { forceFresh: !cachedIncident }),
      readTargetSnapshot(transport, { forceFresh: !cachedTarget }),
    ]);
    const configuredIds = incidentId === FINAL_DEPLOYMENT.incidentId ? Object.values(FINAL_DEPLOYMENT.evidenceIds) : [];
    const evidenceIds = [...new Set([...csvToIds(incidentRecord.data.evidenceIdsCsv), ...configuredIds])];
    const evidence = await Promise.all(evidenceIds.map((evidenceId) => readEvidenceSnapshot(evidenceId, transport, { forceFresh: true })));
    return {
      incident: incidentRecord.data,
      evidence: evidence.map((item) => item.data),
      target: targetRecord.data,
      authentication: "UNVERIFIED",
    };
  }, options);
}

export function getCachedIncidentDossier(incidentId: string): VerifiedSnapshot<IncidentDossier> | null {
  const record = readVerified<IncidentDossier>(dossierKey(incidentId), readIdentity({ incidentId }));
  return record ? snapshot(record) : null;
}

export async function refreshIncidentDossier(incidentId: string): Promise<VerifiedSnapshot<IncidentDossier>> {
  const cached = getCachedIncidentDossier(incidentId);
  const lastRefresh = dossierRefreshAt.get(incidentId) ?? 0;
  if (cached && Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return cached;
  dossierRefreshAt.set(incidentId, Date.now());
  return snapshot(await readIncidentDossierSnapshot(incidentId, { forceFresh: true }));
}

export async function readIncidentDossier(incidentId: string, options: ReadOptions = { forceFresh: true }): Promise<IncidentDossier> {
  return (await readIncidentDossierSnapshot(incidentId, options)).data;
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

async function readProofActivitySnapshot(options: ReadOptions = { forceFresh: true }): Promise<VerifiedRead<ProofActivity[]>> {
  return readSharedVerified(PROOF_ACTIVITY_KEY, readIdentity(), async () => {
    const transport = createStudioNextClient();
    return Promise.all(PROOF_LEDGER.map(async ([label, stage, hash]) => {
      try {
        const lifecycle = await transport.getTransactionLifecycle(hash);
        return { label, stage, hash, status: lifecycle.status, consensus: lifecycle.status === "FINALIZED" ? "MAJORITY_AGREE" : "PENDING", execution: lifecycle.executionSucceeded === true ? "FINISHED_WITH_RETURN" : lifecycle.executionSucceeded === false ? "FINISHED_WITH_ERROR" : "UNKNOWN", executionSucceeded: lifecycle.executionSucceeded };
      } catch {
        return { label, stage, hash, status: "READ_ERROR", consensus: "UNKNOWN", execution: "UNKNOWN", executionSucceeded: null };
      }
    }));
  }, options);
}

export function getCachedProofActivity(): VerifiedSnapshot<ProofActivity[]> | null {
  const record = readVerified<ProofActivity[]>(PROOF_ACTIVITY_KEY, readIdentity());
  return record ? snapshot(record) : null;
}

export async function refreshProofActivity(): Promise<VerifiedSnapshot<ProofActivity[]>> {
  const cached = getCachedProofActivity();
  if (cached && Date.now() - proofRefreshAt < REFRESH_COOLDOWN_MS) return cached;
  proofRefreshAt = Date.now();
  return snapshot(await readProofActivitySnapshot({ forceFresh: true }));
}

export async function readProofActivity(options: ReadOptions = { forceFresh: true }): Promise<ProofActivity[]> {
  return (await readProofActivitySnapshot(options)).data;
}

export function invalidateVerifiedReadCaches(incidentId = FINAL_DEPLOYMENT.incidentId): void {
  dashboardRefreshAt = 0;
  protocolRefreshAt = 0;
  targetRefreshAt = 0;
  proofRefreshAt = 0;
  dossierRefreshAt.delete(incidentId);
  invalidateVerified(DASHBOARD_KEY);
  invalidateVerified(PROTOCOL_KEY);
  invalidateVerified(TARGET_KEY);
  invalidateVerified(PROOF_ACTIVITY_KEY);
  invalidateVerified(incidentKey(incidentId));
  invalidateVerified(dossierKey(incidentId));
}
