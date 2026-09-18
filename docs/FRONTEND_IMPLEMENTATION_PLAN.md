# Sentinel Frontend Implementation Plan

Status: implementation plan only. No application or contract code is changed by this document.

## Target architecture

The frontend should be reorganized around four boundaries:

1. `app shell`: routing, navigation, connection state, responsive layout, global transaction tray;
2. `domain data`: protocol, incident, evidence, target, consensus, and proof queries;
3. `proof-aware workflows`: setup, incident response, and recovery actions;
4. `presentation`: reusable state, evidence, lifecycle, consensus, and technical-detail components.

The existing transport and coordinator are useful seams, but they should be upgraded behind stable interfaces so pages do not know whether a record came from a direct contract read, an indexer, or a receipt projection.

Suggested future structure:

```text
frontend/src/
├── app/                 route tree, shell, providers, error boundaries
├── components/          shared state/proof/transaction primitives
├── features/
│   ├── command-center/
│   ├── protocols/
│   ├── incidents/
│   ├── setup/
│   ├── activity/
│   └── public-proof/
├── domain/               typed models, state machines, copy maps
├── data/                 contract readers, indexer, receipts, freshness
├── lib/                  SDK transport, wallet, persistence, fee estimation
└── styles/               tokens, primitives, responsive patterns
```

## Non-negotiable correctness decisions

### Network and SDK alignment

The live product configuration is Studio Next, RPC `https://studio-next.genlayer.com/api`, chain `61997`, with the current v0.6-compatible GenLayer RC path. The existing Bradbury/4221 configuration must not remain the default for this product. Contract addresses must come from environment/configuration and be validated against the selected chain; they must not be copied into page components.

Writes must use the current fee-estimation path. A zero-value or missing fee quote is a blocked write, not a recoverable UI warning. The user-facing layer may summarize “Network fee estimate”; raw `feeValue`, distribution, caps, and execution budget belong in Advanced details.

### Authoritative data

Direct contract reads are authoritative for current protocol policy, incident state, and target pause state. Indexed data may provide enumeration, history, transaction links, and timestamps, but every indexed value must show its source and freshness.

The UI must model `unknown` and `stale` separately from `false`. If a target read fails, the target is not treated as active or recovered. If a protocol cannot be read, it is not treated as protected.

### Proof gates

Every affirmative UI state has an explicit proof gate:

```text
decision authorized
  -> response transaction finalized and execution succeeded
    -> triggered target transaction finalized, if applicable
      -> target state readback verified
```

The labels “Emergency pause active” and “Recovered” are forbidden until the final target readback passes. The labels “Active incident confirmed” and “Safe to recover” describe decision authorization only.

### Authority boundary

The browser must never call ProtectedDemo `process`, `emergency_pause`, or `emergency_unpause` directly as a product action. Pause and unpause are bounded cross-contract calls requested by Sentinel after the appropriate state and consensus. Setup writes are owner-controlled and separate from incident response.

The optional Watcher is proposal-only. It may monitor owner-approved sources and prepare a dossier, but it cannot acquire unilateral pause authority or bypass the locked policy, authenticated evidence, validator consensus, execution, and target readback gates.

## Contract/UI mapping

### Sentinel public methods

| Method | UI use | Preconditions shown in UI | Required post-write/readback |
| --- | --- | --- | --- |
| `get_protocol(protocolId)` | Protocol profile, setup, incident creation, policy simulator | Protocol id is known; result is current or marked stale | Render every policy field and lock state; verify target address source |
| `get_incident(incidentId)` | Incident list/detail, workflow refresh | Incident id is indexed/configured | Re-read after every incident write; do not infer state from a button result |
| `get_evidence(evidenceId)` | Evidence Intelligence | Evidence id is attached to the incident | Re-read metadata after bind; authentication remains separate unless exposed by a proof projection |
| `get_state(incidentId)` | Compact lifecycle badge and activity refresh | Incident exists | Use as a lightweight cross-check against `get_incident.state` |
| `register_protected_protocol(...)` | Guided protection setup | Owner wallet, valid target, policy template, no duplicate id | Re-read `get_protocol`; show policy setup incomplete until lock |
| `update_emergency_policy(...)` | Policy builder before lock | Protocol owner, protocol exists, `policy_locked=false`, valid fields | Re-read exact policy; no optimistic mutation |
| `lock_emergency_policy(protocolId)` | Final setup confirmation | Owner, protocol exists, policy review passed, unlocked | Re-read exact policy and require `policy_locked=true`; surface permanence |
| `open_incident(incidentId, protocolId)` | Incident creation final stage | Protocol exists and is locked; unique id | Re-read incident; state should be `ASSESSING` |
| `bind_evidence(...)` | Evidence stage, emergency or recovery | Correct incident phase, approved domain, freshness, digest and metadata shape | Re-read incident and evidence; update coverage from stored metadata |
| `assess_incident(incidentId)` | Emergency decision action | `ASSESSING` and coverage meets policy | Re-read incident, state, verdict, consensus/proof packet where available |
| `execute_pause(incidentId)` | Response action after `ACTIVE_INCIDENT` | Active affirmative verdict, no prior pause request | Persist parent and triggered hashes; verify target only after child finality/readback |
| `confirm_pause(incidentId)` | Target confirmation action | Pause requested and target `is_paused()` is true | Re-read incident and target; only then show `Emergency pause active` |
| `begin_recovery(incidentId)` | Recovery Guardian start | Incident `PAUSED`, target still paused, cooldown elapsed | Re-read incident; state should be `RECOVERY_ASSESSING` |
| `assess_recovery(incidentId)` | Recovery decision action | Recovery evidence coverage meets policy | Re-read incident and verdict; `SAFE_TO_RECOVER` is not yet unpaused |
| `execute_unpause(incidentId)` | Recovery response action | `RECOVERY_AUTHORIZED`, safe verdict, no prior request | Persist parent/triggered hashes; wait for target readback |
| `confirm_recovered(incidentId)` | Recovery confirmation action | Unpause requested and target `is_paused()` is false | Re-read incident and target; only then show `Recovered` |

