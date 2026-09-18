# Final Contract Hardening Plan

Status: read-only analysis completed 2026-09-12.

This plan separates contract correctness from product observability. The recommended minimal live-proof path does not modify or redeploy the frozen contracts. It uses a second protocol id with real evidence domains and solves list/history/explanation needs in an off-chain proof projection. Contract hardening is still documented here for a later final release because several current behaviors are weaker than the product’s claims.

## Decision summary

```text
FINAL_CONTRACT_CHANGE_REQUIRED_FOR_MINIMAL_LIVE_PROOF: NO
FINAL_REDEPLOYMENT_REQUIRED_FOR_MINIMAL_LIVE_PROOF: NO
RECOMMENDED_PATH: Option B — new protocol id, same Sentinel, same configured ProtectedDemo, real evidence origins.
HARDENING_REQUIRED_BEFORE_CLAIMING_PRODUCTION-GRADE EVIDENCE FRESHNESS: YES
HARDENING_REQUIRED_BEFORE_CLAIMING ONCHAIN EXPLAINABILITY: YES, unless the UI uses a clearly labeled proof projection.
```

The current source hashes and deployed addresses remain valid for the minimal proof. Changing the source would require a new deployment sequence and would expand risk without fixing the locked `.example` policy on the existing `demo` record.

## Existing protections that should be retained

The current source already provides useful safety boundaries:

- Policy owner controls registration-time policy changes and the permanent lock.
- Evidence must match the protocol id, target address, incident id, phase, and failure class.
- HTTPS, direct-path URL shape, exact hostname allowlisting, SHA-256 body digest, JSON schema, target association, and timestamp checks are enforced at bind/authentication boundaries.
- Body size is capped at 64 KiB.
- Any unavailable, malformed, digest-mismatched, conflicting, or insufficient evidence fails closed to `INCONCLUSIVE`.
- Emergency and recovery phases are separated.
- Recovery requires a new assessment and never follows automatically from the earlier incident verdict.
- Pause and unpause are restricted by the target’s configured Sentinel address.
- The target is not marked paused or recovered until a target view confirms the actual state.
- Raw evidence is marked untrusted in the validator prompt, and objective boolean facts gate affirmative outcomes.

The official GenLayer guidance supports this general shape: web and LLM results are nondeterministic, so contracts should extract stable fields, validate provenance and objective constraints, require corroboration, and handle unavailable/adversarial data explicitly. See [web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access), [non-deterministic operations](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/non-deterministic-operations-handling), and [LLM integration](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/large-language-model-llm-integration).

## Hardening classification matrix

Classification meanings:

- `REQUIRED_FOR_CORRECTNESS`: a safety or trust claim is incomplete or potentially false without the change or an equivalent control.
- `REQUIRED_FOR_WINNING_UX`: the core lifecycle can work, but the product cannot explain or prove it cleanly to a judge without the change or an equivalent projection.
- `GOOD_TO_HAVE`: valuable robustness or ergonomics, but not a release gate for the minimal proof.
- `DO_NOT_ADD`: already covered, redundant onchain state, or better solved outside the contract.

