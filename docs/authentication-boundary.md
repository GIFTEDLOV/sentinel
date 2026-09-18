# Authentication-first boundary

Sentinel treats evidence authentication as a protocol gate, not as a hint to a semantic model.

```text
authenticated evidence
        ↓
semantic assessment
        ↓
bounded lifecycle transition
```

If the evidence cannot be proven complete and bound to the protected protocol and incident, progression stops:

```text
missing / stale / malformed / unavailable evidence
        ↓
BLOCKED
        ↓
owner resolves evidence and requests retry
```

## Threat model

The boundary assumes that external sources, verifier endpoints, transport, and retrieved documents can be unavailable, malformed, stale, inconsistent, or hostile. A source response is not trusted because it is reachable. The deterministic authentication path checks the locked source policy, digest, schema, protocol and target binding, incident/phase binding, freshness, and distinct-source requirements before any semantic assessment.

GenLayer validators answer the bounded semantic question only over the authenticated, normalized facts. They do not authenticate URLs, recover missing evidence, or turn an unavailable verifier into an approval.

## Authentication states

- `PENDING` means evidence collection is still in progress.
- `VERIFIED` means every required authentication condition passed for the current phase.
- `BLOCKED` means automatic progression stopped because the required evidence set or an authentication check failed.

`BLOCKED` is not a semantic verdict. It cannot transition directly to `ACTIVE_INCIDENT`, `SAFE_TO_RECOVER`, or `RECOVERED`.

The same boundary is applied independently to incident evidence and recovery evidence. Recovery does not reuse an incident decision as permission to restore operation.

## Owner-owned stop condition

The existing protected protocol owner (`ProtocolConfig.owner`) is the only authority allowed to call `retry_authentication(incident_id)`. This is a continuation control, not an approval override. The call re-runs deterministic authentication against the stored evidence candidates. It remains `BLOCKED` if the evidence is still unavailable or invalid and becomes `VERIFIED` only when every required check passes. Only then can the normal semantic assessment entry point be called.

There is deliberately no `force_verify`, `force_approve`, `manual_recover`, or administrator verdict setter. A protocol owner cannot bypass the evidence gate.

## Decision-input commitments

Every semantic assessment records a compact `DecisionInputRecord` containing the assessment and incident identities, protocol and target, chain and Sentinel identity, question version, evidence IDs, source domains, evidence digests, authentication counts, binding checks, verdict, criteria result, timestamp, and resulting lifecycle state.

The `decision_input_hash` is a SHA-256 commitment over an explicit versioned/domain-separated JSON structure. Evidence entries are sorted by evidence ID and include their immutable digest, source identity, and contract observation timestamp. The question templates are versioned as `INCIDENT_ASSESSMENT_V1` and `RECOVERY_ASSESSMENT_V1`.

The contract stores commitments and identifiers rather than duplicating large raw documents.

## Failure behavior

Verifier outage, timeout, malformed response, digest mismatch, stale evidence, insufficient evidence, duplicate source identity, target/protocol/incident binding failure, and deterministic authentication errors all produce `BLOCKED` with a structured code. The contract does not map these failures to `NO_ACTIVE_INCIDENT`, `SAFE_TO_RECOVER`, or any other approval.

Semantic execution exceptions remain fail-closed as `INCONCLUSIVE`; they are not reclassified as successful authentication.

## Historical records

The final historical incident predates decision-input records. The application therefore labels unavailable historical commitments and question versions `LEGACY / NOT RECORDED` instead of fabricating a hash or claiming a record existed. New deployments expose the authentication state and decision-input view directly.

## Verification

The contract tests cover verifier outage, timeout/transport failure, malformed evidence, digest mismatch, stale and insufficient evidence, duplicate sources, blocked assessment without a semantic invocation, owner retry while still blocked and after correction, unauthorized retry rejection, absence of manual bypass methods, and deterministic decision-input records.

The incident command center exposes authentication checks separately from semantic assessment. The Proof & Security page documents the boundary and distinguishes legacy historical fields from records created by the hardened schema.
