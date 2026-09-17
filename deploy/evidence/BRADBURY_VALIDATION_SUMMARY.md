# Sentinel Bradbury validation summary

Network: `testnet-bradbury`  
Chain ID: `4221`  
RPC: `https://rpc-bradbury.genlayer.com`  
Runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

This file is updated only with direct RPC/CLI observations. A transaction is not accepted as a
successful deployment or lifecycle step until its same-hash receipt is `FINALIZED`, its execution
result is `FINISHED_WITH_RETURN`, and the resulting contract readback succeeds.

## Source and toolchain

- Sentinel SHA-256: `D5A3A1FC40466E8694BC6A1C1ED1D752CF65B9E43A294A64381B2141E44C45F3`
- ProtectedDemo SHA-256: `D2B0B1BF2F1E52F6183180B85CCFEE107EBC377CBC7D9AD4DE8507F0ABE8C00D`
- CLI: `genlayer 0.39.1`
- JS SDK: `genlayer-js 1.1.8`
- Tests: `genlayer-test 0.29.2`
- Linter: `genvm-linter 0.11.0`

## Deployment status

Freeze revision 2 is the current deployment candidate. The prior ProtectedDemo broadcast failed
execution because the runner-comment preamble contained extra text; its same-hash trace is recorded
separately. The revision-2 ProtectedDemo receipt finalized successfully and its deployed source
parity is recorded in [`protected-demo-finalized-receipt.json`](protected-demo-finalized-receipt.json).

| Contract | Transaction | Status | Execution | Address |
| --- | --- | --- | --- | --- |
| ProtectedDemo revision 2 | `0xd36b1bd5520e12275987930cb4a944cb30267351cbbc3998ac3287beccb4361a` | `FINALIZED` | `FINISHED_WITH_RETURN` / `AGREE` | `0x1409EB321C669647015AcD12eec737D4a104508a` |
| Sentinel | EVM submissions `0x2c519c72f1759270937d64401312447d352d291317bda021a04f65e6cd96a8cc`, `0xff7e98bf457f639bc8945b0f96aecdda6ed0eabd23c08d07451a362074be6a27`, `0x5418e895888d2b68f43a9c8a1b3e21ca552163b8e0355d64604b3789dadb9439` | all absent after same-hash reconciliation; no GenLayer tx id | not deployed | - |

## Live lifecycle

The positive incident, fail-closed negative case, pause consequence, recovery assessment, and
unpause consequence are intentionally blank until Sentinel is deployed successfully. Three normal
stable-CLI EVM submission attempts (the original historical attempt and two conditional fresh
attempts) produced no same-hash receipt, no confirmed nonce advancement, and no GenLayer
transaction identity or contract address. No live claim is inferred from browser state, a
provisional address, or an accepted transaction.

| Proof | Transaction(s) | Required readback | Result |
| --- | --- | --- | --- |
| ProtectedDemo normal process | not run | `total_processed` increments | not run |
| Positive incident | not run | `ACTIVE_INCIDENT` | not run |
| Emergency pause | not run | `paused == true`, `process` fails | not run |
| Negative fail-closed case | not run | not `ACTIVE_INCIDENT`, target active | not run |
| Recovery | not run | `SAFE_TO_RECOVER`, `paused == false`, `process` succeeds | not run |
