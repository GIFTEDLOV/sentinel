# Sentinel Product UI Specification

Status: planning artifact only. This document defines the target product experience; it does not change application or contract code.

## Product north star

Sentinel is an institutional protocol-safety product for people who need to answer, quickly and confidently:

1. Which protocols are protected?
2. Are they safe right now?
3. What emergency condition is being watched?
4. What evidence supports the current decision?
5. Why did consensus reach that decision?
6. Did the protected target actually pause?
7. What must be proven before recovery?

The primary story is always:

```text
Monitor -> Verify -> Decide -> Pause -> Recover
```

The product vocabulary is:

```text
PROTOCOL -> INCIDENT -> RECOVERY
```

GenLayer internals, fee values, execution budgets, calldata, nonce management, and validator timeunits are advanced details. They must never be required to understand the primary safety state.

## Product state model

The UI uses human labels as the primary language and preserves contract values in a secondary technical view.

| Contract state or fact | Primary UI label | Semantic rule |
| --- | --- | --- |
| Protocol registered, target readback healthy, no open incident | Protected | Do not imply universal protocol safety. |
| `ASSESSING` | Assessment in progress | Evidence or consensus is incomplete. |
| `ACTIVE_INCIDENT` with affirmative verdict | Active incident confirmed | Consensus authorized response; target is not yet necessarily paused. |
| `pause_requested=true`, target not yet confirmed | Emergency pause requested | A response message exists; do not say Paused. |
| `PAUSED` plus `is_paused() == true` | Emergency pause active | This is the first state that may claim the target is paused. |
| `RECOVERY_ASSESSING` | Recovery assessment | Fresh recovery evidence is being collected or judged. |
| `RECOVERY_AUTHORIZED` | Safe to recover | Consensus authorized recovery; target is not yet necessarily unpaused. |
| `RECOVERED` plus `is_paused() == false` | Recovered | Only after target readback confirms unpaused. |
| `NO_ACTIVE_INCIDENT` | No active incident found | Not a permanent safety certification. |
| `INCONCLUSIVE` | Unable to verify | Fail-closed; explain the missing, stale, conflicting, or invalid evidence. |
| policy `policy_locked=true` | Policy locked | Policy configuration is immutable through the normal policy path. |
| policy `policy_locked=false` | Policy setup incomplete | Setup flow may still require owner action. |

### Truth hierarchy

The product must display these as separate facts, never as one blended success badge:

1. Decision authorized by Sentinel consensus.
2. Response transaction finalized and execution succeeded.
3. Triggered target transaction finalized, where applicable.
4. Target readback verified the actual state.

The target state is authoritative for `Paused` and `Recovered`. A finalized parent transaction alone is not enough.

## Information architecture

```text
/
├── /app                         Command Center
│   ├── /app/protocols            Protected protocol directory
│   │   └── /app/protocols/:id    Protocol Security Profile
│   ├── /app/incidents            Incident history
│   │   ├── /app/incidents/new    Guided incident workflow
│   │   └── /app/incidents/:id    Incident Command Center
│   └── /app/activity             System activity and transaction reconciliation
├── /transparency                 Public trust model and proof surface
└── /developer                    Protected-protocol integration guide
```

Primary navigation: Command Center, Protocols, Incidents, Activity.

Secondary navigation: Transparency, Developer, Settings. Settings should initially be a shell drawer or modal for network, account, and notification preferences, not a new top-level route.

The global shell has one persistent trust strip showing the selected network, read freshness, connected account, and whether the UI is reading authoritative chain state. A persistent transaction tray shows operations that need reconciliation after navigation or refresh.

## Screen specifications

### `/` — premium marketing page

Primary user goal: understand Sentinel's value and trust boundary in seconds.

Hero state: “Autonomous emergency response for onchain protocols.”

Sections:

- Hero headline, one-sentence explanation, and primary CTA “Launch Sentinel”.
- Secondary CTA “See how it works”.
- A restrained five-step visual: Monitor, Verify, Decide, Pause, Recover.
- “What Sentinel protects” showing bounded authority and protocol opt-in.
- “What happens during an incident” showing evidence, consensus, response, and target readback.
- Recovery section explaining that recovery is a new evidence-backed decision.
- Short proof strip linking to Transparency and Developer.

