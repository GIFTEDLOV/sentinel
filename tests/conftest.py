"""Compatibility bridge for genlayer-test 0.30.0rc2 + v0.6 RC3 runner.

The RC2 Direct Mode helper still imports the older ``genlayer.types`` and
``genlayer.message`` names. The v0.6 runner exports these through
``genlayer.py.types`` and ``genlayer.gl.message``. This shim is test-only and
does not change contract code or network behavior.
"""

from __future__ import annotations

import os
import hashlib
import sys
import tempfile
from pathlib import Path

from gltest.direct import loader, pytest_plugin, sdk_compat, vm
from gltest.direct.sdk_loader import setup_sdk_paths


# Load the pinned v0.6 runner paths early so Direct Mode fixtures create the
# v0.6 Address class instead of the RC2 fallback bytes values.
setup_sdk_paths(Path("contracts/protected_vault.py"))
from genlayer.py import types as _V06_TYPES


def _import_calldata():
    from genlayer.py import calldata

    return calldata


def _import_types():
    return _V06_TYPES


def _import_address():
    return _import_types().Address


def _import_address_u256():
    types = _import_types()
    return types.Address, types.u256


def _import_lazy():
    return _import_types().Lazy


def _create_address(seed: str):
    return _import_address()(hashlib.sha256(seed.encode()).digest()[:20])


def _sync_message_context(
    *,
    contract_address=sdk_compat._UNSET,
    sender_address=sdk_compat._UNSET,
    origin_address=sdk_compat._UNSET,
    value=sdk_compat._UNSET,
    chain_id=sdk_compat._UNSET,
):
    import genlayer.gl as gl_module

    message_address = gl_module.Address

    def coerce_address(value):
        if isinstance(value, message_address):
            return value
        if hasattr(value, "as_bytes"):
            return message_address(value.as_bytes)
        if isinstance(value, (bytes, bytearray)):
            return message_address(bytes(value))
        return value

    updates = {
        "contract_address": contract_address,
        "sender_address": sender_address,
        "origin_address": origin_address,
        "value": value,
        "chain_id": chain_id,
    }
    raw = dict(getattr(gl_module, "message_raw", {}))
    for name, next_value in updates.items():
        if next_value is sdk_compat._UNSET:
            continue
        next_value = coerce_address(next_value)
        raw[name] = next_value
    gl_module.message_raw = raw
    gl_module.message = gl_module.MessageType(
        contract_address=raw["contract_address"],
        sender_address=raw["sender_address"],
        origin_address=raw["origin_address"],
        value=_import_types().u256(raw["value"]),
        chain_id=_import_types().u256(raw["chain_id"]),
    )


def _refresh_gl_message(direct_vm):
    """Refresh v0.6 ``genlayer.gl.message`` after a Direct Mode prank."""
    if "genlayer.gl" not in sys.modules:
        return
    sender = direct_vm.sender
    origin = direct_vm.origin
    if hasattr(sender, "as_bytes"):
        sender = sender.as_bytes
    if hasattr(origin, "as_bytes"):
        origin = origin.as_bytes
    _sync_message_context(
        sender_address=sender,
        origin_address=origin,
        value=direct_vm._value,
        chain_id=direct_vm._chain_id,
    )


def _inject_message_to_fd0(direct_vm):
    calldata = _import_calldata()
    # Use the Address class owned by the exact calldata module that performs
    # encoding.  The RC2 loader can leave two v0.6 SDK module trees imported
    # after its compatibility setup; using this class avoids an otherwise
    # opaque cross-tree isinstance failure.
    address = calldata.Address

    def coerce(value):
        if isinstance(value, address):
            return value
        if hasattr(value, "as_bytes"):
            return address(value.as_bytes)
        if isinstance(value, (bytes, bytearray)):
            return address(bytes(value))
        return address(value)

    sender = direct_vm.sender
    sender = coerce(sender)
    contract_address = coerce(direct_vm._contract_address)
    origin = coerce(direct_vm.origin)
    encoded = calldata.encode(
        {
            "contract_address": contract_address,
            "sender_address": sender,
            "origin_address": origin,
            "stack": [],
            "value": direct_vm._value,
            "datetime": direct_vm._datetime,
            "is_init": False,
            "chain_id": direct_vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }
    )
    fd, path = tempfile.mkstemp()
    try:
        os.write(fd, encoded)
        os.lseek(fd, 0, os.SEEK_SET)
        direct_vm._original_stdin_fd = os.dup(0)
        os.dup2(fd, 0)
    finally:
        os.close(fd)
        # Windows keeps fd 0 open after dup2, so unlinking here raises
        # sharing-violation. The small temp file is reclaimed by the OS temp
        # cleanup; the production loader has the same fd-lifetime constraint.


