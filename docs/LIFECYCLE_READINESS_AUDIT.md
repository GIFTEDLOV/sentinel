# Sentinel Lifecycle Readiness Audit

Status: read-only analysis completed 2026-09-12.

Scope: the deployed and permanently locked `demo` protocol on Studio-dev, using the frozen Sentinel and ProtectedDemo sources. No contract, frontend, or chain state was changed for this audit.

## Executive decision

`demo` is **not ready for a real public-evidence incident → pause → recovery → unpause proof**.

The exact blocker is the locked allowlist:

```text
explorer.example,advisory.example
```

Both hosts fail DNS resolution from the analysis environment. They are illustrative `.example` names, not production evidence origins. IANA explicitly says example domains are for documentation and are not designed to support production applications. The repository tests mock these exact URLs; they do not demonstrate validator access to live web sources.

This is not a fee, schema, or contract-runtime blocker. It is a permanently locked evidence-source configuration blocker. The same blocker applies to recovery because recovery must use fresh `RECOVERY` evidence from the same locked domains. `recovery_cooldown_seconds = 0` removes a waiting period; it does not bypass evidence authentication, source quorum, or recovery assessment.

Evidence basis:

- Contract source: [`contracts/sentinel.py`](../contracts/sentinel.py), especially `_source_domain`, `_authenticate_one`, `_judge_evidence`, and the lifecycle writes.
- Test source: [`tests/test_foundation.py`](../tests/test_foundation.py). The qualifying evidence uses mocked `.example` responses.
- Official GenLayer guidance: [web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access), [non-deterministic operations](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/non-deterministic-operations-handling), and [LLM integration](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/large-language-model-llm-integration).
- Reserved-domain guidance: [IANA Example Domains](https://www.iana.org/help/example-domains).

## Current deployed configuration

| Item | Current value | Readiness implication |
|---|---|---|
| Network | `studio-dev` / chain `61997` | Correct target environment |
| Sentinel | `0xb7385835D950fdE5F43c95b252759701E6287Ffe` | Deployed |
| ProtectedDemo | `0xba51Ee9C0bA22e751EBa5eCa7E1b68B71306e6cc` | Deployed and Sentinel-authorized |
| Protocol | `demo` | Registered and locked |
| Failure class | `unauthorized-drain` | Clear and judge-friendly |
| Evidence domains | `explorer.example,advisory.example` | **Not live-ready** |
| Minimum sources | `2` | Requires two distinct stored domains |
| Maximum evidence age | `86400` seconds | Checked when evidence is bound, not again at assessment |
| Recovery cooldown | `0` seconds | Immediate eligibility after confirmed pause |
| Protected target | configured, currently unpaused | Target integration is ready |

## Complete incident path

The contract is intentionally fail-closed: any missing, inconsistent, unavailable, or unauthenticated evidence produces `INCONCLUSIVE`, not an emergency pause.

| Stage | Required state | Caller rule | Contract behavior | Resulting state |
|---|---|---|---|---|
| `open_incident(id, protocol)` | Protocol exists and policy is locked; incident id is unused and valid | Permissionless public write; no caller allowlist | Creates an incident with empty evidence, both verdicts `INCONCLUSIVE`, and state `ASSESSING` | `ASSESSING` |
| `bind_evidence(...)` | Incident is `ASSESSING`; phase is `EMERGENCY` | Permissionless public write; no caller allowlist | Validates metadata and policy identity, then consensus-checks the supported chain/advisory fetch, digest/schema/linkage, and stores an internally generated GenVM observation time. | `ASSESSING` |
| `assess_incident(id)` | Incident is `ASSESSING`; distinct stored domains meet the minimum | Permissionless public write; no caller allowlist | Fetches every bound URL in the leader and validator nondeterministic paths, authenticates the bytes and facts, then runs the bounded semantic judge | `ACTIVE_INCIDENT`, `NORMAL`, or remains `ASSESSING` with `INCONCLUSIVE` |
| `execute_pause(id)` | State and incident verdict are both `ACTIVE_INCIDENT`; pause not already requested | Permissionless public write; no caller allowlist | Emits `ProtectedTarget.emergency_pause()` with `on="finalized"`. It sets `pause_requested`; it does not itself set `PAUSED`. | Still `ACTIVE_INCIDENT` |
| `confirm_pause(id)` | State `ACTIVE_INCIDENT`; pause was requested | Permissionless public write; no caller allowlist | Performs a target view call to `is_paused()`. Only a true readback advances the incident. | `PAUSED` |

### Binding and authenticating evidence

`bind_evidence` enforces the following deterministic checks before anything reaches GenVM web execution:

1. Phase must be exactly `EMERGENCY` for incident assessment.
2. Evidence type must be one of `TRANSACTION`, `PROTECTED_STATE`, or `SECURITY_ADVISORY`.
3. The URL must begin with lowercase `https://`, contain a path, and contain no spaces, query, fragment, port, or user-info separator. A domain must contain a dot.
4. The parsed hostname is lowercased and must exactly match one comma-separated locked allowlist entry. There is no wildcard or subdomain matching, and allowlist whitespace is not trimmed.
5. `failure_class` must equal the locked policy class.
6. `observed_at` is not a caller argument. Sentinel assigns it from `_now()` only after supported evidence authentication succeeds.
7. `content_digest` must be 64 hexadecimal characters.
8. `transaction_hash` must be a 32-byte hexadecimal hash, with optional `0x`, and `transaction_block` must be nonzero.
9. The evidence id must be globally unused and not already attached to the incident.

The URL is fetched only inside `_authenticate_one` during assessment, using `gl.nondet.web.get` with an `Accept: application/json` header. The fetched response must have status `200`, a body, a body size no greater than `65536` bytes, valid UTF-8, and a SHA-256 digest equal to the bound digest. The JSON must be an object whose facts exactly match the locked protocol, target address, incident id, and phase. `current`, `critical_signal`, and `mitigation_complete` must be actual booleans.

If any evidence item is unavailable or invalid, `_judge_evidence` returns `INCONCLUSIVE` for the whole assessment. It does not partially count valid items.

### Domain and redirect semantics

The contract enforces HTTPS and the final parsed URL hostname supplied to it, but it does not inspect an HTTP redirect chain. The installed local GenLayer web wrapper exposes status, headers, and body; it does not expose redirect history or a final-origin proof. Therefore:

- The source does not explicitly reject redirects.
- The source cannot prove that the bytes came directly from the allowlisted origin if the hosted web module follows a redirect.
- If a redirect is returned as a non-200 response, it is unavailable; if the host follows it to a 200 body, the contract has no redirect-origin field with which to reject it.
- The exact hosted Studio-dev follow/deny behavior is not established by repository source and must not be assumed.

For a trustworthy deployment, use direct, redirect-free, immutable HTTPS URLs or a source boundary that provides a signed envelope and an independently verifiable origin. Do not rely on redirect behavior as an evidence-authentication control.

### Freshness semantics

The RPC/node event timestamp is stored as authenticated event data and is not
compared with GenVM time. `observed_at` is generated internally after evidence
authentication. Before assessment, every incident/recovery record is
revalidated with current GenVM `_now()`; any record older than
`max_evidence_age_seconds` is excluded, and an insufficient fresh quorum fails
closed. Both sides of this comparison therefore use the same GenVM clock.

### Source independence and duplication

The quorum is the number of distinct `source_domain` strings stored on the incident. Consequently:

- Two URLs on the same domain count once, not twice.
- Duplicate URLs are not rejected when they use distinct evidence ids, although same-domain duplicates still cannot satisfy a two-domain minimum.
- Evidence ids are protected globally and cannot be rebound.
- The contract treats different hostnames as distinct domains; it does not establish that the domains have independent operators, infrastructure, or underlying facts.
- The stored domain is the parsed hostname, not a cryptographic source identity.

The UI must say “two approved domains corroborated the evidence,” not “two independent organizations proved the event,” unless an off-chain source registry proves the stronger claim.

### Validator input and decision rule

The leader and validator each re-fetch and authenticate the sources. The prompt receives:

- trusted normalized facts: authenticated count, distinct-domain count, and the three all-source boolean values;
- raw JSON bodies explicitly marked as untrusted content;
- a locked instruction to ignore instructions, role claims, and policy fragments inside evidence.

The validator compares only these stable fields from the leader result:

```text
verdict
criteria_met
authenticated_count
source_count
objective_current
objective_critical
objective_mitigated
```

The generated free-text `reason` is not part of consensus equality and is not persisted in `IncidentRecord` or returned by `get_incident`. It must not be presented as an on-chain authenticated explanation.

The exact affirmative outcomes are:

- Incident: `ACTIVE_INCIDENT` only when every authenticated source has `current=true` and `critical_signal=true`, the minimum authenticated sources and distinct domains are present, the LLM returns `ACTIVE_INCIDENT` with `criteria_met=true`, and the objective facts pass.
- Incident negative: `NO_ACTIVE_INCIDENT` can move the incident to `NORMAL` only when authenticated evidence establishes `current=false` or `critical_signal=false` and the LLM returns the negative verdict.
- Any invalid, unavailable, conflicting, malformed, unknown, or objective-inconsistent result becomes `INCONCLUSIVE`.

Official GenLayer documentation describes web data and LLM results as nondeterministic and recommends stable fields, objective checks, multiple sources, provenance, and explicit handling for unavailable or adversarial content. The contract follows that broad pattern, but its current public views do not expose the complete proof packet.

### Target consequence and readback

`execute_pause` is a real inter-contract call. It calls the target’s `emergency_pause()` only after the Sentinel incident is in `ACTIVE_INCIDENT`. ProtectedDemo accepts this call only from its configured Sentinel address.

`execute_pause` records only that the request was emitted. It does not claim the target is paused. `confirm_pause` performs `target.view().is_paused()` and advances to `PAUSED` only when the target returns `true`. This is the authoritative “actual consequence” gate.

## Complete recovery path

| Stage | Required state | Evidence/operation | Result |
|---|---|---|---|
| `begin_recovery(id)` | Incident is `PAUSED`; cooldown elapsed | Resets recovery verdict and clears the incident’s attached evidence/domain CSVs | `RECOVERY_ASSESSING` |
| `bind_evidence(...)` | Incident is `RECOVERY_ASSESSING`; phase is exactly `RECOVERY` | Requires new, globally unused evidence ids, same target/class/locked allowlist, fresh metadata, and valid digest/hash fields | `RECOVERY_ASSESSING` |
| `assess_recovery(id)` | Recovery evidence has the required distinct domains | Re-fetches and authenticates the fresh recovery items; runs a new leader/validator judgment | `RECOVERY_AUTHORIZED` for `SAFE_TO_RECOVER`; otherwise `PAUSED` or remains recovery-assessing with `INCONCLUSIVE` |
| `execute_unpause(id)` | State and recovery verdict are `RECOVERY_AUTHORIZED`; unpause not requested | Emits `ProtectedTarget.emergency_unpause()` with `on="finalized"` | Still `RECOVERY_AUTHORIZED` |
| `confirm_recovered(id)` | Unpause was requested | Reads target `is_paused()` and advances only if it is false | `RECOVERED` |

Recovery evidence is not a reuse of the earlier incident evidence:

- `begin_recovery` clears the incident’s attached evidence ids and domains.
- The global evidence map remains populated, so the old ids cannot simply be rebound.
- New `RECOVERY` evidence ids are required.
- The same locked domains and failure class are required because `bind_evidence` reads the protocol policy for both phases.
- Evidence is fetched again during recovery assessment.

`recovery_cooldown_seconds = 0` means the timestamp check has no positive delay: once the target has been confirmed paused, a later `begin_recovery` transaction is eligible immediately. It does not automatically start recovery or unpause the target.

The exact affirmative recovery result is `SAFE_TO_RECOVER` with `criteria_met=true`, and all authenticated sources must say `current=false`, `critical_signal=false`, and `mitigation_complete=true`, with the minimum corroborating domains. The previous incident verdict does not bias this fresh judgment.

## Can the current locked demo complete a real live assessment?

**No.**

Exact blocker: the locked allowlist is not backed by live evidence origins. In the analysis environment:

```text
explorer.example  -> DNS name does not exist
advisory.example  -> DNS name does not exist
```

The repository’s successful lifecycle tests use `direct_vm.mock_web` for these URLs. That proves the contract’s mocked logic, not public Studio-dev validator retrieval. Official GenLayer testing documentation explicitly describes mocked HTTP responses for `gl.nondet.web.get`, so the test harness is not evidence of live reachability.

The current Sentinel and ProtectedDemo addresses, controller authorization, target readback interface, and pause/unpause state machine are otherwise sufficient for a real proof. The permanently locked `demo` policy cannot be repaired in place.

## Production/showcase evidence requirements

A source should meet all of the following before its hostname is locked into a policy:

1. Public DNS and HTTPS reachability from Studio-dev validators, tested from the actual GenLayer environment where possible.
2. A direct URL with no redirect dependency, credentials, query parameters, or volatile personalization.
3. Deterministic retrieval of a small JSON body with status 200, valid UTF-8, and a size comfortably below 64 KiB.
4. An immutable or append-only publication reference, such as a content-addressed object or pinned artifact, with a reproducible byte-level SHA-256.
5. Exact facts for protocol id, target address, incident id, phase, failure class, and the three booleans required by the contract.
6. A clear `observed_at` timestamp and an operational SLA shorter than the locked evidence-age window.
7. A source owner and provenance that judges can understand; two hostnames controlled by the same publisher should not be marketed as independent corroboration.
8. Emergency evidence that describes a concrete unauthorized-drain signal, not merely a reporter claim. A transaction explorer or signed event record should provide objective transaction facts; an independently operated advisory or monitoring source should corroborate the interpretation.
9. Recovery evidence that is published as a new `RECOVERY` phase artifact after mitigation, with `current=false`, `critical_signal=false`, and `mitigation_complete=true`.
10. Content and prompts treated as hostile input. The source must not be able to change the locked policy or cause the contract to accept a fact outside the normalized schema.

Recommended source model: two independently operated, production HTTPS origins with pinned, incident-specific JSON artifacts. One should expose objective transaction/protected-state facts; the other should provide an independently authored security assessment. The exact real hostnames must be selected and reachability-tested before the final policy is created. No fake or illustrative domains should be substituted.

## Best final showcase policy

`unauthorized-drain` remains the strongest failure class for the showcase:

- judges understand the harm immediately;
- an emergency pause is an obvious consequence;
- a transaction source and security advisory naturally form a two-source narrative;
- recovery can be demonstrated with a mitigation-complete artifact;
- the policy gives validators a bounded, auditable question.

Changing the label to `oracle-integrity-failure` or `governance-takeover` would not change the contract’s decision logic: the class is matched in metadata, while the actual objective gate remains the three booleans. Those alternatives may be good product templates, but they are not materially stronger for this contract’s live proof.

Recommended policy for a new final protocol id, subject to source publication and dry-run validation:

| Field | Recommendation |
|---|---|
| Protocol id | A new id such as `showcase`; do not reuse the permanently locked `demo` policy |
| Target | The already configured ProtectedDemo may be reused for the minimal path |
| Failure class | `unauthorized-drain` |
| Allowed domains | Two real, independently operated HTTPS origins; exact names are a deployment gate and are not invented here |
| Minimum sources | `2` |
| Maximum evidence age | `3600` seconds, if both sources can publish within one hour; otherwise choose the smallest value supported by their measured SLA |
| Recovery cooldown | `900` seconds or longer, to demonstrate that recovery is deliberate rather than an immediate automatic reversal |

The numeric values above are recommendations, not applied chain state. They must be reviewed against the source publication/recovery schedule and then supplied to the registration transaction exactly once. The current `demo` policy remains unchanged and should be labeled legacy/test-only in any UI.

## Migration options

| Option | Technical feasibility | Trust/model correctness | Demo quality | Contract changes | Frontend impact | Risk/time | Assessment |
|---|---|---|---|---|---|---|---|
| A. Keep locked `demo` | Lifecycle writes can be exercised only with mocks or non-real sources | Fails the real-evidence requirement | Misleading as a live proof | None | Must visibly label it as non-live | Low chain risk, but high judging risk | Reject |
| B. Register a second id to the same ProtectedDemo | Feasible: target is already configured for Sentinel; registration and lock are separate owner writes | Correct if the new policy uses real sources and is independently validated | Strongest minimum-change path | None for the core proof | Add the new id/config; hide or label legacy `demo`; add proof projection | Lowest deployment risk and time | **Recommend** |
| C. Deploy a new ProtectedDemo and register a new id | Feasible and cleanly isolates final demo state | Correct with real policy and controller configuration | Cleaner target narrative | None unless target is hardened | New address/config and proof records | Moderate deployment and fee/profile risk | Good fallback if target isolation is required |
| D. Deploy final Sentinel + ProtectedDemo after hardening | Feasible; supports contract changes and a clean registry | Best long-term architecture | Highest if fully rehearsed | Required for hardening changes | Largest integration surface | Highest risk/time; new fee, schema, and lifecycle proof | Not the smallest path |

### Recommendation

Choose **B**: keep the deployed Sentinel and ProtectedDemo, leave `demo` untouched as a legacy test policy, and register a second protocol id with two real, independently operated evidence origins. This is the smallest technically correct path to a real proof because the target controller and cross-contract pause/readback path are already deployed and verified. It avoids a new deployment failure surface while preserving the locked-policy trust boundary.

Option B is not permission to transact in this audit. It requires a later preflight, a new registration write, a policy lock write, and then the complete incident/recovery lifecycle with fresh evidence ids and same-hash reconciliation for every transaction.

## Contract/UI trust boundary

The current contract can prove the key consequence chain:

```text
locked policy
  → authenticated evidence
  → independent validator acceptance
  → Sentinel response message
  → target pause/unpause call
  → target readback
```

It cannot currently expose all the information a competition-grade UI wants to show. The frontend must distinguish:

- decision authorized;
- response transaction emitted/finalized;
- target state readback verified.

Only the third is a claim that ProtectedDemo is actually paused or recovered.

## Next five implementation milestones

1. **Evidence-source qualification.** Select two real, independently operated HTTPS origins; define immutable emergency and recovery JSON artifacts; test DNS, direct 200 retrieval, byte digests, size, timestamps, redirect behavior, and validator reachability. Keep `demo` unchanged.
2. **Final policy registration design.** Choose a new protocol id and finalize the failure class, source allowlist, source minimum, freshness window, and positive cooldown from the source SLA. Produce a preflight packet; do not lock until every source and policy invariant passes.
3. **Minimal live chain proof.** Register and lock the second protocol id against the existing ProtectedDemo, then run one complete incident and recovery using new phase-specific evidence ids. Persist every hash and require `ACTIVE_INCIDENT`, target pause readback, `SAFE_TO_RECOVER`, target unpause readback, and `RECOVERED`.
4. **Proof projection and frontend migration.** Replace Bradbury/4221 defaults with Studio-dev; follow each protocol’s registered target; add an off-chain protocol/incident/evidence index and receipt projection; surface authenticated facts, consensus, child calls, and target readbacks with honest source labels.
5. **Competition hardening and rehearsal.** Add stale-at-assessment and source-independence tests, negative/ambiguous evidence runs, refresh-safe transaction reconciliation, mobile/error states, and a scripted judge-facing rehearsal of Monitor → Verify → Decide → Pause → Recover.

## Final report

```text
CURRENT_DEMO_LIVE_READY: NO
CURRENT_DEMO_BLOCKERS: Locked evidence domains explorer.example and advisory.example are DNS-unresolvable illustrative domains; tests mock them, and the policy cannot be edited after lock. Recovery also requires fresh evidence from those same domains.
RECOMMENDED_FINAL_POLICY: New protocol id (for example showcase); unauthorized-drain; two real independently operated HTTPS evidence origins; minimum_sources=2; max age selected from measured source SLA (recommended 3600s); positive recovery cooldown (recommended 900s or longer).
RECOMMENDED_EVIDENCE_SOURCES: Two real, direct, redirect-free, immutable/pinned HTTPS origins: one objective transaction/protected-state source and one independently operated advisory/monitoring source. Exact hostnames remain a qualification gate.
CONTRACT_CORRECTNESS_CHANGES: Revalidate freshness at assessment; strengthen source identity/independence and redirect provenance before claiming production-grade corroboration.
WINNING_UX_CONTRACT_CHANGES: Persist a consensus-stable decision packet/reason code and evidence-authentication summary; add lifecycle/event or projection-friendly support if an onchain proof surface is required. Not required for the minimal Option B proof.
FRONTEND_ONLY_SOLUTIONS: Studio-dev config; protocol/incident/evidence indexing; receipt/target-call projection; generic target adapters; transaction lifecycle/reconciliation UI; honest proof labels.
FINAL_REDEPLOY_REQUIRED: NO for the recommended Option B path; YES only if contract hardening is selected as part of the final release.
RECOMMENDED_PATH: Option B — leave locked demo as legacy, register and lock a second real-source protocol against the existing configured ProtectedDemo, then run the complete lifecycle proof.
NEXT_5_MILESTONES: 1) qualify real sources; 2) finalize/preflight second policy; 3) register/lock and run full live lifecycle; 4) build proof projection and migrate frontend; 5) harden, test, and rehearse.
FILES_CREATED: docs/LIFECYCLE_READINESS_AUDIT.md; docs/FINAL_CONTRACT_HARDENING_PLAN.md
APPLICATION_CODE_CHANGED: NO
CONTRACT_CODE_CHANGED: NO
TRANSACTIONS: NONE
COMMITS: NONE
PUSHES: NONE
```