Primary action: Launch Sentinel -> `/app`.

Secondary actions: See how it works -> anchored explanation; Transparency; Developer.

Contract reads/writes: none required. Marketing copy must not display live contract facts as proof.

Loading/empty/error: static page has no chain loading state; live proof cards must use an explicit “Read live state” state or be omitted.

Mobile behavior: single-column hero; the five-step flow becomes a vertical sequence; CTAs remain visible without horizontal overflow.

Advanced information: none in the hero. Link to a dedicated technical explanation instead.

### `/app` — Sentinel Command Center

Primary user goal: determine the current protection posture and choose the next safe action.

Hero state: one large aggregate state, for example “3 protocols protected” or “1 active incident requires attention”. It must be derived from loaded records, not a placeholder metric.

Sections:

- Global posture summary: protected, assessing, active incident, paused, recovery assessing.
- Protected protocol cards.
- Active incident attention panel.
- “What changed” or recent activity panel.
- Watcher status panel when the optional watcher is enabled.
- Small trust note: target state is verified from the protected contract.

Protocol cards show protocol name/id, protection state, emergency condition, source threshold, policy lock, target state, and last assessment. Use “Protected”/“Emergency pause active”, not “ACTIVE”/“PAUSED” alone.

Primary action: open the protocol or incident requiring attention.

Secondary actions: protect a protocol, open incident, browse activity, view transparency.

Contract reads: protocol records, incident summaries, target adapter state, and recent transaction/lifecycle records from the data layer.

Contract writes: none directly from the summary view; setup and incident actions are routed to guided flows.

Loading: skeleton metric blocks and protocol-card shells; keep the shell and navigation visible.

Empty: “No protected protocols yet” with “Protect a protocol” CTA; never show fake counts.

Error: distinguish “chain unavailable”, “protocol index unavailable”, and “target state unavailable”; allow retry and show last-known timestamp only when clearly labeled stale.

Mobile: stack posture cards; use a compact bottom navigation or menu for primary routes; keep one attention card above the fold.

Advanced: a collapsible “Data sources and synchronization” drawer with RPC, chain id, block/receipt timestamps, and indexer freshness.

### `/app/protocols` — protected protocol directory

Primary user goal: browse every opted-in protocol and compare protection posture.

Hero state: “Protected protocols” with a count only when the directory source is authoritative.

Sections:

- Search/filter by state, incident state, and policy lock.
- Protocol cards with state, emergency condition, evidence coverage threshold, last assessment, and target verification age.
- Directory limitation notice when the contract does not expose enumeration and an indexer/configured-id source is being used.

Primary action: open a protocol profile.

Secondary actions: start protection setup, filter paused/assessing, open activity.

Contract reads: `get_protocol(protocolId)` for each known id; incident summary and target state per protocol. A production directory requires an indexer or registry because the current contract has no enumeration view.

Contract writes: none.

Loading: card skeletons with source label (“indexed” or “configured id”).

Empty: explain whether there are genuinely no records or no directory source configured.

Error: isolate one protocol read failure from a directory-wide failure; show retry per card where possible.

Mobile: one card per row; filters in a bottom sheet; state badge and target state remain visible.

Advanced: target address, owner, contract addresses, chain id, last read block, and raw state link.

### `/app/protocols/[protocolId]` — Protocol Security Profile

Primary user goal: understand exactly what protects one protocol and whether the protection is real now.

Hero state: “Protected”, “Emergency pause active”, “Assessment in progress”, or “Protection setup incomplete”, backed by target readback and incident state.

Sections:

- Protection status and target-state verification card.
- Emergency trigger in plain English: critical failure class and what it means.
- Evidence requirement: minimum independent sources and allowed domains.
- Evidence freshness: max age, latest bound evidence age, stale/fresh indicators.
- Recovery policy: cooldown and required recovery evidence.
- Policy lock state and lock timestamp/transaction if available.
- Sentinel controller status: target authorized address and controller configured state.
- Protection timeline: registration, policy lock, incidents, pause confirmation, recovery.
- Emergency-policy details card.

Primary action: “Start protection setup” when incomplete, or “View incident” when attention is required.

Secondary actions: simulate/update policy before lock, view activity, open transparency, open technical details.

