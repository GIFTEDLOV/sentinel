export type IncidentState =
  | "NORMAL"
  | "ASSESSING"
  | "ACTIVE_INCIDENT"
  | "PAUSED"
  | "RECOVERY_ASSESSING"
  | "RECOVERY_AUTHORIZED"
  | "RECOVERED";

export type EmergencyVerdict =
  | "ACTIVE_INCIDENT"
  | "NO_ACTIVE_INCIDENT"
  | "INCONCLUSIVE";

export type RecoveryVerdict =
  | "SAFE_TO_RECOVER"
  | "NOT_SAFE_TO_RECOVER"
  | "INCONCLUSIVE";

export interface ProtocolConfig {
  protocolId?: string;
  targetAddress: string;
  owner: string;
  policyLocked: boolean;
  criticalFailureClass: string;
  allowedSourceDomains: string;
  allowedSourcePrefixes?: string;
  minimumSources: number;
  maxEvidenceAgeSeconds: number;
  recoveryCooldownSeconds: number;
}

export interface IncidentRecord {
  incidentId?: string;
  protocolId: string;
  reporter: string;
  openedAt: number;
  state: IncidentState;
  incidentVerdict: EmergencyVerdict;
  recoveryVerdict: RecoveryVerdict;
  evidenceIdsCsv: string;
  sourceDomainsCsv: string;
  pauseRequested: boolean;
  pauseConfirmedAt: number;
  unpauseRequested: boolean;
}

export interface EvidenceMetadata {
  evidenceId?: string;
  incidentId: string;
  phase: "EMERGENCY" | "RECOVERY";
  evidenceType: "TRANSACTION" | "CHAIN_TRANSACTION" | "PROTECTED_STATE" | "SECURITY_ADVISORY";
  sourceUrl: string;
  sourceDomain: string;
  failureClass: string;
  observedAt: number;
  contentDigest: string;
  transactionHash: string;
  transactionBlock: number;
  authenticatedStatus?: string;
}

export interface ProtectedDemoState {
  address: string;
  owner: string;
  authorizedSentinel: string;
  controllerConfigured: boolean;
  paused: boolean;
  remediated: boolean;
  totalProcessed: number;
  treasuryBalance: number;
  totalOutflow: number;
  lastOutflow: { actor: string; amount: number; recipient: string };
  pauseCount: number;
  unpauseCount: number;
}

export type EvidenceAuthenticationStatus = "AUTHENTICATED" | "UNVERIFIED";

export interface IncidentDossier {
  incident: IncidentRecord;
  evidence: EvidenceMetadata[];
  authentication: EvidenceAuthenticationStatus;
  target: ProtectedDemoState | null;
}

export interface ProofActivity {
  label: string;
  stage: string;
  hash: string;
  status: string;
  consensus: string;
  execution: string;
  executionSucceeded: boolean | null;
}
