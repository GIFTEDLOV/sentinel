import type {
  EmergencyVerdict,
  EvidenceMetadata,
  AuthenticationState,
  DecisionInput,
  IncidentRecord,
  IncidentState,
  ProtectedDemoState,
  ProtocolConfig,
  RecoveryVerdict,
} from "../models";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown, fallback = "—"): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function authenticationState(value: unknown): AuthenticationState | undefined {
  if (value === "PENDING" || value === "VERIFIED" || value === "BLOCKED") return value;
  return undefined;
}

function incidentState(value: unknown): IncidentState {
  const candidate = stringValue(value, "ASSESSING");
  const states: IncidentState[] = [
    "NORMAL",
    "ASSESSING",
    "ACTIVE_INCIDENT",
    "PAUSED",
    "RECOVERY_ASSESSING",
    "RECOVERY_AUTHORIZED",
    "RECOVERED",
  ];
  return states.includes(candidate as IncidentState) ? (candidate as IncidentState) : "ASSESSING";
}

function emergencyVerdict(value: unknown): EmergencyVerdict {
  const candidate = stringValue(value, "INCONCLUSIVE");
  return candidate === "ACTIVE_INCIDENT" || candidate === "NO_ACTIVE_INCIDENT"
    ? candidate
    : "INCONCLUSIVE";
}

function recoveryVerdict(value: unknown): RecoveryVerdict {
  const candidate = stringValue(value, "INCONCLUSIVE");
  return candidate === "SAFE_TO_RECOVER" || candidate === "NOT_SAFE_TO_RECOVER"
    ? candidate
    : "INCONCLUSIVE";
}

export function decodeProtocol(value: unknown, protocolId?: string): ProtocolConfig {
  const data = record(value);
  return {
    protocolId,
    targetAddress: stringValue(data.target_address ?? data.targetAddress),
    owner: stringValue(data.owner),
    policyLocked: booleanValue(data.policy_locked ?? data.policyLocked),
    criticalFailureClass: stringValue(data.critical_failure_class ?? data.criticalFailureClass),
    allowedSourceDomains: stringValue(data.allowed_source_domains ?? data.allowedSourceDomains),
    allowedSourcePrefixes: stringValue(data.allowed_source_prefixes ?? data.allowedSourcePrefixes),
    minimumSources: numberValue(data.minimum_sources ?? data.minimumSources),
    maxEvidenceAgeSeconds: numberValue(
      data.max_evidence_age_seconds ?? data.maxEvidenceAgeSeconds,
    ),
    recoveryCooldownSeconds: numberValue(
      data.recovery_cooldown_seconds ?? data.recoveryCooldownSeconds,
    ),
  };
}

