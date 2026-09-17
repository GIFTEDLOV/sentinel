# Final protocol-owned advisory source

Qualification completed on 2026-09-12; final deployment updated on 2026-09-14.
This document records the real public advisory channel and its qualification
evidence. The final Sentinel and ProtectedDemo pair is deployed on Studio Next,
with policy registration complete and permanently locked.

## Final Studio Next deployment

```text
network: Studio Next
chain_id: 61997
sentinel: 0x452CA08CfF00A792bFcc0CdFCFaBe3CFe0B54709
protected_demo: 0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B
canonical_rpc_endpoint: https://studio-next.genlayer.com/api
```

## Repository identity

| Field | Qualified value |
|---|---|
| GitHub owner | `GIFTEDLOV` |
| Repository | `sentinel-evidence` |
| URL | <https://github.com/GIFTEDLOV/sentinel-evidence> |
| Visibility | public |
| Branch | `main` |
| Directory | `evidence/advisories/` |
| Initial commit | `4debc5ef16d2b3015c6976b7766b7056468d6f0d` |

The Sentinel repository remains without a remote. Publication was performed
from the separate sibling workspace `C:\Users\DELL\sentinel-evidence-publish-20260912`.
No Sentinel commit or push was performed.

## Locked identity and policy preview

Candidate raw prefix:

```text
https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/
```

The serialized prefix-policy entry is:

```text
raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/
```

For final registration, the objective RPC and advisory channel are represented
by these exact values:

```text
protocol_id: sentinel-demo
target_address: 0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B
critical_failure_class: unauthorized-drain
allowed_source_domains: studio-next.genlayer.com,raw.githubusercontent.com
allowed_source_prefixes: studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/
canonical_rpc_endpoint: https://studio-next.genlayer.com/api
minimum_sources: 2
max_evidence_age_seconds: 3600
recovery_cooldown_seconds: 900
```

The ABI order is the current final Sentinel order:

```text
register_protected_protocol(
  protocol_id, target_address, critical_failure_class,
  allowed_source_domains, allowed_source_prefixes,
  canonical_rpc_endpoint, minimum_sources,
  max_evidence_age_seconds, recovery_cooldown_seconds
)
```

The installed `genlayer-js` `abi.calldata.makeCalldataObject` plus
`abi.calldata.encode/decode` roundtripped the complete registration arguments
exactly, including the real prefix. `lock_emergency_policy("sentinel-demo")`
also roundtripped exactly. Neither call was broadcast.

## Publication and content integrity

The public repository contains only the advisory channel files and a concise
root README. The local templates contain placeholders, not incident or
remediation transaction hashes. Historical advisories refer to the prior
staging target; new advisories must use the corrected final target above.

Unauthenticated raw fetches returned HTTP 200 with byte-for-byte matches:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `README.md` | 725 | `9d1f703a2f7f8e3b01d94ac236c1a60b3cefbaa43b2dcba6143dc1905056c77c` |
| `incident-template.json` | 912 | `2d14c6638241dbfae1cda7b26fcd29a140aa5590010b98deaf988d59df59bea3` |
| `recovery-template.json` | 974 | `bb16ea081d29a78588c22edddd67fe2c47a1c3072b19ffdb49ca34eb248f84da` |

The raw prefix test accepted both real template URLs and rejected ten attack
variants: wrong owner, repository, branch, directory, sibling prefix, HTTP,
userinfo/hostname-suffix, query, and fragment variants. The current Sentinel
normalization treats query and fragment as invalid for evidence identity.

The trust model is repository owner + repository + branch + directory prefix.
`main` is mutable; it is not claimed to be immutable. Git history provides
auditability, while each later bound advisory must use the SHA-256 digest of
the exact fetched bytes and a deterministic transaction-hash linkage. Used
advisory files must never be rewritten; incident and recovery use new files.

## Historical Studio-dev qualification

Direct GenVM-compatible testing fetched the real incident template through
`gl.nondet.web.get`: DNS and TLS succeeded, the response was HTTP 200 with no
redirect, 912 bytes, valid JSON, schema `sentinel-advisory-v1`, protocol
`sentinel-demo`, final Studio Next target, and the digest above.

A temporary diagnostic source
`diagnostics/hosted_advisory_get_probe.py` was schema-validated successfully
against Studio-dev. This section is historical development evidence only. The
one permitted diagnostic deployment finalized as:

```text
address: 0xb53Bc3307491Ac7f9557daA472bc196fF4b6c6A7
deployment tx: 0x329ddab477269527a338f6be11797efba5dcd0400cfc3601f8275cb8e254d83c
status: FINALIZED
consensus: MAJORITY_AGREE
execution: FINISHED_WITH_RETURN
```

The one permitted hosted fetch probe finalized on the same diagnostic:

```text
probe tx: 0xfceb46509fdd0ecec8faebf4cd3a03a25fda3335a394ff1d6798650e8b50c123
status: FINALIZED
consensus: MAJORITY_AGREE
execution: FINISHED_WITH_RETURN
normalized result: HTTP_200, 825 bytes, SHA-256 ae15c55049e883e8f3d623eb21ef3ce818c56ed563d5afc38e5d5734ba781c57
schema: sentinel-advisory-v1
protocol_id: sentinel-demo
```

The historical hosted result proved Studio-dev validators could reach the public
raw channel through the supported GenVM web path. The diagnostic had a fixed
template URL and enforced the expected digest/size/schema before returning a
small normalized result. No production contract was changed or called.

## Operational sequence

1. The exact policy above is registered and permanently locked.
2. Create the real outflow event and reconcile its canonical transaction.
3. Generate and publish a fresh incident advisory containing that hash.
4. Bind and authenticate the canonical RPC transaction plus advisory bytes;
   assess only after source, digest, linkage, freshness, and threshold checks.
5. Pause and verify target state.
6. Apply owner remediation while paused and reconcile its transaction.
7. Publish a new recovery advisory containing the remediation hash.
8. Wait for the positive 900-second cooldown, assess new recovery evidence,
   unpause, and verify target state.

An advisory alone cannot pause or recover a protocol. The protocol still
requires locked policy, authenticated evidence, GenLayer consensus, contract
execution, and target-state readback.

## Qualification gate

```text
ADVISORY_REPOSITORY_READY: YES
PUBLIC_RAW_FETCH_READY: YES
DIRECT_GENVM_FETCH_READY: YES
HOSTED_GENVM_FETCH_READY: YES
REAL_PREFIX_POLICY_READY: YES
REGISTER_CALLDATA_READY: YES
SAFE_TO_REGISTER_FINAL_POLICY: YES
```

The final advisory channel remains ready for append-only incident and recovery
publication against the final Studio Next ProtectedDemo.