The current contract does not enumerate protocols, incidents, or evidence. A directory/index service or explicitly configured id set is required for list routes. The UI must label direct contract reads versus indexed records.

### Protected protocol public methods

| Method | UI use | Write policy |
| --- | --- | --- |
| `get_owner()` | Security Profile ownership and setup authorization | Read only |
| `is_paused()` | Target-state verification, dashboard posture, response/recovery proof | Read only; required for “Paused” and “Recovered” claims |
| `get_authorized_sentinel()` | Controller status and setup verification | Read only |
| `is_controller_configured()` | Setup completion and profile status | Read only |
| `get_total_processed()` | Optional demo target activity context | Read only; never used as proof of safety |
| `get_pause_counters()` | Target consequence history and proof details | Read only |
| `configure_sentinel(sentinel)` | Guided setup for the demo/controller-compatible target | Owner-only, one-time, separate from registration |
| `process(amount)` | No product lifecycle use | Must not be exposed in Sentinel UI |
| `emergency_pause()` | Sentinel contract interface only | Never direct browser write |
| `emergency_unpause()` | Sentinel contract interface only | Never direct browser write |

For production protocols, the profile should use the registered `target_address` and a capability-aware adapter. ProtectedDemo-only reads such as processing counters are optional details, not assumptions for every protocol.

## Data and query plan

### Direct chain query layer

Create typed query functions with explicit freshness metadata:

- `readProtocol(protocolId)`;
- `readProtocolTarget(protocol)` using the registered target address;
- `readIncident(incidentId)`;
- `readIncidentEvidence(incident)`;
- `readTransactionProof(hash)`;
- `readTriggeredTransactionProof(parentHash)`;
- `readConsensusDetails(hash)`;
- `readDirectory()` from indexer/configured ids with source metadata.

Each response should include `value`, `source`, `readAt`, `block/receipt reference` when available, and `error`/`stale` state. Keep decoder fallbacks fail-closed, but do not silently turn malformed data into a normal state.

### Required derived view models

- `ProtocolPosture`: policy, lock, target state, controller state, latest incident, verification timestamp.
- `EvidenceAssessment`: metadata, domain approval, freshness, digest/association status, phase, independent-domain group, and authentication availability.
- `IncidentProof`: incident state, verdict, coverage, explanation, consensus result, execution result, target proof, and timeline.
- `TransactionOperation`: operation id, intent, chain, actor, contract, method, args fingerprint, parent hash, triggered hashes, lifecycle, execution result, readback status, timestamps, and error class.
- `WatcherProposal`: owner-approved source set, proposed incident, evidence bundle, policy match, proposal status, and explicit no-authority flag.

### Missing data services

Before claiming a full directory or public history, add one of:

- an indexed API built from transaction/receipt/event observations;
- a project registry that lists known protocol and incident ids;
- a server-side proof projection that retains consensus, evidence-authentication, and target-readback details.

The current contract public views alone cannot supply full enumeration, durable decision reasons, or per-source authentication results.

## Common transaction lifecycle UX

All setup, incident, evidence, assessment, pause, and recovery writes use one coordinator and one visual state machine:

```text
Preparing
  -> Awaiting approval
  -> Submitted
  -> Consensus
  -> Finalized
  -> Execution verified
  -> Triggered response verified (when applicable)
  -> Target state verified
```

Rules:

