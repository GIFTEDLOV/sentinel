"""Pytest configuration for the GenLayer v0.6 RC direct-mode plugin."""

import os
import json
from pathlib import Path
from typing import Any, Callable, Optional

import pytest
from gltest.direct import VMContext, create_address, loader
from gltest.direct import wasi_mock
from gltest.direct import sdk_loader
from gltest.direct.sdk_compat import (
    import_address,
    import_calldata,
    sync_message_context,
)


# Keep the direct runner's writable extraction cache inside this workspace.
# The machine-level cache contains v0.6 bundles but its extracted trees are
# ACL-protected on this host; redirecting only the derived cache leaves the
# authoritative downloaded bundle untouched and exercises the same runner.
_workspace_runner_cache = Path.cwd() / ".cache" / "gltest-direct"
sdk_loader.CACHE_DIR = _workspace_runner_cache
sdk_loader.BUNDLE_CACHE_DIR = Path.home() / ".cache" / "gltest-direct" / "bundles-v2"
sdk_loader.TREE_CACHE_DIR = _workspace_runner_cache / "trees-v2"
os.environ["GENVM_PREBUILT_DIR"] = str(Path.cwd() / ".cache" / "gltest-prebuilt")


_original_handle_llm_request = wasi_mock._handle_llm_request


def _handle_llm_request_rc_json(vm: Any, data: Any) -> Any:
    """Keep JSON mock responses in the wire format expected by the RC SDK."""
    response = _original_handle_llm_request(vm, data)
    if data.get("response_format") == "json" and isinstance(response, dict):
        value = response.get("ok")
        if isinstance(value, (dict, list, bool, int, float)) or value is None:
            response["ok"] = json.dumps(value, separators=(",", ":"))
    return response


# genlayer-test 0.30.0rc2 parses JSON mocks one layer too early; normalize the
# mock boundary without changing production SDK or contract behavior.
wasi_mock._handle_llm_request = _handle_llm_request_rc_json


def _inject_message_without_windows_tempfile_bug(vm: VMContext) -> None:
    """Inject the current RC message through a pipe on Windows.

    The installed gltest loader encodes the right v0.6 message, but its
    tempfile is still the active fd 0 when it calls ``unlink``. Windows
    rejects that unlink. Keep the workaround local while using the loader's
    current SDK compatibility imports.
    """
    calldata = import_calldata()
    Address = import_address()

    def as_address(value: Any) -> Any:
        if isinstance(value, Address):
            return value
        return Address(value)

    message_data = {
        "contract_address": as_address(vm._contract_address),
        "sender_address": as_address(vm.sender),
        "origin_address": as_address(vm.origin),
        "stack": [],
        "value": vm._value,
        "datetime": vm._datetime,
        "is_init": False,
        "chain_id": vm._chain_id,
        "entry_kind": 0,
        "entry_data": b"",
        "entry_stage_data": None,
    }

    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, calldata.encode(message_data))
    finally:
        os.close(write_fd)

    vm._original_stdin_fd = os.dup(0)
    os.dup2(read_fd, 0)
    os.close(read_fd)


# The current loader's tempfile path is not Windows-safe after dup2.
loader._inject_message_to_fd0 = _inject_message_without_windows_tempfile_bug


def _refresh_gl_message_with_string_addresses(self: VMContext) -> None:
    """Convert readable fixture strings before syncing the RC message module."""
    try:
        Address = import_address()
        from genlayer.types import u256 as sdk_u256

        def as_address(value: Any) -> Any:
            if value is None or isinstance(value, Address):
                return value
            if isinstance(value, (bytes, str)):
                return Address(value)
            if hasattr(value, "as_bytes"):
                return Address(value.as_bytes)
            return value

        sync_message_context(
            sender_address=as_address(self.sender),
            origin_address=as_address(self.origin),
            value=sdk_u256(self._value),
            chain_id=sdk_u256(self._chain_id),
        )
        # The RC compatibility helper does not expose datetime as an argument,
        # but Sentinel's freshness and cooldown checks intentionally read the
        # transaction timestamp from genlayer.message. Keep warp() visible to
        # every direct-mode transaction.
        import genlayer.message as message

        message.datetime = self._datetime
        if isinstance(getattr(message, "raw", None), dict):
            message.raw["datetime"] = self._datetime
    except ImportError:
        pass


# sdk_compat does not coerce string senders; the tests intentionally expose
# hex strings, so normalize them at the current RC message boundary.
VMContext._refresh_gl_message = _refresh_gl_message_with_string_addresses


def _test_address(seed: str) -> str:
    """Expose readable hex while the refresh adapter supplies RC Address values."""
    return "0x" + bytes(create_address(seed)).hex()


@pytest.fixture
def direct_vm() -> VMContext:
    ctx = VMContext()
    ctx.sender = create_address("default_sender")
    with ctx.activate():
        yield ctx


@pytest.fixture
def direct_deploy(direct_vm: VMContext) -> Callable[..., Any]:
    def _deploy(
        contract_path: str,
        *args: Any,
        sdk_version: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        path = Path(contract_path)
        if not path.is_absolute() and not path.exists():
            path = Path.cwd() / contract_path
        # sdk_version=None lets gltest-direct resolve the runner from the
        # contract header and the active v0.6 RC environment.
        return loader.deploy_contract(path.resolve(), direct_vm, *args, sdk_version=sdk_version, **kwargs)

    return _deploy


@pytest.fixture
def direct_owner() -> Any:
    return _test_address("default_sender")


@pytest.fixture
def direct_alice() -> Any:
    return _test_address("alice")


@pytest.fixture
def direct_bob() -> Any:
    return _test_address("bob")
