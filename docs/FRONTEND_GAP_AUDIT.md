# Sentinel Frontend Gap Audit

Status: planning artifact only. Audit performed against the repository as it exists; no application or contract code was changed for this audit.

## Executive assessment

The current frontend is a real, read-first React foundation rather than a finished product. It has a credible trust-oriented visual baseline, typed contract/data seams, contract-derived rendering, a real EIP-1193 wallet boundary, and a tested “persist hash and reconcile the same hash” coordinator.

It is not yet competition-grade or aligned with the current live deployment. The app is still a single-demo Bradbury console with one configured protocol id and an explicit incident-id list. It uses `genlayer-js 1.1.8`, `testnetBradbury`, chain `4221`, and `https://rpc-bradbury.genlayer.com`, while the current deployment target is Studio-dev, chain `61997`, `https://studio-dev.genlayer.com/api`, with the current RC SDK/tooling. The local environment also has no configured Sentinel address and an older ProtectedDemo address, so the existing UI will intentionally render its configuration-empty state.

The most important product risks are:

1. a chain/network/SDK mismatch that makes the existing wallet and write path unsuitable for the live Studio-dev deployment;
2. no authoritative directory/index for protocols or incidents;
3. no persisted evidence authentication or consensus explanation data;
4. target verification is hard-coded to `ProtectedDemo` instead of following each protocol's registered target address;
5. the incident UI does not prove triggered target execution and target readback before claiming a consequence;
6. recovery is represented by action buttons but not by a complete Guardian experience.

## Existing frontend inventory

### Framework and build

| Area | Current implementation |
| --- | --- |
| UI | React 19.3 with TypeScript 5.9 |
| Build/dev | Vite 8, root `frontend`, output `dist` |
| Routing | Manual `window.location.pathname` switch in `frontend/src/app.tsx`; no router package |
| Tests | Vitest unit tests; Playwright route/empty-state tests |
| Styling | One global `frontend/src/styles.css`; CSS custom properties and media queries |
| Contract SDK | `genlayer-js` pinned to `1.1.8` in `package.json` |
| Browser wallet | Injected EIP-1193 provider through `window.ethereum` |
| State/query layer | Local React state and `useEffect`; no cache/query library |
| Persistence | `localStorage` for pending transaction operation id and hash |

### Current route structure

| Route | Current page | Assessment |
| --- | --- | --- |
| `/` | Landing page with static trust narrative and four-step diagram | Exists; needs product copy/CTA and visual refinement |
| `/app` | Control center with four metrics, one protocol card, configured incident rows | Exists; needs full posture and authoritative directory |
| `/app/protocols` | One configured protocol card | Exists; needs index-backed directory |
| `/app/protocols/[protocolId]` | Policy and current ProtectedDemo state details | Exists; needs full Security Profile |
| `/app/incidents` | Incident list from configured ids | Exists; needs history/attention queue/index |
| `/app/incidents/new` | Two-field incident-open form | Exists; needs guided five-stage flow |
| `/app/incidents/[incidentId]` | Dossier, evidence metadata, verdict callout, state-driven action | Exists; needs Incident Command Center |
| `/app/activity` | Local pending-operation key list | Exists; needs transaction history and reconciliation UI |
| `/transparency` | Static architecture/capability explanation and environment block | Exists; needs current public proof surfaces |
| `/developer` | None | Missing |
| Settings | None; no drawer or route | Missing, but should start as a shell drawer rather than another top-level route |

The manual router updates on `popstate`, but ordinary anchor navigation reloads the page. It has no nested route error boundary, no route-level code splitting, and no typed route parameters beyond string parsing.

### Existing component structure

Most UI is colocated in the 266-line `frontend/src/app.tsx`. Existing components/functions include:

- `Header`, `WalletButton`, `NetworkStrip`, `Shell`;
- `ConfigurationNotice`, `EmptyState`, `LoadingPage`, `ErrorPage`;
- `LandingPage`, `ControlCenter`, `ProtocolsPage`, `ProtocolDetailPage`;
- `IncidentRow`, `IncidentsPage`, `IncidentDetailPage`, `IncidentActions`, `EvidenceBinder`, `NewIncidentPage`, `ActivityPage`, `TransparencyPage`;
- small formatting components `Metric`, `PageIntro`, `Detail`, plus inline card markup.

The library seam is split into:

- `lib/app-data.ts`: reads configured protocol, configured incident ids, evidence ids, and a ProtectedDemo-specific target;
- `lib/decoders.ts`: snake_case/camelCase normalization and fail-closed enum fallbacks;
- `lib/genlayer-client.ts`: transport/data types and client wrapper;
- `lib/genlayer-transport.ts`: GenLayer read/write/reconcile adapter;
- `lib/transaction-lifecycle.ts`: pending hash storage, retry-safe reconciliation, and issue classification;
- `lib/evidence-form.ts`: client-side field validation.

