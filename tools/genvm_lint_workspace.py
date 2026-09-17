"""Run the pinned genvm-linter with its cache rooted in this workspace."""

from pathlib import Path
import os
import sys

import genvm_linter.validate.artifacts as artifacts
import genvm_linter.stubs as stubs


workspace_cache = Path(__file__).resolve().parents[1] / ".cache" / "genvm-linter"
artifacts.CACHE_DIR = workspace_cache
stubs.CACHE_DIR = workspace_cache / "stubs"

from genvm_linter.cli import main  # noqa: E402


if os.environ.get("GENVM_LINT_USE_WORKSPACE_SDK"):
    # genvm-linter 0.11.0's rc5 index names the protobuf member with a
    # .zip suffix, while its extractor still appends .tar.  Strict typecheck
    # only needs the standard SDK path, so keep this workaround process-local.
    import genvm_linter.cli as cli  # noqa: E402

    _std_candidates = sorted(
        (workspace_cache / "extracted" / "v0.6.0-rc5.tar" / "py-lib-genlayer-std").iterdir()
    )
    _workspace_std = next(path for path in _std_candidates if path.is_dir() and (path / "genlayer").is_dir())
    cli.extract_sdk_paths = lambda _tarball, _deps: ([_workspace_std], [])


if __name__ == "__main__":
    main()
