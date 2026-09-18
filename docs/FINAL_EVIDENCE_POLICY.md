# Final Evidence and Policy Qualification

Status: read-only qualification completed 2026-09-12.

No contract source, frontend application code, deployed state, transaction, or
deployment was changed. The staging `demo` protocol remains untouched.

## Decision gate

The recommended final model is a fresh, reproducible demonstration event using
the failure class `unauthorized-drain`, with two small, immutable JSON evidence
artifacts served from two real HTTPS origins. One artifact is an objective event
manifest; the other is an authoritative protocol security bulletin. Recovery
uses two new recovery-phase artifacts after remediation and cooldown.

The final deployment gate is currently **NO**. The selected publication
channels pass local transport and direct-mode shape checks, but there is no
currently qualified no-key objective transaction API for Studio-dev chain
61997, and the current Sentinel source does not cryptographically link the
bound `transaction_hash`/`transaction_block` metadata to a fetched chain proof.
The final policy must not be locked until those two gaps are closed by a
read-only, public objective adapter and a successful hosted-validator smoke
test.

This is a qualification blocker, not permission to deploy or broadcast.

## Failure-class decision

`unauthorized-drain` remains the strongest showcase class.

| Class | Assessment |
|---|---|
| `unauthorized-drain` | Best fit. Judges understand the harm; a concrete transfer is objective; an incident bulletin supplies context; pause is an obvious bounded consequence; remediation and revocation support credible recovery. |
| `critical-exploit` | Too broad for the current boolean evidence schema. It tends to require vulnerability analysis rather than a reproducible event and does not naturally prove an immediate target consequence. |
| `compromised-treasury` | Understandable, but requires balances, authorization history, and asset identity that the current contract does not authenticate. It is a possible future policy template, not a stronger RC1 proof. |
| `oracle-integrity-failure` | Requires domain-specific oracle semantics and price/reference data. It increases evidence ambiguity without improving the current pause story. |
| `security-incident` | Too generic. It broadens the semantic question and weakens the explanation of why pausing is authorized. |
| `critical-dependency-compromise` | Public CVE/advisory sources exist, but they describe software risk rather than a fresh, target-specific onchain consequence. |

The validator remains a bounded adjudicator of the locked class. It is not a
general risk assessor and must not infer a pause from an arbitrary security
warning.

## Recommended final scenario

### Incident: fresh harmless demo event

Use a new final showcase target with a small isolated demo balance or
non-economic test asset. Before judging, create one recognizable,
owner-approved test event through the target's intentionally exposed demo
path: an unapproved recipient receives a bounded transfer from the isolated
demo balance. The event must be a real finalized Studio-dev transaction, not a
mock and not a historical exploit.

The final target must still implement only Sentinel's minimal controller
interface:

```text
emergency_pause()
emergency_unpause()
is_paused()
```

Any balance, transfer, or demo counters are target-specific and are not
requirements imposed by Sentinel. The current staging `ProtectedDemo` has no
asset balance or transfer semantics, so it is not sufficient to honestly call
its existing `process(amount)` operation an unauthorized drain.

Source 1 publishes the objective event facts: transaction hash, sender,
recipient, asset/value, block, timestamp, target, and finalized status. Source
2 publishes the protocol owner's incident bulletin: why the recipient was not
authorized, which component was affected, and that the emergency condition is
currently active. Both artifacts include the exact Sentinel identity fields
required by the current RC1 JSON contract.

### Recovery: new remediation event

After Sentinel confirms the target is paused and the positive cooldown has
elapsed, revoke the compromised capability or deploy the remediation in the
isolated target. Publish two **new** recovery artifacts. Source 1 objectively
records the remediation transaction/state; Source 2 publishes a new security
bulletin stating that the unauthorized path is disabled, the incident is
contained, and recovery is authorized.

Recovery artifacts use `current=false`, `critical_signal=false`, and
`mitigation_complete=true`. They are bound with new evidence IDs and fetched
again during recovery assessment. Incident evidence is not reused.