export function decodeIncident(value: unknown, incidentId?: string): IncidentRecord {
  const data = record(value);
  return {
    incidentId,
    protocolId: stringValue(data.protocol_id ?? data.protocolId),
    reporter: stringValue(data.reporter),
    openedAt: numberValue(data.opened_at ?? data.openedAt),
    state: incidentState(data.state),
    incidentVerdict: emergencyVerdict(data.incident_verdict ?? data.incidentVerdict),
    recoveryVerdict: recoveryVerdict(data.recovery_verdict ?? data.recoveryVerdict),
    evidenceIdsCsv: stringValue(data.evidence_ids_csv ?? data.evidenceIdsCsv, ""),
    sourceDomainsCsv: stringValue(data.source_domains_csv ?? data.sourceDomainsCsv, ""),
    pauseRequested: booleanValue(data.pause_requested ?? data.pauseRequested),
    pauseConfirmedAt: numberValue(data.pause_confirmed_at ?? data.pauseConfirmedAt),
    unpauseRequested: booleanValue(data.unpause_requested ?? data.unpauseRequested),
    incidentAuthenticationState: authenticationState(data.incident_authentication_state ?? data.incidentAuthenticationState),
    incidentAuthenticationBlockCode: typeof (data.incident_authentication_block_code ?? data.incidentAuthenticationBlockCode) === "string" ? (data.incident_authentication_block_code ?? data.incidentAuthenticationBlockCode) as string : undefined,
    incidentAuthenticationBlockedAt: numberValue(data.incident_authentication_blocked_at ?? data.incidentAuthenticationBlockedAt),
    incidentEvidenceCommitment: typeof (data.incident_evidence_commitment ?? data.incidentEvidenceCommitment) === "string" ? (data.incident_evidence_commitment ?? data.incidentEvidenceCommitment) as string : undefined,
    recoveryAuthenticationState: authenticationState(data.recovery_authentication_state ?? data.recoveryAuthenticationState),
    recoveryAuthenticationBlockCode: typeof (data.recovery_authentication_block_code ?? data.recoveryAuthenticationBlockCode) === "string" ? (data.recovery_authentication_block_code ?? data.recoveryAuthenticationBlockCode) as string : undefined,
    recoveryAuthenticationBlockedAt: numberValue(data.recovery_authentication_blocked_at ?? data.recoveryAuthenticationBlockedAt),
    recoveryEvidenceCommitment: typeof (data.recovery_evidence_commitment ?? data.recoveryEvidenceCommitment) === "string" ? (data.recovery_evidence_commitment ?? data.recoveryEvidenceCommitment) as string : undefined,
    incidentAssessmentId: typeof (data.incident_assessment_id ?? data.incidentAssessmentId) === "string" ? (data.incident_assessment_id ?? data.incidentAssessmentId) as string : undefined,
    recoveryAssessmentId: typeof (data.recovery_assessment_id ?? data.recoveryAssessmentId) === "string" ? (data.recovery_assessment_id ?? data.recoveryAssessmentId) as string : undefined,
    incidentAssessmentCount: numberValue(data.incident_assessment_count ?? data.incidentAssessmentCount),
    recoveryAssessmentCount: numberValue(data.recovery_assessment_count ?? data.recoveryAssessmentCount),
  };
}

export function decodeEvidence(value: unknown, evidenceId?: string): EvidenceMetadata {
  const data = record(value);
  const phase = stringValue(data.phase, "EMERGENCY");
  const evidenceType = stringValue(data.evidence_type ?? data.evidenceType, "TRANSACTION");
  return {
    evidenceId,
    incidentId: stringValue(data.incident_id ?? data.incidentId),
    phase: phase === "RECOVERY" ? "RECOVERY" : "EMERGENCY",
    evidenceType:
      evidenceType === "CHAIN_TRANSACTION" || evidenceType === "PROTECTED_STATE" || evidenceType === "SECURITY_ADVISORY"
        ? evidenceType
        : "TRANSACTION",
    sourceUrl: stringValue(data.source_url ?? data.sourceUrl),
    sourceDomain: stringValue(data.source_domain ?? data.sourceDomain),
    failureClass: stringValue(data.failure_class ?? data.failureClass),
    observedAt: numberValue(data.observed_at ?? data.observedAt),
    contentDigest: stringValue(data.content_digest ?? data.contentDigest),
    transactionHash: stringValue(data.transaction_hash ?? data.transactionHash),
    transactionBlock: numberValue(data.transaction_block ?? data.transactionBlock),
    authenticatedStatus: stringValue(data.authenticated_status ?? data.authenticatedStatus, "UNVERIFIED"),
    authenticationState: authenticationState(data.authentication_state ?? data.authenticationState),
    authenticationBlockCode: typeof (data.authentication_block_code ?? data.authenticationBlockCode) === "string" ? (data.authentication_block_code ?? data.authenticationBlockCode) as string : undefined,
    contentLength: numberValue(data.content_length ?? data.contentLength),
  };
}

