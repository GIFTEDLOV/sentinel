# Sentinel Foundation Starting State

Captured before implementing the Sentinel foundation on 2026-09-10.

## Repository

- Root: `C:\Users\DELL\Sentinel`
- One repository only; no nested repository was created.
- Branch: `master`
- Starting HEAD: `b908367 Build SENTINEL autonomous emergency defense MVP`
- The filesystem working tree contained only `.git`. The starting index referenced the old baseline paths, and Git reported those tracked paths as deleted in the working tree.
- No remote write, chain write, deployment, wallet transaction, or public deployment was performed.

## Toolchain

| Tool | Starting version/result |
| --- | --- |
| Node.js | `v24.14.0` |
| npm | `11.9.0` |
| pnpm | `11.0.9` |
| Python | `3.14.3` |
| GenLayer CLI package | `genlayer@0.40.0-rc.3` |
| `genlayer --version` | Blocked during CLI first-run setup by Windows `EPERM` creating/chmod-ing `C:\Users\DELL\.genlayer`; package metadata was readable. |
| genlayer-py | `0.19.0rc2` |
| genlayer-test / gltest | `0.30.0rc2` (`gltest` command is the pytest entry point) |
| genvm-linter | `0.11.0` |
| pyright | `1.1.410` |
| pytest | `8.4.1` |

The global CLI package declares a `genlayer-js` GitHub dependency at commit `facd9e9dc9a289d0110fe3b5b1a14a2938fe6e01`; there was no separate global `genlayer-js` installation. The project later pins the frontend dependency explicitly to `genlayer-js@2.0.0-rc.1`.

## Starting tracked paths reported by Git

The following paths were present in the starting index and reported deleted in the initial working tree: `.gitignore`, `contracts/protected_vault.py`, `contracts/sentinel.py`, `docs/ARCHITECTURE.md`, `docs/FRONTEND_CONTRACT.md`, `docs/TRUST_MODEL.md`, `package-lock.json`, `package.json`, `pytest.ini`, `requirements-dev.txt`, `tests/conftest.py`, `tests/test_direct.py`, and `tests/test_studio_integration.py`.

Those baseline contents were not imported or reconstructed as a product. The current repository is the new Sentinel foundation described by the current docs and source files.
