# Official GenLayer documentation audit

Audit date: 2026-09-11

## Release decision

Sentinel targets the official stable Bradbury Testnet, not Studio-dev or an RC runner:

| Component | Selected release / environment |
| --- | --- |
| Network | `testnet-bradbury` |
| Chain ID | `4221` |
| RPC | `https://rpc-bradbury.genlayer.com` |
| Contract runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| CLI | `genlayer 0.39.1` |
| JavaScript SDK | `genlayer-js 1.1.8` |
| Python test framework | `genlayer-test 0.29.2` |
| Python SDK dependency | `genlayer-py 0.16.3` |
| Linter | `genvm-linter 0.11.0` |

The chain id, RPC, and canonical system contract addresses come from the CLI/SDK Bradbury network
definition. They are not manually invented in Sentinel.

Sources: [GenLayer networks](https://docs.genlayer.com/developers/networks),
[network configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration),
[CLI reference](https://docs.genlayer.com/api-references/genlayer-cli),
[CLI deployment](https://docs.genlayer.com/developers/intelligent-contracts/deploying/cli-deployment),
[interacting with Intelligent Contracts](https://docs.genlayer.com/developers/intelligent-contracts/features/interacting-with-intelligent-contracts),
and [Direct Mode testing](https://docs.genlayer.com/api-references/genlayer-test/direct).

## Implementation decisions

The contracts use `from genlayer import *`, `gl.Contract`, `@allow_storage`,
`@gl.public.write`, `@gl.public.view`, `gl.vm.UserError`, deterministic transaction time from
`gl.message_raw["datetime"]`, bounded `gl.nondet.web.get`, and the stable
`gl.vm.run_nondet_unsafe` equivalence gate. The leader performs one bounded judgment; the validator
independently retrieves/authenticates the same evidence and compares verdict, criteria, objective
fields, and corroboration counts. Free-form prose is not the equality condition.

The live evidence model is intentionally bounded to three types: `TRANSACTION`, `PROTECTED_STATE`,
and `SECURITY_ADVISORY`. HTTP failures, oversized or malformed bodies, digest/target/incident
mismatches, stale evidence, missing corroboration, and disagreement all fail closed to
`INCONCLUSIVE` and cannot be overridden by model output.

ProtectedDemo grants exactly two response methods to the configured Sentinel address. Its normal
`process` write is blocked while paused and works again after a separately authorized unpause.

## Local gate result

The stable Direct Mode suite and both contract `check`, strict `typecheck`, and `schema` commands
pass. The linter invocation used for the gate pins its available stable GenVM artifact explicitly;
the contract source itself remains pinned to the Bradbury `1jb45...` runner above.

## Source of truth

Deployment claims are controlled by the finalized transaction receipt, execution result, deployed
address, deployed source parity, and direct state readback recorded under [`deploy/evidence/`](../deploy/evidence/).
The browser is only a read/write client and is never treated as evidence of contract state.
