# Local GenLayer Runtime Runner Diagnostic

Date: 2026-09-10

## Scope

This diagnostic used the unchanged runner-isolation fixtures:

- `official_runner_test.py` — SHA-256 `5893FC991FE6F6382BE2D2EEF7E2A7ECC5B32A4C1F2A528F32A2A360D7F6D6D`
- `current_runner_test.py` — SHA-256 `FA6A97E702D23267FFEEA1D6DF886C60D9506F4377FF1D35CFD46ADE94829F51`

The required local GenLayer workflow is CLI-managed Local Studio at
`http://localhost:4000/api` with chain ID `61127`. The official tooling documentation
describes `genlayer init`, `genlayer up`, and `genlayer network set localnet` for this path.

## CLI selection

Installed CLI: `0.40.0-rc.3`.

The installed CLI source defines `localnetCompatibleVersion = "v0.65.0"` and exposes:

```text
--localnet-version <localnetVersion>  Select a specific localnet version
                                      (minimum: v0.65.0) (default: "v0.65.0")
```

The selected diagnostic value is therefore `v0.65.0`, the CLI's exact default/minimum.
No other RC-specific localnet version is present in this installed CLI.

## Host preflight

- Docker CLI: available, `29.4.3`.
- Docker daemon: not usable from this process; access to the `desktop-linux` engine named pipe is denied.
- WSL: enumeration denied (`E_ACCESSDENIED`).
- Ports 4000 and 8080: no listening GenLayer service observed.
- Existing GenLayer containers: could not be listed because the Docker daemon was unavailable.
- The resumed `docker version` and `docker info` calls returned `permission denied` for
  `npipe:////./pipe/dockerDesktopLinuxEngine` and no Docker Server section.

## Result

Localnet was not started. Consequently, neither fixture was submitted to a local GenVM and
there is no local RPC schema result, local GenVM version, validator count, or local failure log.
No local deployment or chain write was attempted.

This is a host Docker access blocker, not evidence that either runner loads or fails on matching
local GenVM. The next valid test requires granting the active process access to Docker Desktop
(or using another official Docker-capable host) and rerunning the exact
`gen_getContractSchemaForCode` comparison.