1. Read and validate preconditions immediately before approval.
2. Obtain a current fee estimate for the exact method and arguments; require a nonzero fee value.
3. Show a human summary of the action and target before wallet approval.
4. Persist the hash and operation envelope immediately when returned.
5. Reconcile the same hash after any timeout, reload, or RPC miss.
6. Keep `ACCEPTED`/consensus-in-progress distinct from `FINALIZED`.
7. Require successful execution, not just a finalized receipt.
8. For response messages, reconcile the triggered target operation before reading target state.
9. On target-readback failure, show “State not verified” and retain all hashes.
10. Never automatically create a replacement transaction after an ambiguous submission.

Persistence should retain pending and failed operations in durable browser storage with enough metadata to resume. A server-side operation index is preferred for cross-device and public proof. Removing a local record is allowed only after final execution and final state verification.

## Policy simulator and guided setup

The setup experience is a reviewable wizard, not a contract form:

1. Choose or identify the protected protocol and target.
2. Select an emergency-policy template.
3. Edit allowed domains, failure class, minimum independent sources, freshness, and recovery cooldown within contract limits.
4. Run non-broadcast validation and exact-write simulation.
5. Show a plain-language policy preview and an Advanced raw view.
6. Register/configure/update as required, each with its own proof/readback.
7. Present the permanent-lock confirmation only after the user understands the policy.
8. Lock and verify the stored policy.

Templates must be named by intent, for example “Unauthorized drain”, “Oracle integrity failure”, or “Governance takeover”, but templates must compile to explicit values and be reviewed before use. No template may imply that Sentinel detects every exploit.

The simulator must surface missing source coverage, malformed domains, stale evidence constraints, unsupported target capability, and estimated transaction cost before approval. It cannot claim external evidence authenticity merely because a URL field is syntactically valid.

## Screen implementation sequence

### P0 — mandatory

P0 is the smallest complete product that is correct, understandable, and demoable.

#### P0.1 Align the integration seam

- Replace Bradbury/4221 defaults with explicit Studio Next configuration for the current environment.
- Align the GenLayer SDK and transaction types with the current v0.6 fee-bearing path.
- Validate chain id, RPC, configured contract addresses, wallet account, and schema before enabling writes.
- Add fee estimation/simulation as a required write precondition.
- Preserve the current typed transport idea but expose full lifecycle, receipt, consensus, fee, and triggered-transaction data.

Acceptance gate: no write button can reach wallet approval without a valid current quote and matching chain/account.

#### P0.2 Build the data and lifecycle foundation

- Add query/cache/freshness primitives and typed unknown/stale/error states.
- Add the operation envelope and durable pending-hash store.
- Extend reconciliation to expose `ACCEPTED`, `FINALIZED`, execution success/failure, consensus result, and triggered hashes.
- Add one reusable `TransactionProgress`/`ProofGate` model.
- Add route-level error boundaries and retry behavior.

Acceptance gate: a reload resumes the same operation hash; a finalized execution error never renders success; target readback is a distinct proof gate.

#### P0.3 Establish the shell and route hierarchy

- Replace manual page conditionals with a typed route tree and nested layout.
- Add the required primary nav and secondary links without adding unnecessary top-level routes.
- Add responsive mobile navigation, connection status, transaction tray, and consistent page headers.
- Introduce CSS tokens and accessible semantic state components.

Acceptance gate: all required routes deep-link, refresh, render loading/empty/error states, and preserve the current operation tray.

#### P0.4 Deliver Command Center and Protocol Security Profile

- Replace the one-protocol metric with an authoritative/indexed protocol posture view.
- Implement `StatusBadge`, `ProtocolCard`, `TargetStateVerification`, `PolicyCard`, and `IncidentTimeline`.
- Follow each protocol's registered target address instead of hard-coding ProtectedDemo.
- Show current Studio Next/live proof metadata only when read successfully.

Acceptance gate: the dashboard cannot say Protected when policy or target state is unavailable.

#### P0.5 Deliver guided setup, templates, and policy simulator

- Implement the protection setup wizard and emergency policy templates.
- Add exact method simulation/fee quote for register, configure, update, and lock operations.
- Show a clear irreversible lock review and readback.
- Keep setup separate from incident response.

Acceptance gate: a user can explain what will be protected, which evidence qualifies, and what locking changes before approving a write.

#### P0.6 Deliver Incident Creation and Incident Command Center

- Implement the five-stage creation flow.
- Add Evidence Intelligence cards and `EvidenceCoverage` with “X of Y required independent sources”.
- Add `DecisionCard`, `ConsensusDrawer`, and human copy for `ACTIVE_INCIDENT`, `NO_ACTIVE_INCIDENT`, and `INCONCLUSIVE`.
- Make the lifecycle stepper the dominant interaction model.
- Implement incident writes with exact preconditions, fee estimation, hash persistence, and final readback.