The target architecture needs feature boundaries and reusable components instead of page-level conditional markup in one file.

### Design system and responsive behavior

Strengths:

- dark neutral foundation with muted panels, mint/amber/red semantic colors;
- clean system/Inter-like typography, strong uppercase eyebrow labels, generous page spacing;
- restrained borders and cards rather than casino DeFi styling;
- existing responsive breakpoints at 860px and 540px;
- desktop-to-mobile grid collapse, hidden desktop nav at smaller widths, stacked footer and forms.

Gaps:

- the design system is implicit in one CSS file; there are no token ownership rules, component variants, spacing scale, or accessibility contract;
- desktop navigation disappears on mobile without a replacement menu/bottom navigation;
- important state is sometimes color/uppercase dependent and lacks a consistent semantic badge component;
- tables, drawers, stepper, target verification, coverage, and transaction progress patterns do not exist;
- source text contains mojibake in several glyphs (`â€¦`, `Â·`, `â†’`), which should be corrected during the UI pass;
- `Inter` is named but not explicitly loaded, so typography varies by platform;
- no documented keyboard focus, reduced-motion, screen-reader, touch-target, or contrast acceptance criteria.

## Existing contract integration

### Reads currently used

`app-data.ts` reads:

- Sentinel `get_protocol(protocolId)`;
- Sentinel `get_incident(incidentId)`;
- Sentinel `get_evidence(evidenceId)`;
- ProtectedDemo `get_owner()`;
- ProtectedDemo `get_authorized_sentinel()`;
- ProtectedDemo `is_controller_configured()`;
- ProtectedDemo `is_paused()`;
- ProtectedDemo `get_total_processed()`.

The UI does not currently read ProtectedDemo `get_pause_counters()`, Sentinel `get_state()`, full transaction receipts, fee accounting, consensus receipts, or durable triggered target transaction data.

### Writes currently used

The UI can submit these Sentinel writes:

- `open_incident(incidentId, protocolId)`;
- `bind_evidence(...)`;
- state-dependent `assess_incident`, `execute_pause`, `confirm_pause`, `begin_recovery`, `assess_recovery`, `execute_unpause`, and `confirm_recovered`.

It does not expose registration, policy editing/locking, ProtectedDemo controller configuration, or a guided setup path. It does not call ProtectedDemo writes directly. `emergency_pause` and `emergency_unpause` are correctly modeled as Sentinel-triggered contract-interface calls, not browser direct writes.

### Current transaction handling

The positive foundation is `TransactionCoordinator`:

```text
precondition read
-> broadcast once
-> persist returned hash
-> reconcile same hash
-> require FINALIZED + execution success
-> read final state
```

It preserves a pending hash across refresh through `localStorage`, handles a temporary reconcile error without rebroadcasting, distinguishes provisional `ACCEPTED` from finality in tests, and rejects finalized execution failure.

The product gaps are:

- the UI exposes almost none of the intermediate lifecycle visually;
- a stored record contains only `operationId` and hash, not method, protocol, incident, chain, account, timestamps, triggered child hashes, or the last known lifecycle;
- Activity lists storage keys but does not reconcile them or show receipts;
- `sendContractWrite` uses SDK `writeContract` with `value: 0` and has no fee-estimation path;
- there is no explicit transaction simulation/preflight state;
- cross-contract pause/unpause triggered hashes are fetched by the transport but not used by the incident UI;
- final-state reads for incident actions return the incident only, so `confirm_pause`/`confirm_recovered` do not themselves produce a UI-level target proof;
- failure classification is useful but incomplete for current Studio-dev consensus/execution/target-state distinctions.

## Current strengths

- Contract state is preferred over fabricated local incidents, verdicts, balances, or pause state.
- The UI labels evidence metadata separately from the contract-side `UNVERIFIED` state.
- A finalized execution error is not treated as success in the coordinator and transport logic.
- The target's `is_paused()` read is used for the dashboard/detail state rather than a local optimistic flag.
- The evidence form validates HTTPS, digest shape, transaction hash shape, timestamps, and blocks.
- Unit tests cover decoder fallbacks, form validation, pending-hash persistence, temporary RPC misses, accepted-vs-finalized handling, and execution failure.
- Existing copy communicates bounded authority and the need for target confirmation better than a generic Web3 dashboard.

## Current weaknesses, dead/demo-only UI, and fake data

### Demo-only or configuration-limited behavior