Contract reads: `get_protocol`; target `get_owner`, `get_authorized_sentinel`, `is_controller_configured`, `is_paused`, `get_total_processed`, `get_pause_counters`; incident records for the protocol.

Contract writes: setup only: ProtectedDemo `configure_sentinel`; Sentinel `register_protected_protocol`, `update_emergency_policy`, `lock_emergency_policy`. Each is a separate guided transaction with precondition and readback.

Loading: show independent loading for policy and target state; never render “Protected” until both required reads succeed.

Empty: unknown protocol id is a not-found state, not an unprotected state.

Error: show which source failed; if target readback is unavailable, display “Protection state cannot be verified” rather than “Protected”.

Mobile: protection status and target readback first; policy details in accordions; timeline becomes a vertical list.

Advanced: raw protocol fields, addresses, chain, transaction hashes, contract schema version, receipt/consensus details, and source/deployed-code parity where available.

### `/app/incidents` — incident history

Primary user goal: see all incident lifecycles and find unresolved risk.

Hero state: “Incident history” with active, paused, assessing, and recovered counts from an authoritative index.

Sections:

- Attention queue: assessing, active, pause requested, paused, recovery assessing, recovery authorized.
- History table/list with protocol, opened time, state, verdict, target state, and last action.
- Filters for protocol and lifecycle state.

Primary action: open the selected Incident Command Center.

Secondary actions: “Report a potential incident”; filter/export when data source supports it.

Contract reads: `get_incident(incidentId)` and `get_state(incidentId)` for known/indexed ids; target state for active lifecycles.

Contract writes: none.

Loading: list skeleton and independent attention count placeholders.

Empty: distinguish no incidents from no incident index; explain current contract limitation.

Error: preserve loaded rows and mark only failed rows if possible.

Mobile: cards replace the table; state and protocol remain first, timestamps and verdicts move below.

Advanced: incident ids, reporter, raw verdicts, transaction hashes, and receipt links.

### `/app/incidents/new` — guided incident creation

Primary user goal: report and substantiate a potential emergency without filling a blockchain form.

Stages:

1. What happened? Select the protected protocol and describe the observed condition in plain language. The description is context, not proof.
2. Add evidence. Add one or more source references with source type, URL, observed time, digest, transaction hash, and block.
3. Evidence verification. Show HTTPS/domain, freshness, digest, target association, and independent-domain coverage checks before submission where possible.
4. Review. Show the locked policy, exact evidence set, missing requirements, and irreversible/consensus boundaries.
5. Begin assessment. Open the incident, bind evidence, and start assessment as distinct transactions.

Hero state: “Report a potential emergency” with a step indicator, never “Pause protocol”.

Primary action: advance the current guided stage; final action “Begin assessment”.

Secondary actions: save an unsigned local draft, cancel, open the policy profile, inspect advanced validation.

Contract reads: protocol policy and lock state; current target state; current incident existence when ids are chosen; account/network context.

Contract writes: Sentinel `open_incident`, then `bind_evidence` per evidence item. `assess_incident` is a separate explicit action after coverage is complete.

Loading: stage-level validation and transaction progress; preserve form values through refresh as an unsigned draft.

Empty: no eligible locked protocols -> link to setup.

Error: field errors first, contract error second, technical payload in Advanced; never discard a persisted transaction hash.

Mobile: one stage per viewport; evidence cards become full-width; sticky bottom action bar with current step and validation summary.

Advanced: canonical calldata preview, digest bytes, source-domain parser result, contract limits, fee estimate, and raw simulation result.

### `/app/incidents/[incidentId]` — Incident Command Center

Primary user goal: manage one incident from evidence through verified recovery.

Hero state: a large lifecycle label and one-line explanation, for example “Active incident confirmed” or “Emergency pause active”.

The strongest screen layout is:

```text
Evidence -> Assessment -> Decision -> Response -> Recovery
```

Sections:

- Lifecycle stepper with current stage and completed proof gates.
- Incident state and plain-language decision card.
- Evidence Intelligence cards and Evidence Coverage meter.
- Explainable consensus card with reason and quorum outcome.
- Response panel separating decision authorized, transaction executed, and target state verified.
- Direct target-state verification card.
- Incident timeline.
- Recovery Guardian when the protocol is paused.
- Advanced / Consensus details drawer.