## Candidate-source research

The following observations were made with direct HTTPS requests using a
no-redirect client. Response lengths are intentionally measured against the
Sentinel 65,536-byte input limit.

| Candidate | Operator / type | HTTPS, auth, redirects | Observed response and stable fields | Provenance / rate limit | Decision |
|---|---|---|---|---|---|
| `eth.blockscout.com/api/v2/transactions/{hash}` | Blockscout per-instance objective EVM transaction API | HTTPS; no credential observed; no `Location` on a known 200 response | 1,852 bytes JSON; includes hash, block, timestamp, sender, recipient, value, status, gas and method | Good transaction shape on supported EVM chains; per-instance availability/deprecation and rate-limit policy must be checked for a chosen chain | **Transport-qualified only; reject for Studio-dev**. The published Blockscout chain map has no 61997 entry. |
| `api.blockscout.com/1/api/v2/transactions` | Blockscout universal PRO API | HTTPS; current no-key request returned `402 Proceed with API key or make a X402 payment`; no redirect | 67-byte JSON error | Requires a private key or payment, both outside the final demo requirement | Reject. |
| `explorer-studio.genlayer.com/api/transactions` | GenLayer Studio Explorer API | HTTPS; no login observed; no redirect | JSON list exceeded 65,536 bytes; the site route is not a small per-transaction evidence object | Site bundle identifies the Studio network as chain 61999, not Studio-dev 61997; query/search is an explorer UI concern | Reject for contract evidence. Use only as a human-facing link if the correct network is supported. |
| `explorer-studio.genlayer.com/tx/{hash}` | GenLayer Studio Explorer HTML page | HTTPS; no redirect observed | 22,952-byte HTML, not the contract's JSON facts | Does not prove Studio-dev and requires HTML interpretation | Reject for contract evidence. |
| `raw.githubusercontent.com/{repo}/{commit}/evidence/{id}.json` | GitHub CDN, pinned repository artifact | HTTPS; no credential; pinned commit; no `Location` observed | A pinned current public file fetched as 28,994-byte text; three repeated fetches had identical SHA-256 `08de52539851817726fd247dfd1b2f13ec43d1d36b0942ed7268e261f0a513fa`. A future JSON artifact should be far smaller. | Commit pin gives reproducible publication; GitHub availability/rate limits are not a contractual SLA. It is owner-authored unless a separate publisher controls it. | **Recommended publication channel, pending final artifact and objective-proof design**. |
| `arweave.net/{data_transaction_id}` | Arweave content-addressed publication gateway | HTTPS; no credential; no `Location` observed | A known transaction status endpoint returned 142-byte JSON; the future data object must carry an explicit JSON content type and remain well below 65,536 bytes | Content-addressed immutability is strong; gateway availability and propagation are operational dependencies. The artifact publisher is still the authority for semantic claims. | **Recommended semantic-bulletin channel, pending final artifact**. |
| `www.cisa.gov/.../known_exploited_vulnerabilities.json` | CISA public feed | HTTPS; no credential; no redirect observed | 200 JSON but exceeded 65,536 bytes and is not target-specific | Authoritative for its catalog, not for this demo protocol | Reject. |
| `test-server.genlayer.com/static/genvm/hello.html` | GenLayer test fixture | HTTPS; no credential; no redirect observed | 971-byte HTML; same length but different SHA-256 values across later fetches (`dbe424...`, `eb484d...`, `504e11...`) | Intended for SDK tests, not incident authority | Reject as evidence. Useful as a runtime smoke fixture only. |

Distinct hostnames are not automatically distinct organizations. The contract
can guarantee only distinct canonical hosts in the locked allowlist. The UI
must say “two approved source origins corroborated the claim,” not “two
independent organizations proved it,” unless an off-chain publisher registry
establishes that stronger fact.

## GenVM-path qualification