- `DashboardSnapshot` supports one configured protocol and a manually configured comma-separated incident id list; it is not a protocol/incident directory.
- The “Registered protocols” metric renders `1` whenever the configured protocol read succeeds. It is not an on-chain count.
- `readProtectedDemoState()` is hard-wired to `VITE_PROTECTED_DEMO_ADDRESS`; it does not read the target address stored in each Sentinel protocol record.
- `IncidentDossier.authentication` is always hardcoded to `"UNVERIFIED"`; no per-evidence authentication result is available to the UI.
- The landing flow diagram is intentionally static marketing content, but it must not be mistaken for live incident state.
- The Activity page shows only local pending keys and no historical chain activity.
- Runtime application code contains no general mock data, but tests use direct VM web/LLM mocks. The live empty state is honest when addresses/ids are absent.

### Wallet and environment issues

- `WalletButton` checks account and chain at mount/connect time but does not subscribe to `accountsChanged` or `chainChanged`.
- It does not verify the expected account, show balance, distinguish read-only from write-ready, or provide a safe network-switch flow.
- `sentinelClientConfig` is fixed to `testnetBradbury`, chain `4221`, and the Bradbury RPC. The current product deployment is Studio-dev, chain `61997`, and the Studio-dev RPC.
- `package.json` uses `genlayer-js 1.1.8`; current deployment work used the v2 RC path. The integration must be version-aligned before any write UI is trusted.
- `.env.local` has an old ProtectedDemo address and an empty Sentinel address, so current live contracts are not represented in the app.
- Existing end-to-end tests assert Bradbury and chain `4221`; they are stale acceptance criteria for the current Studio-dev product.

### Contract/API mismatches

| UI need | Current mismatch | Consequence |
| --- | --- | --- |
| Multi-protocol directory | Sentinel has no enumeration view; UI has one configured id | Requires an indexer/registry/configured id source and honest source labeling |
| Incident history | Sentinel has `get_incident(id)` only | Requires indexed ids or an event/transaction data service |
| Evidence intelligence | `get_evidence` returns metadata, not authentication outcome | Cannot claim authenticated, fresh, or domain-approved status from the current read alone |
| Explainable consensus | `_judge_evidence` creates a reason but `IncidentRecord` does not persist it or expose it | Durable plain-language decision explanation needs contract/API support or receipt-derived data |
| Generic target verification | Sentinel interface exposes `is_paused` and `get_authorized_sentinel`; app reads ProtectedDemo-specific owner/config/metrics | Per-protocol adapter metadata and read capabilities are needed |
| Pause proof | `execute_pause` emits a finalized child call and records `pause_requested`; app ignores triggered hash and target readback | “Paused” can be overstated unless the data layer verifies the target |
| Recovery proof | Same issue for `execute_unpause`/`confirm_recovered` | “Recovered” must wait for target `is_paused()==false` |
| Policy timeline | Contract does not expose registration/lock timestamps | Timeline needs transaction indexer/receipt metadata or can show only known milestones |
| Fee-safe writes | Current transport calls normal write with zero value and no v0.6 quote | Writes are not compatible with the current fee-bearing path |

## Approved-feature gap matrix

Classification meanings: `EXISTS_AND_USABLE` is usable against the approved product contract today; `EXISTS_NEEDS_REWORK` has a real foundation but is incomplete; `MISSING` has no meaningful implementation; `BLOCKED_BY_CONTRACT` cannot be made authoritative from current public contract methods alone; `BLOCKED_BY_DATA` needs an indexer/service/metadata source before it can be honest.