Primary action: the next valid lifecycle action only, with wording derived from the proof gate: “Run assessment”, “Request emergency pause”, “Verify target pause”, “Begin recovery assessment”, “Request unpause”, or “Verify recovery”.

Secondary actions: add evidence when allowed, inspect source details, open protocol profile, view transaction, refresh authoritative state.

Contract reads: `get_incident`, `get_state`, `get_evidence` for all attached ids, `get_protocol`, and target `is_paused` plus controller/owner/metrics reads.

Contract writes: `assess_incident`, `execute_pause`, `confirm_pause`, `begin_recovery`, `bind_evidence` for recovery, `assess_recovery`, `execute_unpause`, `confirm_recovered`.

Post-write readbacks: every parent write requires finalized execution verification and incident readback. `execute_pause` additionally requires the triggered target transaction and `is_paused() == true` before “Emergency pause active”. `confirm_pause` must re-read target state. The equivalent rules apply to unpause and recovery.

Loading: keep the stepper visible with the current known stage; show a “Rechecking chain state” banner rather than changing state optimistically.

Empty: missing evidence is a coverage state, not an error; unknown incident id is a not-found state.

Error: show “decision not verified”, “response not verified”, or “target state not verified” according to the failed proof gate. Technical errors are expandable.

Mobile: stepper becomes a vertical timeline; evidence and consensus cards stack; the next action is sticky but disabled when any precondition is stale.

Advanced: raw verdicts, authenticated counts, source-domain comparison, leader/validator receipts, consensus result, execution result, parent and triggered transaction hashes, fee accounting, and explorer links.

### `/app/activity` — system activity

Primary user goal: understand what Sentinel is doing and recover safely after refresh or an interrupted browser session.

Hero state: “System activity” with separate operational and transaction states.

Sections:

- Live/pending operations.
- Finalized operations.
- Failed or ambiguous operations requiring review.
- Transaction detail drawer.
- Last synchronization timestamp and source.

Primary action: “Reconcile” an existing hash. Never “Retry transaction” automatically.

Secondary actions: open affected protocol/incident; copy hash; open explorer.

Contract reads: transaction lifecycle/receipt, triggered transaction ids, incident/protocol/target readbacks as required.

Contract writes: none from activity; a user can navigate to the owning workflow for a deliberate retry only when contract state proves it is safe and the operation is not already final.

Loading: per-row lifecycle updates; do not block the entire page on one slow transaction.

Empty: “No recorded operations” with explanation of local persistence and chain history limitations.

Error: retain the hash and mark “Unable to reconcile”; do not delete it or rebroadcast.

Mobile: compact rows with state first; details open as a bottom sheet.

Advanced: full receipt, consensus status, execution status, nonce, fee accounting, triggered child transactions, and raw RPC errors.

### `/transparency` — public trust and proof surface

Primary user goal: understand Sentinel's authority boundary without GenLayer knowledge.

Hero state: “A bounded emergency response system, not a universal security oracle.”

Sections:

- What Sentinel can do.
- What Sentinel cannot do.
- Who defines and locks policy.
- How evidence is authenticated.
- What validators judge.
- Why consensus does not itself authenticate evidence.
- Why target-state readback matters.
- How recovery authorization works.
- Public proof links for deployed contracts, source hashes, policy, and finalized lifecycle transactions when available.

Primary action: “See the protection flow”.

Secondary actions: open Developer, open a public protocol profile, inspect proof details.

Contract reads: optional public reads for explicitly selected deployed protocol/proof records; no wallet required.

Contract writes: none.

Loading/empty/error: public explanatory content remains available; live proof cards show “Proof unavailable” rather than inferred facts.

Mobile: narrative sections become accordions; the authority boundary summary remains visible.

Advanced: schemas, raw enums, source/deployed-code parity, consensus receipts, transaction ids, chain/RPC metadata.

### `/developer` — integration guide

Primary user goal: implement the smallest safe Sentinel-compatible controller.

Hero state: “Protect your protocol in three steps.”

Sections:

1. Implement `emergency_pause()`, `emergency_unpause()`, and `is_paused()`.
2. Authorize Sentinel as the controller.
3. Configure and lock an emergency policy.