export function decodeDecisionInput(value: unknown): DecisionInput {
  const data = record(value);
  const phase = stringValue(data.phase, "EMERGENCY");
  const state = authenticationState(data.authentication_state ?? data.authenticationState) ?? "LEGACY";
  return {
    assessmentId: stringValue(data.assessment_id ?? data.assessmentId, ""),
    incidentId: stringValue(data.incident_id ?? data.incidentId, ""),
    protocolId: stringValue(data.protocol_id ?? data.protocolId, ""),
    phase: phase === "RECOVERY" ? "RECOVERY" : "EMERGENCY",
    targetAddress: stringValue(data.target_address ?? data.targetAddress, ""),
    chainId: numberValue(data.chain_id ?? data.chainId),
    sentinelAddress: stringValue(data.sentinel_address ?? data.sentinelAddress, ""),
    questionVersion: stringValue(data.question_version ?? data.questionVersion, "LEGACY / NOT RECORDED"),
    evidenceIdsCsv: stringValue(data.evidence_ids_csv ?? data.evidenceIdsCsv, ""),
    sourceDomainsCsv: stringValue(data.source_domains_csv ?? data.sourceDomainsCsv, ""),
    evidenceDigestsCsv: stringValue(data.evidence_digests_csv ?? data.evidenceDigestsCsv, ""),
    sourceCount: numberValue(data.source_count ?? data.sourceCount),
    authenticatedCount: numberValue(data.authenticated_count ?? data.authenticatedCount),
    freshCount: numberValue(data.fresh_count ?? data.freshCount),
    distinctCount: numberValue(data.distinct_count ?? data.distinctCount),
    targetBindingVerified: booleanValue(data.target_binding_verified ?? data.targetBindingVerified),
    protocolBindingVerified: booleanValue(data.protocol_binding_verified ?? data.protocolBindingVerified),
    incidentBindingVerified: booleanValue(data.incident_binding_verified ?? data.incidentBindingVerified),
    distinctSourcesVerified: booleanValue(data.distinct_sources_verified ?? data.distinctSourcesVerified),
    authenticationState: state,
    decisionInputHash: stringValue(data.decision_input_hash ?? data.decisionInputHash, ""),
    verdict: stringValue(data.verdict, "INCONCLUSIVE"),
    criteriaMet: booleanValue(data.criteria_met ?? data.criteriaMet),
    assessmentTimestamp: numberValue(data.assessment_timestamp ?? data.assessmentTimestamp),
    resultingState: stringValue(data.resulting_state ?? data.resultingState, ""),
  };
}

export function decodeProtectedDemoState(
  address: string,
  values: { owner: unknown; authorizedSentinel: unknown; controllerConfigured: unknown; paused: unknown; remediated?: unknown; totalProcessed: unknown; treasury?: unknown; lastOutflow?: unknown; counters?: unknown },
): ProtectedDemoState {
  const treasury = record(values.treasury);
  const lastOutflow = record(values.lastOutflow);
  const counters = record(values.counters);
  return {
    address,
    owner: stringValue(values.owner),
    authorizedSentinel: stringValue(values.authorizedSentinel),
    controllerConfigured: booleanValue(values.controllerConfigured),
    paused: booleanValue(values.paused),
    remediated: booleanValue(values.remediated),
    totalProcessed: numberValue(values.totalProcessed),
    treasuryBalance: numberValue(treasury.treasury_balance ?? treasury.treasuryBalance),
    totalOutflow: numberValue(treasury.total_outflow ?? treasury.totalOutflow),
    lastOutflow: {
      actor: stringValue(lastOutflow.actor),
      amount: numberValue(lastOutflow.amount),
      recipient: stringValue(lastOutflow.recipient),
    },
    pauseCount: numberValue(counters.pause_count ?? counters.pauseCount),
    unpauseCount: numberValue(counters.unpause_count ?? counters.unpauseCount),
  };
}

export function csvToIds(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function mapIncidentStateToLabel(state: IncidentState): string {
  return state.replaceAll("_", " ");
}
