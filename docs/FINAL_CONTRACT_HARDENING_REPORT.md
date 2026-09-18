# Final Contract Hardening Report

> Historical report note: Studio-dev references and pre-deployment source
> hashes below describe development qualification only. The current final
> deployment is Studio Next.

## Current final deployment

```text
NETWORK: Studio Next
RPC: https://studio-next.genlayer.com/api
CHAIN_ID: 61997
SENTINEL: 0x452CA08CfF00A792bFcc0CdFCFaBe3CFe0B54709
PROTECTED_DEMO: 0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B
POLICY_LOCKED: true
```

Status: source-only clock-domain correction implemented and verified locally on
2026-09-13. No deployment, broadcast, frontend change, commit, or push was
performed.

## Implemented contract changes

### Sentinel

- Added `CHAIN_TRANSACTION` evidence as a distinct bounded role.
- Added locked `canonical_rpc_endpoint` and `allowed_source_prefixes` policy fields.
- Added canonical HTTPS host/path validation with exact segment-safe prefix matching.
- Added canonical JSON-string POST authentication against `eth_getTransactionByHash`.
- Authenticated transaction hash, sender/origin, target, calldata, finality,
  consensus, execution result, and canonical receipt event timestamp.
- Required the fetched target to equal the locked protocol target and required
  emergency evidence to be non-owner-originated while recovery evidence must be
  owner-originated.
- Required the fetched transaction input to equal the externally prepared,
  official-SDK-derived input stored with the evidence record. No general-purpose
  calldata decoder was invented inside GenVM.
- Bound transaction evidence to a deterministic SHA-256 digest of normalized
  authenticated facts.
- Required security advisories to reference the same transaction hash before
  semantic assessment.
- Removed caller-supplied `observed_at`. After authenticated evidence is
  accepted, Sentinel stores `observed_at = _now()` internally. Canonical chain
  time is stored separately as `event_timestamp`.
- Changed the public `bind_evidence` signature to remove the caller-controlled
  observation timestamp. `get_evidence` exposes the separate authenticated
  `event_timestamp` alongside the internal `observed_at`.
- Revalidated all evidence freshness at assessment using only the GenVM clock
  domain. A node/RPC timestamp is never compared with GenVM `_now()`.
- Preserved assessment-time freshness, phase isolation, distinct-host quorum,
  prompt-injection boundaries, target-state readback, policy locking, and the
  generic three-method protected-target interface.

The v0.6 response type still does not expose transparent redirect provenance.
Observable redirects and `Location` responses fail closed; production sources
must therefore be direct, redirect-free endpoints.

### ProtectedDemo

Added a deliberately small abstract treasury model. The unit is a deterministic
demo accounting unit, not a native token or DeFi balance:

- initial `treasury_balance = 1000`;
- `execute_outflow(recipient, amount)` records actor, recipient, amount, total
  outflow, and reduces the treasury before remediation;
- pause blocks outflow and normal `process` calls;
- `apply_remediation()` is owner-only, one-way, idempotent, and callable while
  paused;
- after remediation, non-owner outflows fail while owner outflows remain
  available;
- small treasury/remediation read methods expose proof-friendly state.

The reusable Sentinel target interface remains only `emergency_pause()`,
`emergency_unpause()`, and `is_paused()` for consequence verification.

## Verification

The direct-mode regression suite currently contains 61 passing tests.

| Check | Result |
|---|---|
| Full direct-mode suite | PASS — 60 tests |
| Sentinel AST/static lint | PASS — 3 checks |
| ProtectedDemo AST/static lint | PASS — 3 checks |
| Hosted Sentinel schema | PASS — `gen_getContractSchemaForCode` |
| Hosted ProtectedDemo schema | PASS — `gen_getContractSchemaForCode` |
| `git diff --check` | PASS |
| Transactions/deployments | NONE |

The hosted schema calls in this historical report were read-only RPC requests
to Studio-dev chain 61997.
The installed combined semantic runner check remains environment-dependent on a
cached v0.6 runner archive; AST lint, direct execution, and hosted schema checks
are the authoritative checks completed here.

## Decision gate

