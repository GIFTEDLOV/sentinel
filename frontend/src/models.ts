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
  incidentAuthenticationState?: AuthenticationState;
  incidentAuthenticationBlockCode?: string;
  incidentAuthenticationBlockedAt?: number;
  incidentEvidenceCommitment?: string;
  recoveryAuthenticationState?: AuthenticationState;
  recoveryAuthenticationBlockCode?: string;
  recoveryAuthenticationBlockedAt?: number;
  recoveryEvidenceCommitment?: string;
  incidentAssessmentId?: string;
  recoveryAssessmentId?: string;
  incidentAssessmentCount?: number;
  recoveryAssessmentCount?: number;
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
  authenticationState?: AuthenticationState;
  authenticationBlockCode?: string;
  contentLength?: number;
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

export type AuthenticationState = "PENDING" | "VERIFIED" | "BLOCKED" | "LEGACY";

export interface AuthenticationPhaseStatus {
  state: AuthenticationState;
  blockCode?: string;
  blockedAt?: number;
  evidenceCommitment?: string;
}

export interface DecisionInput {
  assessmentId: string;
  incidentId: string;
  protocolId: string;
  phase: "EMERGENCY" | "RECOVERY";
  targetAddress: string;
  chainId: number;
  sentinelAddress: string;
  questionVersion: string;
  evidenceIdsCsv: string;
  sourceDomainsCsv: string;
  evidenceDigestsCsv: string;
  sourceCount: number;
  authenticatedCount: number;
  freshCount: number;
  distinctCount: number;
  targetBindingVerified: boolean;
  protocolBindingVerified: boolean;
  incidentBindingVerified: boolean;
  distinctSourcesVerified: boolean;
  authenticationState: AuthenticationState;
  decisionInputHash: string;
  verdict: string;
  criteriaMet: boolean;
  assessmentTimestamp: number;
  resultingState: string;
}

export interface IncidentAuthenticationSummary {
  incident: AuthenticationPhaseStatus;
  recovery: AuthenticationPhaseStatus;
}

export interface IncidentDossier {
  incident: IncidentRecord;
  evidence: EvidenceMetadata[];
  authentication: IncidentAuthenticationSummary;
  incidentDecision?: DecisionInput | null;
  recoveryDecision?: DecisionInput | null;
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