| Approved feature | Classification | Evidence and next move |
| --- | --- | --- |
| Sentinel Command Center | EXISTS_NEEDS_REWORK | `/app` has metrics/cards but only one configured protocol and no attention-first posture. |
| Guided protection setup | MISSING | No setup flow for register/configure/policy review/lock. |
| Protocol Security Profile | EXISTS_NEEDS_REWORK | Detail page has policy and target basics; needs target-specific verification, freshness, timeline, recovery, and technical drawer. |
| Incident Command Center | EXISTS_NEEDS_REWORK | Dossier exists; needs lifecycle, coverage, consensus explanation, response proof, and Recovery Guardian. |
| Evidence Intelligence | EXISTS_NEEDS_REWORK / BLOCKED_BY_CONTRACT | Metadata cards exist, but authentication outcomes are not public persisted fields. |
| Evidence Coverage Meter | MISSING / BLOCKED_BY_DATA | Source-domain CSV can be counted for one incident, but complete directory/independence freshness data needs a stronger query model. |
| Explainable Consensus | EXISTS_NEEDS_REWORK / BLOCKED_BY_CONTRACT | Verdict callout exists; durable reason/authenticated facts are not exposed by `get_incident`. |
| Real target-state verification | EXISTS_NEEDS_REWORK | Real reads exist for ProtectedDemo, but target selection and post-child verification are incomplete. |
| Recovery Guardian | EXISTS_NEEDS_REWORK | State-based recovery buttons exist; no evidence coverage, cooldown proof, response verification, or target readback sequence. |
| Safe transaction lifecycle UX | EXISTS_NEEDS_REWORK / BLOCKED_BY_DATA | Coordinator is sound, but SDK/network/fee path is stale and UI only shows a generic busy string. |
| Public transparency/proof surfaces | EXISTS_NEEDS_REWORK | Transparency page exists, but it names Bradbury/4221 and has no public proof records. |
| Emergency policy templates | MISSING | No template catalog or human-readable policy preview. |
| Policy simulator before permanent lock | MISSING / BLOCKED_BY_CONTRACT | No simulation/review UI; simulation must use current SDK fee/contract behavior and cannot prove live external evidence without a dedicated service. |
| Advanced consensus details drawer | MISSING | No receipt/consensus drawer or raw-vs-human presentation boundary. |
| Developer integration guide | MISSING | No `/developer` route or integration checklist. |
| Responsive/mobile UX | EXISTS_NEEDS_REWORK | CSS breakpoints exist; mobile navigation, stepper, drawers, sticky actions, and full accessibility behavior do not. |
| Empty/loading/error/recovery states | EXISTS_NEEDS_REWORK | Basic components exist; no granular stale/consensus/execution/target-proof/recovery states. |
| Sentinel Watcher | MISSING / BLOCKED_BY_DATA | Requires an off-chain constrained watcher, source policy enforcement, proposal storage, and explicit no-unilateral-authority UX. |

## Required-route gap matrix

| Required route | Classification | Gap |
| --- | --- | --- |
| `/` | EXISTS_NEEDS_REWORK | Current message is strong but does not use the approved headline/CTA or explain the five-step product story above the fold. |
| `/app` | EXISTS_NEEDS_REWORK | Current dashboard is one-protocol/configuration driven and not a command center. |
| `/app/protocols` | EXISTS_NEEDS_REWORK / BLOCKED_BY_CONTRACT | Needs directory source, filters, and multi-protocol posture. |
| `/app/protocols/[protocolId]` | EXISTS_NEEDS_REWORK | Needs complete Security Profile and target-address-driven adapter reads. |
| `/app/incidents` | EXISTS_NEEDS_REWORK / BLOCKED_BY_DATA | Needs an authoritative incident index and attention queue. |
| `/app/incidents/new` | EXISTS_NEEDS_REWORK | Current form only opens an incident; guided evidence/review/assessment stages are missing. |
| `/app/incidents/[incidentId]` | EXISTS_NEEDS_REWORK / BLOCKED_BY_CONTRACT | Needs persisted explanation/authentication and child-target proof data. |
| `/app/activity` | EXISTS_NEEDS_REWORK | Local keys are present, but no full activity feed, reconciliation controls, or receipt detail. |
| `/transparency` | EXISTS_NEEDS_REWORK | Needs current network facts, public proof links, and explicit answers to all authority questions. |
| `/developer` | MISSING | Must document the minimal controller interface and three-step setup. |

## Blockers by category

### Contract blockers

- No protocol enumeration view.
- No incident/evidence enumeration view.
- Incident records do not persist decision reason, authenticated source count, freshness outcome, or consensus/receipt references.
- Sentinel's generic target interface is intentionally narrow; the product cannot assume every target exposes ProtectedDemo's owner/configuration/counters.
- Contract does not expose policy registration/lock timestamps or a policy revision id.

These are not reasons to alter the frozen contracts in this planning task. The frontend must use an indexer/registry/receipt projection where the product needs directory/history data, and must label what is directly contract-read versus indexed.

### Data blockers

- Current configured environment points at Bradbury/old addresses, not current Studio-dev deployments.
- No shared indexer or event-derived data source for protocols, incidents, transactions, child messages, or public proof pages.
- No source retrieval/authentication result projection for Evidence Intelligence.
- No persisted reason/criteria packet for a durable Explainable Consensus panel.
- No watcher service or proposal data model.

### UX blockers

- The current busy state hides the seven-stage transaction lifecycle.
- Incident action buttons do not make proof gates visible or distinguish parent response from actual target state.
- The user can see raw policy values but not a plain-language emergency condition and recovery requirement.
- Error messages may surface raw SDK/contract wording without a human remediation path.
- The mobile navigation disappears instead of adapting.
- No clear “unable to verify” treatment when a target or evidence source cannot be read.

## Audit conclusion

Keep the current typed transport and transaction-coordinator ideas. Replace the one-file page composition and Bradbury-specific data assumptions with a Studio-dev-compatible, target-generic data layer, an authoritative/indexed record source, reusable state/proof components, and a route architecture centered on Protocol -> Incident -> Recovery. The highest-risk work is integration correctness and data truth, not visual polish.