| Area | Classification | Current finding | Smallest technically correct response |
|---|---|---|---|
| Protocol enumeration | `DO_NOT_ADD` onchain | No enumeration view; the registry is keyed storage | Use an explicit registry/config source or off-chain index. Do not bloat the contract with an unbounded list view. |
| Incident enumeration | `REQUIRED_FOR_WINNING_UX` | Only `get_incident(id)` exists | Index finalized incident-opening and lifecycle writes offchain; retain direct reads as authority. Add an onchain enumerable structure only if a trustless public directory is a hard requirement. |
| Evidence enumeration | `REQUIRED_FOR_WINNING_UX` | Evidence ids are returned only as a CSV inside one incident | Project attached ids and their `get_evidence` records offchain; show the source and indexing freshness. |
| Explicit persisted assessment reason | `REQUIRED_FOR_WINNING_UX` | `_judge_evidence` creates a free-text reason, but `IncidentRecord` does not store it; reason is not part of validator stable-field equality | Do not persist leader prose as authenticated truth. Persist a consensus-stable reason code/criteria packet (or project it from a full receipt with a “receipt-derived” label). |
| Persisted evidence-authentication result | `REQUIRED_FOR_WINNING_UX` | Authentication is performed during each assessment but `get_evidence` exposes only bound metadata | Persist or project per-source status, checked digest, checked phase, and assessment result. A proof projection is the smallest path; onchain attestation is the stronger later design. |
| Duplicate-source detection | `REQUIRED_FOR_CORRECTNESS` for a strong independence claim; `GOOD_TO_HAVE` for the current quorum | Distinct domains are counted, so same-domain duplication cannot satisfy `minimum_sources=2`; URL duplication and operator/control duplication are not detected | Keep domain deduplication, add a source registry or explicit source identity/ownership model. Do not call hostname difference “independent organizations” without that model. |
| Duplicate-evidence protection | `DO_NOT_ADD` | Evidence ids are globally unique and attachment checks prevent rebinding | Keep current checks. Optional duplicate URL warnings belong in the UI/indexer. |
| Emergency/recovery phase separation | `DO_NOT_ADD` | Phase and incident state must match; `begin_recovery` clears prior attachment CSVs; tests cover fresh recovery evidence | Keep and add regression tests when other hardening changes land. |
| Stale-evidence enforcement | `REQUIRED_FOR_CORRECTNESS` | Corrected in the RC2 source-only patch | Assign internal GenVM observation time after authentication and revalidate every incident/recovery record at assessment in that same clock domain. |
| Canonical domain parsing | `REQUIRED_FOR_CORRECTNESS` for hostile/public sources | Parser requires HTTPS/path/dot and rejects query/fragment/space/port/user-info, but does not validate a full hostname grammar, trailing-dot equivalence, IDNA, or canonical redirects; allowlist whitespace is not trimmed | Define canonical hostname normalization once, validate it strictly, and use a normalized allowlist. Avoid weakening already locked policy semantics in place. |
| HTTPS-only enforcement | `DO_NOT_ADD` | `source_url.startswith("https://")` is enforced | Retain it; combine it with a direct no-redirect source requirement. |
| Redirect handling | `REQUIRED_FOR_CORRECTNESS` for provenance | Contract does not receive redirect history from the observed web API | Require redirect-free immutable endpoints or a signed/content-addressed envelope whose origin can be checked. Do not infer redirect safety from local mocks. |
| Content-size limits | `DO_NOT_ADD` for the current proof | Response body is capped at 64 KiB before decoding | Retain the cap. Add field-length limits only if prompt cost/abuse becomes a demonstrated problem. |
| Prompt-injection boundaries | `DO_NOT_ADD` for the current proof; `GOOD_TO_HAVE` for further minimization | Raw body is labeled untrusted; locked instructions and objective boolean gates constrain the decision | Retain the boundary. Prefer structured facts and bounded narrative; never make narrative or reporter identity an authority field. |
| Target-state readback abstraction | `DO_NOT_ADD` onchain | `ProtectedTarget` already exposes `is_paused`, `get_authorized_sentinel`, `emergency_pause`, and `emergency_unpause` | Use target adapters/capability metadata in the frontend. Keep ProtectedDemo-specific counters out of the generic interface. |
| Reusable protected-protocol interface | `DO_NOT_ADD` | The minimum Sentinel controller interface is already reusable | Document the interface and provide an integration test/template; do not add target-specific methods to Sentinel. |
| Lifecycle event/history support | `REQUIRED_FOR_WINNING_UX` | Records store current flags/timestamps but no durable human-readable history or event stream is exposed | Use a local/hosted receipt projection now. Consider explicit lifecycle events or append-only history only after the chain event/message API is confirmed. |
| UI-friendly views | `REQUIRED_FOR_WINNING_UX` | `get_protocol`, `get_incident`, and `get_evidence` are usable but omit protocol id in `get_protocol`, reason, auth results, validator details, child hashes, and target proof | Add a projection/API with explicit provenance; later add compact view structs if public onchain proof is a product requirement. |
| Permissionless incident writes | `GOOD_TO_HAVE` | Incident open, evidence bind, assessment, pause request, and confirmation are permissionless subject to state/evidence gates | Keep permissionless reporting if intended, but add spam/rate-limit/indexing controls offchain and document that reporter identity is not evidence. Owner-only gating would change the product model and is not required for correctness of the pause guard. |
| Policy revision/lock metadata | `GOOD_TO_HAVE` | Lock is a boolean; no policy revision or lock timestamp is exposed | Add only if policy history or audit UX requires it. A projection can timestamp the lock transaction now. |