```text
STARTING_SENTINEL_SHA: D51F5455AFC880B9E4C0782F8FE69A9C7579758F452B465E61D8A293087A9187
FINAL_SENTINEL_SHA: 17B170A8394EDD250536937898EFF1FFD30AE8E90258E7578B8DD00E5FE1BD7D

STARTING_PROTECTED_DEMO_SHA: AA6AE78F77FD2549EE89E6D0FCA0198F69168DAB933EADC4A15B435299E4D1DD
FINAL_PROTECTED_DEMO_SHA: 1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4

RPC_ADAPTER_IMPLEMENTED: YES
RPC_REQUEST_BODY_TYPE: compact JSON string passed to gl.nondet.web.post
RPC_METHOD: eth_getTransactionByHash
RPC_IDENTITY_LOCKED: YES — exact endpoint stored in locked policy
TRANSACTION_HASH_AUTHENTICATION: PASS
TARGET_AUTHENTICATION: PASS
FINALITY_AUTHENTICATION: PASS
EXECUTION_AUTHENTICATION: PASS
CALLDATA_BINDING_MODEL: exact fetched-input equality against official-SDK-derived stored input
TIMESTAMP_AUTHENTICATION_MODEL: canonical RPC event_timestamp retained as authenticated data; internal GenVM observed_at assigned after authentication and revalidated at assessment
ADVISORY_PREFIX_LOCK_IMPLEMENTED: YES
ADVISORY_TRANSACTION_LINKAGE: deterministic hash membership before semantic judgment
SOURCE_INDEPENDENCE: distinct canonical approved hosts; organizational independence is not claimed

PROTECTED_DEMO_TREASURY: YES
VULNERABLE_OUTFLOW: YES — neutral execute_outflow action
PAUSE_BLOCKS_OUTFLOW: YES
REMEDIATION: owner-only, one-way, idempotent apply_remediation
REMEDIATION_WHILE_PAUSED: YES
POST_REMEDIATION_EXPLOIT_BLOCKED: YES
GENERIC_TARGET_INTERFACE_PRESERVED: YES

SENTINEL_REDEPLOY_REQUIRED: YES
PROTECTED_DEMO_REDEPLOY_REQUIRED: YES for the final pair because staging is locked to the old Sentinel
FINAL_SENTINEL_IMPLEMENTATION_READY: YES
FINAL_PROTECTED_DEMO_READY: YES
FINAL_EVIDENCE_MODEL_READY: YES
READY_FOR_FINAL_STUDIO_DEPLOYMENT: YES, subject to fresh deployment preflight and fee validation
```

## Clock-domain correction

Historical Studio-dev development evidence exposed incompatible timestamp
domains: canonical/node
transaction timestamps describe external event time, while GenVM `_now()` is the
transaction execution time visible inside Sentinel. The old caller-controlled
`observed_at` model compared those domains and could reject honest advisory
evidence as future or stale.

The corrected model separates them. `event_timestamp` is authenticated RPC
fact data for chain evidence. Advisory `issued_at` remains human/audit metadata
and is not a cross-domain freshness clock. After fetch, source identity,
content digest, schema, transaction linkage, and policy checks succeed,
Sentinel assigns `observed_at = _now()` internally. Assessment computes age
only from current GenVM `_now()` minus that stored value, with no caller escape
hatch and no fixed clock-offset workaround.

The public bind method is now:

```text
bind_evidence(
  incident_id, evidence_id, phase, evidence_type, source_url,
  failure_class, content_digest, transaction_hash,
  transaction_block, transaction_input
)
```

There is no `observed_at` argument. The next final deployment must use the
updated Sentinel ABI and a fresh ProtectedDemo pair because the existing
controller binding is one-time.

### Clock-domain correction verification snapshot

```text
STARTING_SENTINEL_SHA: 17B170A8394EDD250536937898EFF1FFD30AE8E90258E7578B8DD00E5FE1BD7D
FINAL_SENTINEL_SHA: 7C1AAA1E2BAF4E30FDE3F9CB329F17FCBB5860AFE3A3F66BA4A6D6D58A2F53EE
STARTING_PROTECTED_DEMO_SHA: 1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4
FINAL_PROTECTED_DEMO_SHA: 1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4
TESTS: 61 passed
TRANSACTIONS: NONE
DEPLOYMENTS: NONE
COMMITS: NONE
PUSHES: NONE
```

## Remaining limitations

Transparent redirects cannot be proven by the current GenVM response shape;
hostnames do not prove organizational independence; and the current contract
does not add unbounded enumeration or verbose LLM-reason storage. Those belong
in the frontend proof projection and are not correctness blockers for the
bounded lifecycle.