The installed local v0.6-compatible web response exposes only:

```text
status
headers
body
```

It does not expose a final URL, redirect chain, or cryptographic origin proof.
The hardened Sentinel therefore rejects observable 3xx responses and
`Location` headers, but cannot prove that a transparent redirect was not
followed. Final source URLs must be direct, redirect-free endpoints; this is a
deployment gate.

`diagnostics/web_source_probe.py` and
`diagnostics/web_source_probe_contract.py` exercise `gl.nondet.web.get` inside
a diagnostic contract through the installed `gltest-direct` runtime. The
diagnostic obtains the candidate body with a no-redirect host client, feeds
the exact status/headers/body through the direct runner's documented live I/O
boundary, and compares the returned status, byte length, and SHA-256. It does
not deploy or broadcast.

The probe demonstrated matching host/direct-mode status, size, and digest for:

| Source path | Host result | Direct `gl.nondet.web.get` result | Qualification |
|---|---|---|---|
| Blockscout individual transaction endpoint | 200, 1,852 bytes | 200, 1,852 bytes, matching SHA-256 | Runtime shape pass; wrong chain. |
| Pinned GitHub raw file | 200, 28,994 bytes | 200, 28,994 bytes, matching SHA-256 | Runtime shape pass; not an incident artifact. |
| Arweave transaction status | 200, 142 bytes | 200, 142 bytes, matching SHA-256 | Runtime shape pass; future data artifact not yet published. |
| GenLayer test fixture | 200, 971 bytes | 200, 971 bytes, matching SHA-256 | Transport pass; content is not stable evidence. |
| Blockscout PRO without key | 402, 67 bytes | 402, 67 bytes, matching SHA-256 | Correctly fails the no-secret requirement. |
| GenLayer Explorer list | 200, at least 65,537 bytes | 200, at least 65,537 bytes | Exceeds Sentinel limit. |
| CISA feed | 200, at least 65,537 bytes | 200, at least 65,537 bytes | Exceeds Sentinel limit. |

This is a direct-mode compatibility and transport test, not proof of hosted
Studio-dev validator egress. Direct mode is mock/live-handler based and does
not provide a read-only way to make real validator nodes fetch a new URL. A
hosted smoke must be performed later through the actual consensus path before
locking the final policy; no transaction is authorized by this document.

## Final policy recommendation

The final policy should use a new protocol ID, never the permanently locked
staging `demo` policy:

| Field | Recommended value | Reason |
|---|---|---|
| `protocol_id` | `showcase` | Separates the final proof from the illustrative locked `demo`. |
| `critical_failure_class` | `unauthorized-drain` | Bounded, obvious, and directly tied to pause. |
| `allowed_source_domains` | `raw.githubusercontent.com,arweave.net` | Real HTTPS hosts with no private API credential; exact host matching is enforced. Final artifacts and hosted fetch must still qualify them. |
| `minimum_sources` | `2` | Requires both the objective and semantic roles. |
| `max_evidence_age_seconds` | `3600` | Tight enough to require a current event, with one-hour operational room for publication and judging. If measured publication SLA is worse, do not silently widen it; fix the source workflow or requalify. |
| `recovery_cooldown_seconds` | `900` | Positive 15-minute delay makes recovery deliberate and judge-visible. It remains protocol-configurable. |

This exact policy is a recommendation, not live state. It must not be
registered until `raw.githubusercontent.com` contains the immutable,
objective-proof-compatible artifact and `arweave.net` contains the immutable
semantic bulletin, both are fetched through the actual hosted validator path,
and their ownership/organizational relationship is disclosed.

### Why not add a third host now?

Do not add a third host merely to increase availability. A third origin such
as an IPFS gateway can be prequalified later, but mirrors of the same
owner-authored bytes are not independent corroboration. With `minimum_sources=2`,
the current two-role model gives the clearest judge story. If an operational
third source is later added, it must have a distinct provenance role, be
allowlisted explicitly, and not make the UI claim more independence than has
been established.

