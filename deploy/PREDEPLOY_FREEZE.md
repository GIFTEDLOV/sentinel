# Sentinel Bradbury predeploy freeze

This is freeze revision 2, issued after a Bradbury runtime compatibility error in the prior
candidate was isolated to the runner-comment preamble. The stable Bradbury contract gates pass.

- Freeze timestamp: `2026-09-11T01:31:29.5688371+01:00`
- Network: `testnet-bradbury`
- Chain ID: `4221`
- RPC: `https://rpc-bradbury.genlayer.com`
- CLI: `genlayer 0.39.1`
- Python test framework: `genlayer-test 0.29.2`
- Python runtime dependency: `genlayer-py 0.16.3`
- Contract linter: `genvm-linter 0.11.0`
- Contract runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

## Frozen source hashes

| Source | SHA-256 |
| --- | --- |
| `contracts/sentinel.py` | `D5A3A1FC40466E8694BC6A1C1ED1D752CF65B9E43A294A64381B2141E44C45F3` |
| `contracts/protected_demo.py` | `D2B0B1BF2F1E52F6183180B85CCFEE107EBC377CBC7D9AD4DE8507F0ABE8C00D` |

## Public contract surface

Sentinel writes: `register_protected_protocol`, `update_emergency_policy`,
`lock_emergency_policy`, `open_incident`, `bind_evidence`, `assess_incident`,
`execute_pause`, `confirm_pause`, `begin_recovery`, `assess_recovery`,
`execute_unpause`, `confirm_recovered`.

Sentinel views: `get_protocol`, `get_incident`, `get_evidence`, `get_state`.

ProtectedDemo writes: `process`, `configure_sentinel`, `emergency_pause`,
`emergency_unpause`.

ProtectedDemo views: `get_owner`, `is_paused`, `get_authorized_sentinel`,
`is_controller_configured`, `get_total_processed`, `get_pause_counters`.

After this freeze, contract source changes require a complete rerun of the local gates,
new SHA-256 values, and a new freeze record.
