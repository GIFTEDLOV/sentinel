# Sentinel Studio Proof Record

Status: **BLOCKED before deployable contract state**

Date: 2026-09-10

This record contains only operations deliberately broadcast to the official GenLayer Studio
Devnet. A finalized transaction with a contract address is not treated as a successful deployment
when `txExecutionResultName` is `FINISHED_WITH_ERROR`. No address below is a usable Sentinel or
ProtectedDemo deployment address.

## Environment

- Network: `studio-dev` / GenLayer Studio Devnet
- Chain ID: `61997`
- RPC: `https://studio-dev.genlayer.com/api`
- Consensus family: v0.6 RC preview
- CLI package: `genlayer 0.40.0-rc.3`
- JavaScript SDK: `genlayer-js 2.0.0-rc.1`
- Python SDK: `genlayer-py 0.19.0rc2`
- Development sender: `0xb1e3ea743df2b006b66751d57337c2bb10e23ecc`
- Initial validator count requested: `5`

## Deliberate deployment attempts

The required order was ProtectedDemo first, then Sentinel. ProtectedDemo attempts were made after
the ordered controller configuration source change and current RC header migration. All receipts
finalized, but execution failed and therefore no configuration or lifecycle transaction could
safely follow.

| Attempt | Transaction | Final status | Execution | Observed result | Receipt contract address | Usable? |
| --- | --- | --- | --- | --- | --- | --- |
| Early RC deployment | `0xe0c023c17c5179e591144fe6419131e3d138b0fdcb8fcbb3ecebd275f0b8f79c` | `FINALIZED` | `FINISHED_WITH_ERROR` | `out_of receipt message` | `0x76bABf112811Db5D1940e75F2b83fC54FaD370fb` | No |
| Full v0.6 fee profile | `0x059cfd49e535b863b5832d66a716b3e0228be1f7aee6ef806dcf582e75bf265c` | `FINALIZED` | `FINISHED_WITH_ERROR` | `out_of receipt message` | `0x2aF4722155e15032238D0266793522A2a8d9EE74` | No |
| Recommended budget | `0x6f7203c9af6ca1f5f5e939feabbf070be4c9fc7fef86858182d7373020db23bc` | `FINALIZED` | `FINISHED_WITH_ERROR` | `invalid_contract runner malformed` | `0xc862A205D9927dc0607d183f33DA6b3e31BC3Aac` | No |
| Padded recommended budget | `0x3823fad8198221fd36a722d5f6b9b5dfb75cb29ccc4967d4b24bb343ca38941a` | `FINALIZED` | `FINISHED_WITH_ERROR` | `invalid_contract runner malformed` | `0xa17517E3F55bDf452b17DAB51cEd2df59d346b9C` | No |

The final attempt used an execution budget of `153453600000000` and the complete v0.6 fee
distribution. Its receipt exposed actual validator records: three validators agreed with the
same execution error and two were idle after quorum. The transaction reached consensus, but the
contract runner did not produce successful state. Triggered child ids were empty.

## Required proof stages

| Stage | Observation |
| --- | --- |
| 1. ProtectedDemo deployment | Attempted; no successful deployment. |
| 2. Sentinel deployment | Not attempted after the target failed; no address exists. |
| 3. Sentinel authorization configuration | Not run. |
| 4. Protocol registration | Not run. |
| 5. Policy lock | Not run. |
| 6. Incident creation/evidence binding | Not run. |
| 7. Emergency assessment | Not run. |
| 8. `ACTIVE_INCIDENT` readback | Not observed. |
| 9. Pause request/child execution | Not run; no child message observed. |
| 10. Target paused readback/blocked operation | Not observed. |
| 11. Fresh recovery evidence/assessment | Not run. |
| 12. `SAFE_TO_RECOVER`, unpause, restored operation | Not observed. |
| 13. Negative fail-closed incident | Not run live; the local direct-mode suite covers fail-closed cases. |

## What was proven on the real network

1. The account could submit transactions to chain `61997`.
2. The official preview endpoint accepted the current v0.6 fee envelope.
3. The transactions reached `FINALIZED` status.
4. The current devnet exercised multiple validator records; this was not Direct Mode.
5. Consensus reached `MAJORITY_AGREE` on the deployment execution result.
6. Final execution still failed with `FINISHED_WITH_ERROR` and, after fee correction,
   `invalid_contract runner malformed`.
7. The frontend and contract workflow correctly stop at this boundary instead of treating the
   receipt address or consensus acceptance as a live deployment.

The read-only `gen_getContractSchemaForCode` endpoint was also queried for both current sources.
Both calls failed in the GenVM runner-load path with the same `invalid_contract runner malformed`
VM error. This independently characterizes the failure before any new deployment attempt and is
why no further write was broadcast.

## Blocker and safe continuation

The live blocker is the validator/runtime runner path for the current `py-genlayer:1zr6...`
artifact on this Studio Devnet. A read-only `gen_getContractSchemaForCode` query for both current
sources also reproduced the same runner-load error. The latest attempt reproduced the error after
using the network's
recommended padded fee profile, so increasing fees further or rebroadcasting the same hash is not
a safe remedy. The next proof must use a network/runtime combination confirmed by GenLayer to load
this current RC artifact, or a smallest documented RC migration with matching CLI, SDK, runner,
linter, and Studio versions.

Until then, the repository must retain empty deployment configuration and must not claim a live
pause, recovery, or protected protocol address.