## Evidence records

The current RC1 `bind_evidence` call requires every item to include a valid
32-byte `transaction_hash` and nonzero `transaction_block`, including advisory
items. Use the same incident/remediation transaction metadata only when the
publisher can substantiate that association; do not invent it.

### Incident phase

For incident ID `incident-<event-id>`:

| Field | Objective item | Semantic item |
|---|---|---|
| `evidence_id` | `incident-<event-id>-objective` | `incident-<event-id>-advisory` |
| `phase` | `EMERGENCY` | `EMERGENCY` |
| `evidence_type` | `TRANSACTION` | `SECURITY_ADVISORY` |
| `source_url` | `https://raw.githubusercontent.com/<repo>/<commit>/evidence/<incident-id>-objective.json` | `https://arweave.net/<semantic-artifact-id>` |
| canonical host | `raw.githubusercontent.com` | `arweave.net` |
| `failure_class` | `unauthorized-drain` | `unauthorized-drain` |
| `event_timestamp` | Authenticated canonical RPC time for the underlying chain event; not compared with GenVM time | `0`/not applicable unless a source supplies a separately authenticated same-domain event time |
| `observed_at` | Assigned internally by Sentinel from GenVM `_now()` after authentication; revalidated at assessment | Assigned internally by Sentinel from GenVM `_now()` after authentication; revalidated at assessment |
| `content_digest` | lowercase SHA-256 of exact fetched UTF-8 bytes | lowercase SHA-256 of exact fetched UTF-8 bytes |
| transaction metadata | actual finalized Studio-dev event hash and block | actual associated event hash and block, not a fabricated advisory hash |
| authenticated objective fields | protocol ID/address, incident ID, phase, class, `current=true`, `critical_signal=true`, plus event facts in the authenticated bytes | same Sentinel fields plus the signed/immutable owner statement and remediation status |
| validator question | Do these authenticated facts establish a current unauthorized drain for this target? | Do these authenticated facts corroborate that the same current unauthorized drain is a policy incident? |

### Recovery phase

After `begin_recovery`, use new evidence IDs:

| Field | Objective item | Semantic item |
|---|---|---|
| `evidence_id` | `recovery-<event-id>-objective` | `recovery-<event-id>-advisory` |
| `phase` | `RECOVERY` | `RECOVERY` |
| `evidence_type` | `PROTECTED_STATE` or `TRANSACTION` | `SECURITY_ADVISORY` |
| `source_url` | a new pinned GitHub artifact for the remediation | a new Arweave content-addressed remediation bulletin |
| `failure_class` | `unauthorized-drain` | `unauthorized-drain` |
| `event_timestamp` | Authenticated canonical RPC time for the remediation transaction; not a GenVM freshness clock | not used as a cross-domain clock |
| `observed_at` | Internal GenVM observation time assigned after authentication | Internal GenVM observation time assigned after authentication |
| `content_digest` | SHA-256 of exact fetched bytes | SHA-256 of exact fetched bytes |
| transaction metadata | actual remediation transaction and block | the same remediation association only if substantiated |
| authenticated facts | `current=false`, `critical_signal=false`, `mitigation_complete=true`, target and incident match | same booleans plus the authoritative containment/recovery statement |
| validator question | Is the vulnerable capability objectively disabled and the emergency condition no longer current? | Do the new facts establish that it is safe to recover? |

The contract authenticates the whole response body by digest and checks target,
protocol, incident, phase, class, and the three boolean fields. It does not
currently prove that arbitrary nested event facts or bound transaction metadata
come from a chain receipt. A final UI must show that limitation rather than
calling those fields onchain proof.

## Judge-facing explanation

