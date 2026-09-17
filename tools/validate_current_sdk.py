"""Reflect Sentinel schemas through the installed v0.6 RC SDK.

The installed genvm-linter semantic command still imports the removed
``genlayer.py`` namespace. This small read-only check exercises the current
SDK's schema reflection directly and is intentionally kept separate from the
contract source and from the direct-mode test adapter.
"""

import json
import sys
from pathlib import Path

from gltest.direct.vm import VMContext

ROOT = Path(__file__).parents[1]
SDK_ROOT = ROOT / ".cache" / "gltest-direct" / "extracted" / "local"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SDK_ROOT / "py-genlayer" / "1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh"))
sys.path.insert(0, str(SDK_ROOT / "py-lib-genlayer-std" / "10pqy9vk4a8w8pg25py83s23k3mjjy7dwpdqjvqggb9ms7ycipvh"))
def main() -> None:
    vm = VMContext()
    vm._sender = bytes(20)
    vm._origin = bytes(20)
    vm._contract_address = bytes(20)
    with vm.activate():
        from tests.conftest import _inject_message_without_windows_tempfile_bug

        _inject_message_without_windows_tempfile_bug(vm)
        if len(sys.argv) > 1 and sys.argv[1] == "protected_demo":
            from contracts.protected_demo import ProtectedDemo

            schema = ProtectedDemo.__get_schema__()
        else:
            from contracts.sentinel import Sentinel

            schema = Sentinel.__get_schema__()
        if isinstance(schema, str):
            print(schema)
        else:
            print(json.dumps(schema, default=str, sort_keys=True))


if __name__ == "__main__":
    main()