Include a conceptual interface, security requirements, target-state confirmation rule, lifecycle diagram, policy examples/templates, and a checklist for testnet integration.

Primary action: “Start protection setup” or “View example interface”.

Secondary actions: open Transparency, open protocol setup, view schema/technical reference.

Contract reads/writes: none for documentation; an optional connected setup CTA reads wallet/network and begins the separate setup flow.

Loading/empty/error: static documentation does not depend on the chain; live “Try setup” widgets do.

Mobile: code/interface examples horizontally scroll or wrap safely; steps remain vertical.

Advanced: method signatures, schema links, chain configuration, fee/transaction notes, and raw contract references.

### Settings drawer

Primary user goal: control local display and connection preferences.

Include network/account display, refresh interval, notification preferences, reduced motion, and clear-local-draft controls. Never allow a setting to alter the contract address or network silently. Network changes must be explicit and visibly confirmed.

## Reusable component architecture

Components should be state-first, data-source-aware, and reusable across protocols and incidents.

| Component | Responsibility |
| --- | --- |
| `StatusBadge` | Human state label, semantic color, tooltip with raw value. |
| `ProtocolCard` | Protocol posture, target verification, policy lock, evidence threshold, last assessment. |
| `EvidenceCard` | Source, domain approval, freshness, digest binding, phase, class, independence, and verification state. |
| `EvidenceCoverage` | “X of Y required independent sources”, domain chips, missing coverage explanation. |
| `LifecycleStepper` | Evidence -> Assessment -> Decision -> Response -> Recovery with proof gates. |
| `DecisionCard` | Plain-language decision, criteria summary, confidence boundary, and fail-closed explanation. |
| `ConsensusDrawer` | Raw consensus/execution/receipt details behind Advanced. |
| `TransactionProgress` | Preparing -> approval -> submitted -> consensus -> finalized -> execution verified -> state verified. |
| `TargetStateVerification` | Direct target readback with freshness, expected state, actual state, and proof timestamp. |
| `PolicyCard` | Emergency trigger, domains, source threshold, freshness, cooldown, lock state, and templates. |
| `IncidentTimeline` | Ordered chain-derived lifecycle events and transaction links. |
| `RecoveryPanel` | Fresh evidence, coverage, recovery decision, cooldown, unpause, and target proof. |
| `WatcherStatus` | Watcher scope, approved sources, last scan, proposal state, and explicit no-unilateral-authority message. |
| `TechnicalDetailsDrawer` | Addresses, chain, raw fields, schemas, hashes, and SDK/RPC diagnostics. |
| `ConnectionStatus` | Network, account, chain id, read freshness, and mismatch handling. |
| `EmptyState` | Honest distinction between no records, no data source, and unavailable data. |
| `ProofGate` | Reusable “not proven yet” treatment for decision, execution, and target readback. |

## Visual system

Use a dark neutral foundation, clean typography, generous spacing, restrained cards, minimal gradients, and semantic color. The visual tone is premium institutional cybersecurity/infrastructure software.

- Green: protected, recovered, verified.
- Amber: assessing, attention, pending.
- Red: incident, paused, failed.
- Blue: informational, consensus, technical detail.
- Neutral: inactive, history, unknown.

Large state labels carry more visual weight than raw transaction details. Cards should create hierarchy, not a grid of equal-weight metrics. Avoid neon glow, token-price patterns, speculative charts, and casino/DeFi motifs.

## Responsive rules

The desktop shell may use a two-column detail layout, but all critical states must survive a narrow viewport:

- primary navigation collapses to a menu or bottom navigation;
- state, next action, and target verification remain above the fold;
- tables become cards or sheets;
- advanced technical content is collapsed by default;
- sticky action bars must not obscure evidence or error text;
- every status has text, not color alone;
- touch targets are at least 44px and forms support keyboard and screen readers.

## Product copy rules

Prefer:

- Protected
- Assessment in progress
- Active incident confirmed
- Emergency pause requested
- Emergency pause active
- Recovery assessment
- Safe to recover
- Recovery requested
- Recovered
- Unable to verify

Avoid exposing these as primary labels: `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, `ACTIVE_INCIDENT`, `feeValue`, `executionBudgetPerRound`, “broadcast successful”, or “paused” before target readback. Raw values belong in Advanced / Consensus details.