## Correctness gaps that matter most

### 1. Freshness expires after bind

Current behavior:

```text
bind fresh evidence → wait past max age → assess
```

The corrected contract stores an internal GenVM observation time only after
supported evidence authentication succeeds. Assessment revalidates every
record against current GenVM time, so the policy's age window means the time
between Sentinel observation and decision. Canonical RPC event timestamps remain
authenticated external facts and are not used as this freshness clock.

### 2. Hostname diversity is not organizational independence

The contract requires distinct domains, which prevents two URLs on one hostname from satisfying a two-domain quorum. It does not prove that two domains are independent. Two domains may be controlled by one operator, mirror the same artifact, or derive from the same upstream. The minimal path should use an offchain source registry and honest UI wording. A stronger contract version can require registered source identities and signed attestations.

### 3. Redirect provenance is outside the contract’s observable fields

The local SDK response shape contains status, headers, and body but no redirect chain. The contract can authenticate the fetched bytes and their digest, not the transport history. The source publication requirement should therefore be direct and redirect-free. If the hosted GenVM later exposes final URL/redirect metadata, add a deterministic check; until then, do not claim redirect provenance.

### 4. Explanations are not consensus-authenticated state

The contract’s validator comparison excludes `reason`. Two validators can accept the same stable verdict and produce different prose. The public `get_incident` view omits the reason entirely. A product can show a receipt-derived reason only with a visible source label and should center its explanation on consensus-stable facts and the exact state transitions. If onchain explainability is required, persist a bounded deterministic reason code, not arbitrary LLM prose.

## Recommended future hardening design

If a new final Sentinel source is eventually deployed, the smallest useful contract changes are:

1. Revalidate evidence freshness immediately before the nondeterministic judge runs.
2. Store a compact consensus-stable assessment packet: phase, verdict, criteria flag, authenticated-source count, distinct-domain count, objective booleans, and a bounded reason code chosen deterministically from those fields.
3. Store per-evidence authentication status or an attestation summary keyed by evidence id, with the checked digest and assessment transaction reference.
4. Introduce an explicit source registry or source identity field if the protocol promises organizational independence rather than domain diversity.
5. Add lifecycle event/history support only if the public proof surface must be entirely onchain; otherwise keep history in a receipt-indexed projection.

These changes would require new contract source hashes, schema validation, fee profiling, deployment, controller setup, registration, policy lock, and a fresh lifecycle proof. They are not prerequisites for Option B’s real-source proof if the UI makes the current limitations explicit.

## Frontend blocker disposition

The existing frontend audit identified the following issues. The recommended ownership is:

| Blocker | Resolution boundary | Rationale |
|---|---|---|
| No protocol enumeration | `OFFCHAIN FRONTEND INDEX` | The contract intentionally exposes keyed views, not unbounded enumeration. Index known registration transactions/ids and label freshness/source. |
| No incident enumeration | `OFFCHAIN FRONTEND INDEX` | Project incident ids from finalized writes or a later event stream. Direct `get_incident` remains authoritative for current state. |
| No evidence enumeration | `OFFCHAIN FRONTEND INDEX` | Parse incident evidence ids, fetch each `get_evidence`, and reconcile against the indexed write. |
| Authentication/reason not persisted | `LOCAL TRANSACTION/EVENT PROJECTION` for the immediate product; `ONCHAIN` only for a later trustless proof requirement | The current view does not expose them. Project full receipts/trace data where available, show “receipt-derived,” and do not call it onchain state. |
| Target interface narrower than ProtectedDemo reads | `NOT NECESSARY` onchain; `OFFCHAIN FRONTEND INDEX` for capabilities | Sentinel’s generic target interface is sufficient for pause/unpause proof. ProtectedDemo counters and owner are optional adapter details. |
| Bradbury/4221 configuration | `OFFCHAIN FRONTEND INDEX` / frontend configuration | Replace environment and client defaults with Studio Next chain 61997 and current addresses; this is not a contract concern. |
| Stale contract addresses | `OFFCHAIN FRONTEND INDEX` / frontend configuration | Validate address/network pairs at runtime and source them from environment or a deployment manifest. |
| No proof projection/indexer | `OFFCHAIN FRONTEND INDEX` with `LOCAL TRANSACTION/EVENT PROJECTION` for pending writes | A hosted index provides public history; local storage keeps the browser from losing a submitted hash during refresh. |

## What should not be added to Sentinel

Do not add an unbounded protocol/incident/evidence enumeration surface merely to make a browser list easier. Do not put ProtectedDemo-specific counters, UI labels, wallet state, fee details, or raw validator receipts into the core Sentinel contract. Do not persist unverified LLM prose as if it were a consensus fact. Do not add autonomous watcher authority that can bypass the locked policy, authenticated evidence, validator consensus, target call, and readback chain.

## Migration consequence

For the currently deployed and locked `demo`, no in-place policy repair is possible. The smallest safe route is:

```text
qualify real sources
  → register a second protocol id against the existing target
  → lock the new policy
  → use phase-specific fresh evidence
  → reconcile every write and target readback
  → project the proof for the frontend
```

Deploying a new pair is justified only if the final showcase requires contract hardening, isolation from the existing ProtectedDemo, or a trustless onchain proof surface that a projection cannot provide.

## Final recommendation

```text
CURRENT_DEMO_USABLE_FOR_FULL_LIVE_PROOF: NO
FINAL_CONTRACT_CHANGE_REQUIRED: NO for the smallest correct live proof; YES only for the optional hardened final release described above
FINAL_REDEPLOYMENT_REQUIRED: NO for Option B
SECOND_PROTOCOL_REQUIRED: YES
RECOMMENDED_FINAL_FAILURE_CLASS: unauthorized-drain
RECOMMENDED_INCIDENT_EVIDENCE_MODEL: Two fresh, phase=EMERGENCY, digest-bound JSON artifacts from two real direct HTTPS origins; exact protocol/target/incident/class facts; current=true, critical_signal=true, mitigation_complete=false; objective transaction facts plus independent advisory/monitoring corroboration.
RECOMMENDED_RECOVERY_EVIDENCE_MODEL: Two new evidence ids and fresh phase=RECOVERY artifacts from the same locked real origins; current=false, critical_signal=false, mitigation_complete=true; evidence published after mitigation and within the freshness window.
RECOMMENDED_POLICY: New id such as showcase; same ProtectedDemo target; unauthorized-drain; two real independent origins; minimum_sources=2; max age chosen from measured source SLA (recommended 3600 seconds); positive cooldown chosen for the rehearsal (recommended 900 seconds or longer).
RECOMMENDED_DEPLOYMENT_PATH: Option B — leave locked demo untouched, qualify sources, register and lock the second policy, then execute the complete lifecycle once with full receipt and target-readback proof.
```