> Source 1 is the objective record. It tells us what transaction happened, who
> sent it, who received it, how much moved, and when.
>
> Source 2 is the protocol's security bulletin. It explains why that otherwise
> objective event was unauthorized and whether the emergency is still active.
>
> Sentinel first authenticates the bytes, the HTTPS host, the digest, the
> target, the incident, the phase, the failure class, and freshness. GenLayer
> validators then judge only the locked question: do these authenticated facts
> satisfy the `unauthorized-drain` policy?
>
> Validators do not redefine the policy, choose a new target, or obtain
> unilateral pause power. Two approved source origins are required so one
> unavailable, compromised, or misleading publication cannot decide the event
> alone. Sentinel calls the target only after consensus authorizes the pause,
> and the incident is not marked paused until target readback proves
> `is_paused() == true`.
>
> Recovery is a new decision. It requires new recovery evidence showing that
> the capability was remediated, the cooldown elapsed, and the emergency is no
> longer current. The system does not recycle the incident evidence to justify
> unpausing.

## Fail-closed source plan

If either selected source is unavailable, returns non-200, exceeds the content
limit, has an observable redirect, fails the digest, or is stale at assessment,
the assessment must not produce an affirmative verdict. With `minimum_sources=2`
the correct outcome is to stop and surface “evidence quorum unavailable”; do
not silently substitute a third source or rebroadcast.

Before final deployment, run a rehearsal that fetches each exact pinned URL
three times, records status/headers/size/digest, verifies the artifact is below
65,536 bytes, and exercises the final URLs through a hosted Studio-dev
consensus transaction. Any mismatch is a qualification failure.

## Known limitations and remaining blockers

1. The current Studio-dev explorer surface is not a qualified machine-readable
   transaction source for this contract: the public explorer is chain 61999,
   while the target network is chain 61997.
2. No current no-key Blockscout endpoint covers chain 61997. The current
   Blockscout universal endpoint requires a key or payment.
3. The GenVM v0.6 response shape does not prove final redirect origin.
4. Sentinel binds and validates transaction hash/block syntax but does not
   cryptographically link those metadata fields to the fetched body or a
   Studio-dev receipt.
5. GitHub and Arweave publication can make bytes reproducible and immutable,
   but they do not independently authenticate the underlying chain event unless
   the objective adapter/proof format is separately qualified.
6. Two canonical hosts do not prove two independent organizations. Ownership
   must be disclosed to judges and should be backed by separate operators if
   the stronger claim is needed.
7. The current staging ProtectedDemo has no treasury/transfer semantics, so a
   real unauthorized-drain narrative requires a fresh final target or an
   explicitly bounded isolated demo asset.

## Qualification output

