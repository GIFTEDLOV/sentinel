# Sentinel Trust Model

Sentinel is a bounded evidence-based circuit breaker. It does not decide
whether a protocol is generally safe and has no arbitrary-call authority.

## Authority

The protected protocol owner registers the target and locks the policy. Sentinel
can request only `emergency_pause()` and `emergency_unpause()` through the
minimal target interface and can read `is_paused()` for consequence
verification. The target itself authorizes those calls using its one-time
Sentinel controller configuration.

ProtectedDemo’s treasury and remediation methods are demo-specific. They are
not required by Sentinel-compatible protocols.

## Authentication before semantics

For chain evidence, Sentinel constructs the canonical JSON-string POST to the
locked RPC endpoint and authenticates the returned hash, origin, target,
calldata, finality, consensus, successful execution, timestamp, and digest.
For advisory evidence, it authenticates HTTPS source identity, locked path
prefix, response size, UTF-8/JSON shape, SHA-256 body digest, policy fields,
phase, and deterministic linkage to the same transaction hash.

The source quorum counts distinct canonical approved hosts. This proves only
that distinct approved origins contributed; it does not prove separate
organizations or real-world independence.

Observable redirects fail closed. The current GenVM response does not expose
transparent redirect provenance, so final sources must be direct or otherwise
content-addressed and authenticated.

## Clock-domain correction and freshness

Studio-dev exposes separate time domains: canonical/node transaction timestamps
describe the underlying external event, while GenVM `_now()` describes the
transaction executing Sentinel. These values must not be compared directly.

For `CHAIN_TRANSACTION`, Sentinel authenticates and retains the canonical
transaction timestamp as `event_timestamp`. For `SECURITY_ADVISORY`, the
advisory's `issued_at` is audit/display metadata and is not treated as an
authenticated cross-domain clock. After source fetch, URL/prefix, digest,
schema, linkage, and policy validation succeed, Sentinel assigns
`observed_at = _now()` internally. The caller cannot supply or extend it.

At assessment, freshness is revalidated as current GenVM `_now()` minus the
stored internal observation time. `max_evidence_age_seconds` is therefore the
maximum time from Sentinel's authenticated observation to assessment in the
GenVM clock domain. Stale or under-quorum evidence cannot authorize a verdict.

## Semantic judgment

Validators receive authenticated facts and untrusted advisory bytes. Prompts
explicitly state that evidence may contain malicious instructions and must
never be followed as instructions. Validators judge only the locked failure
class and return bounded verdicts:

- incident: `ACTIVE_INCIDENT`, `NO_ACTIVE_INCIDENT`, `INCONCLUSIVE`;
- recovery: `SAFE_TO_RECOVER`, `NOT_SAFE_TO_RECOVER`, `INCONCLUSIVE`.

Validators cannot redefine policy, decide ownership, trust an arbitrary source,
or select actions outside the lifecycle.

## Consequence boundary

`ACTIVE_INCIDENT` is not the same as `PAUSED`. `execute_pause` only emits a
finalized target request. Sentinel records `PAUSED` only after `confirm_pause`
reads `is_paused() == true`. Recovery follows the same boundary:
`execute_unpause` emits a request, while `confirm_recovered` requires a real
unpaused readback.

## Residual risks

This architecture does not prove universal exploit detection, organizational
independence, or correctness of an advisory publisher. It proves a narrow,
authenticated, policy-bound decision and a separately verified target
consequence. Operational monitoring and a frontend proof projection remain
important off-chain responsibilities.