def _allocate_contract_current(contract_cls, direct_vm, *args, **kwargs):
    """Allocate storage using the v0.6 ``genlayer.py.storage`` layout."""
    from genlayer.py.storage import ROOT_SLOT_ID
    from genlayer.py.storage._internal.generate import (
        ORIGINAL_INIT_ATTR,
        _storage_build,
    )

    type_desc = _storage_build(contract_cls, {})
    slot = direct_vm._storage.get_store_slot(ROOT_SLOT_ID)
    instance = type_desc.get(slot, 0)
    init = getattr(type_desc, "cls", None)
    if init is None:
        init = getattr(contract_cls, "__init__", None)
    else:
        init = getattr(init, "__init__", None)
    if init is not None:
        if hasattr(init, ORIGINAL_INIT_ATTR):
            init = getattr(init, ORIGINAL_INIT_ATTR)
        init(instance, *args, **kwargs)
    return instance


_original_roundtrip_args = loader._calldata_roundtrip_args
_original_patch_run_nondet = loader._patch_run_nondet_for_direct_mode


def _roundtrip_args_with_current_addresses(args, kwargs):
    """Normalize stale v0.6 Address instances before RC2 roundtrips."""
    address = _import_calldata().Address

    def normalize(value):
        if isinstance(value, address):
            return value
        if hasattr(value, "as_bytes"):
            return address(value.as_bytes)
        if isinstance(value, tuple):
            return tuple(normalize(item) for item in value)
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, dict):
            return {normalize(key): normalize(item) for key, item in value.items()}
        return value

    return _original_roundtrip_args(normalize(args), normalize(kwargs))


def _patch_run_nondet_for_v06_direct_mode():
    """Extend RC2 Direct Mode's patch to the v0.6 unsafe API."""
    _original_patch_run_nondet()
    import genlayer.gl.vm as gl_vm

    if getattr(gl_vm, "_v06_direct_mode_patched", False):
        return

    from gltest.direct import wasi_mock
    wasi_mock.import_calldata = _import_calldata
    from genlayer.py.types import Lazy

    def direct_run_nondet_unsafe(leader_fn, validator_fn, /, **kwargs):
        current_vm = wasi_mock.get_vm()
        current_vm._in_nondet = True
        try:
            result = leader_fn()
        finally:
            current_vm._in_nondet = False
        current_vm._captured_validators.append((result, leader_fn, validator_fn))
        return result

    def lazy_run_nondet_unsafe(leader_fn, validator_fn, /, **kwargs):
        return Lazy(lambda: direct_run_nondet_unsafe(leader_fn, validator_fn, **kwargs))

    direct_run_nondet_unsafe.lazy = lazy_run_nondet_unsafe
    gl_vm.run_nondet_unsafe = direct_run_nondet_unsafe
    gl_vm._v06_direct_mode_patched = True


def _run_validator_v06(direct_vm, *, leader_result=None, leader_error=None, index=-1):
    """Run a captured validator against v0.6 ``Return``/``UserError`` types."""
    if not direct_vm._captured_validators:
        raise RuntimeError("No validator captured")
    stored_result, _leader_fn, validator_fn = direct_vm._captured_validators[index]
    import genlayer.gl.vm as gl_vm
    if leader_error is not None:
        wrapped = gl_vm.UserError(str(leader_error))
    elif leader_result is not None:
        wrapped = gl_vm.Return(calldata=leader_result)
    else:
        wrapped = gl_vm.Return(calldata=stored_result)
    return validator_fn(wrapped)


# Patch every module-level reference imported by the RC2 test runner.
for module in (sdk_compat, loader, vm):
    module.import_calldata = _import_calldata
    module.import_types = _import_types
    module.import_address = _import_address
    module.import_address_u256 = _import_address_u256
    module.import_lazy = _import_lazy
    module.sync_message_context = _sync_message_context
loader._inject_message_to_fd0 = _inject_message_to_fd0
loader._allocate_contract = _allocate_contract_current
loader._calldata_roundtrip_args = _roundtrip_args_with_current_addresses
loader._patch_run_nondet_for_direct_mode = _patch_run_nondet_for_v06_direct_mode
loader.create_address = _create_address
pytest_plugin.create_address = _create_address
vm.VMContext._refresh_gl_message = _refresh_gl_message
vm.VMContext.run_validator = _run_validator_v06