```text
FINAL_FAILURE_CLASS: unauthorized-drain
FINAL_INCIDENT_SCENARIO: Fresh, harmless, bounded unauthorized test transfer from a final isolated demo target, authenticated by an objective event manifest plus an owner-authored incident bulletin.
FINAL_RECOVERY_SCENARIO: After confirmed pause and 900 seconds, revoke/repair the demo capability; publish new objective remediation and semantic containment artifacts; assess recovery; unpause; confirm target readback.

PRIMARY_SOURCE_1: Pinned objective JSON event manifest generated from a finalized Studio-dev receipt and served from a versioned raw artifact.
PRIMARY_SOURCE_1_HOST: raw.githubusercontent.com
PRIMARY_SOURCE_1_GENVM_FETCH: CONDITIONAL PASS — pinned public transport and gl.nondet.web.get direct-mode shape pass; final artifact and hosted Studio-dev egress not yet proven.

PRIMARY_SOURCE_2: Immutable protocol-owner security bulletin containing the semantic incident/containment facts.
PRIMARY_SOURCE_2_HOST: arweave.net
PRIMARY_SOURCE_2_GENVM_FETCH: CONDITIONAL PASS — public status-path transport and gl.nondet.web.get direct-mode shape pass; final data artifact and hosted Studio-dev egress not yet proven.

OPTIONAL_SOURCE_3: NONE SELECTED
OPTIONAL_SOURCE_3_HOST: NONE
OPTIONAL_SOURCE_3_GENVM_FETCH: NOT QUALIFIED

ORGANIZATIONAL_INDEPENDENCE_NOTES: The contract proves distinct canonical hosts, not distinct organizations. GitHub/Arweave publication authority and any objective adapter operator must be disclosed; do not market host diversity as organizational independence.

ALLOWED_SOURCE_DOMAINS: raw.githubusercontent.com,arweave.net
MINIMUM_SOURCES: 2
MAX_EVIDENCE_AGE_SECONDS: 3600
RECOVERY_COOLDOWN_SECONDS: 900

INCIDENT_EVIDENCE_MODEL: EMERGENCY TRANSACTION objective manifest + EMERGENCY SECURITY_ADVISORY semantic bulletin; new evidence IDs; exact-body SHA-256; actual event metadata; fresh at bind and assessment.
RECOVERY_EVIDENCE_MODEL: RECOVERY TRANSACTION/PROTECTED_STATE remediation manifest + RECOVERY SECURITY_ADVISORY containment bulletin; entirely new evidence IDs; fresh after remediation and cooldown.

GENVM_SOURCE_TEST_RESULT: Direct-mode gl.nondet.web.get transport/shape checks PASS for selected publication channels; hosted Studio-dev validator fetchability NOT PROVEN.
LIVE_DEMO_REPRODUCIBLE: NO — not until the final target event, immutable artifacts, objective proof linkage, and hosted smoke are qualified.
SOURCE_AUTHENTICITY_MODEL: HTTPS status/body retrieval, exact UTF-8 SHA-256, exact canonical host, target/protocol/incident/phase/class matching, deterministic transaction/advisory linkage, same-domain internal observation freshness at assessment, and two-domain quorum.
SEMANTIC_JUDGMENT_MODEL: Validators judge only whether authenticated normalized facts collectively satisfy locked unauthorized-drain or safe-to-recover booleans; they cannot broaden authority or initiate any action outside the lifecycle.
KNOWN_LIMITATIONS: No final-URL provenance in v0.6; no 61997 public explorer transaction API found; arbitrary nested event fields and bound tx metadata are not chain-proof verified; host diversity is not organizational independence; current ProtectedDemo is not a drain-capable target.
SAFE_TO_CREATE_FINAL_DEPLOYMENT: NO
```

## Exact next gate before deployment

1. Define the final isolated target event and remediation without using the
   current staging `demo` as a claimed treasury.
2. Provision the pinned GitHub objective artifact and Arweave semantic/recovery
   artifacts with an explicit publisher/provenance record.
3. Add or qualify a public no-key Studio-dev objective adapter that returns a
   small canonical proof object and documents how its facts are derived from
   `gen_getTransactionReceipt`.
4. Run the exact final URLs through a hosted Studio-dev consensus smoke and
   reconcile the same hash; stop on any unavailable, stale, redirect, size,
   digest, or proof-link failure.
5. Only after all gates pass, register and lock `showcase` with the exact policy
   above and run the full incident → pause → recovery → unpause proof.

## References

- [GenLayer Studio environments](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio) — Studio-dev is chain 61997; use its matching SDK/RPC.
- [GenLayer web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access) — external web data is nondeterministic; stable fields, provenance, multiple sources, and fail-closed handling are required.
- [GenLayer web data access](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/web-data-access) — web retrieval does not make a source inherently trustworthy; validate stable facts and provenance.
- [GenLayer node transaction receipt API](https://docs.genlayer.com/api-references/genlayer-node) — receipt data is the objective source needed by a future adapter.
- [Blockscout REST API](https://blockscout.mintlify.app/devs/apis/rest) and [Blockscout migration/API-key guidance](https://blockscout.mintlify.app/get-started/migration-guide) — per-instance endpoints and the current universal API behavior.
- [Arweave HTTP API](https://docs.arweave.org/developers/arweave-node-server/http-api) — content-addressed transaction/data retrieval.