Acceptance gate: the screen visibly distinguishes evidence, decision, response execution, and actual target state.

#### P0.7 Deliver Recovery Guardian

- Show recovery evidence separately from emergency evidence.
- Display cooldown and coverage requirements.
- Implement recovery assessment and “Safe to recover” decision state.
- Reconcile unpause response and require `is_paused()==false` before “Recovered”.

Acceptance gate: no time-based or optimistic recovery claim is possible.

#### P0.8 Complete Activity and public trust surfaces

- Replace key-name-only Activity with operation cards, reconciliation controls, receipts, and technical drawers.
- Update Transparency to explain capability, limits, policy ownership, evidence authentication, consensus, target readback, and recovery.
- Add `/developer` with the three-step integration guide and minimal controller interface.

Acceptance gate: a non-technical user can understand the model, while a technical user can inspect the proof path.

#### P0.9 Responsive and state-quality pass

- Add empty/loading/error/stale/consensus-pending/execution-failed/target-unverified/recovery states.
- Replace mobile hidden-nav behavior with an accessible navigation pattern.
- Correct encoding issues and define focus, contrast, reduced-motion, and touch-target standards.
- Test every route at mobile and desktop widths.

Acceptance gate: no lifecycle state relies on color alone and no action can be mistaken for proof of consequence.

### P1 — standout differentiators

#### P1.1 Sentinel Watcher

Add an optional off-chain watcher that:

- monitors only protocol-owner-approved domains and source types;
- records source health and last scan time;
- creates a proposal/draft evidence bundle rather than directly pausing;
- requires normal Sentinel evidence authentication and validator consensus;
- shows a permanent “Watcher has no unilateral pause authority” notice;
- supports disable/pause of the watcher without changing contract policy.

The watcher needs a service, secure credentials, source allowlist enforcement, proposal persistence, rate limiting, and audit logs. It is not a browser-only feature.

#### P1.2 Public proof explorer

Expose shareable protocol/incident proof pages with finalized hashes, policy snapshot, evidence metadata, consensus result, target readback, and timestamps. Redact private wallet/UI data and label indexed versus directly read facts.

#### P1.3 Cross-protocol attention intelligence

Add posture change detection, attention prioritization, and incident clustering only after the indexer can provide reliable history. These are secondary to correctness and must not create synthetic risk scores.

### P2 — deliberately deferred

Keep P2 limited to operational polish that does not compete with the safety story:

- notification delivery for state changes and unresolved reconciliation;
- exportable proof bundles and audit-friendly reports;
- performance/accessibility hardening and broader adapter conformance coverage.

Do not prioritize token economics, speculative risk scores, decorative charts, social feeds, or generic DeFi analytics.

## Copy and terminology implementation

Create a single copy map from raw contract/SDK values to human labels. Examples:

| Raw value | Primary copy | Supporting explanation |
| --- | --- | --- |
| `ASSESSING` | Assessment in progress | Evidence is being collected or evaluated. |
| `ACTIVE_INCIDENT` | Active incident confirmed | Locked criteria and consensus authorized an emergency response. |
| `pause_requested` | Emergency pause requested | The response request is finalized; target state is not yet confirmed. |
| target `is_paused=true` | Emergency pause active | The protected target confirmed the pause. |
| `RECOVERY_ASSESSING` | Recovery assessment | Fresh mitigation evidence is being evaluated. |
| `SAFE_TO_RECOVER` | Safe to recover | Consensus authorized recovery; target readback is still required. |
| target `is_paused=false` after recovery | Recovered | The protected target confirmed it is operating again. |
| `INCONCLUSIVE` | Unable to verify | Sentinel failed closed because affirmative evidence was insufficient. |
| `MAJORITY_AGREE` | Consensus accepted | Raw consensus result is available in Advanced details. |
| `FINISHED_WITH_RETURN` | Execution completed | Raw SDK result is available in Advanced details. |

## Definition of done

The architecture is ready for implementation when:

- all required routes exist and are reachable on mobile and desktop;
- the UI uses current Studio Next network/configuration without hard-coded Bradbury assumptions;
- protocol and incident directory limitations are explicit and backed by a chosen data source;
- all writes use exact simulation/fee estimation, hash persistence, same-hash reconciliation, and final readback;
- no user-facing `Paused` or `Recovered` label is emitted without target proof;
- evidence and consensus explanations are honest about what the current contract exposes;
- setup, incident, and recovery workflows are separate and state-gated;
- Advanced details contain raw technical information without polluting the primary experience;
- Watcher, if enabled, is proposal-only and cannot bypass contract authority;
- no contract source change is required for the initial UI implementation unless a separately approved data/proof requirement is proven impossible through indexing or receipt projection.
