# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Deliberately vulnerable toy target for the SENTINEL Phase 1 demo.

This contract has no token integration and must never be used with real funds.
The vulnerability is a controlled voucher replay in vulnerable_mode.
"""

import typing

from genlayer import Address, DynArray, TreeMap, gl, u256


MAX_ID_LENGTH = 96


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise gl.vm.UserError(message)


class ProtectedVault(gl.Contract):
    owner: Address
    sentinel_guardian: Address
    paused: bool
    pause_incident_id: str
    vulnerable_mode: bool
    total_demo_assets: u256
    vouchers: TreeMap[str, u256]
    voucher_ids: DynArray[str]
    consumed_vouchers: TreeMap[str, bool]

    def __init__(self, owner: Address, initial_demo_assets: int):
        _require(initial_demo_assets > 0, "initial assets must be positive")
        self.owner = owner
        # Deployment starts with an unusable placeholder. The owner must
        # explicitly configure this to the deployed Sentinel address.
        self.sentinel_guardian = Address(b"\x00" * 20)
        self.paused = False
        self.pause_incident_id = ""
        self.vulnerable_mode = True
        self.total_demo_assets = u256(initial_demo_assets)

    @gl.public.write
    def configure_sentinel_guardian(self, guardian: Address) -> None:
        """Configure the only address allowed to send guardian commands."""
        _require(gl.message.sender_address == self.owner, "only owner")
        _require(guardian != self.owner, "guardian must differ from owner")
        self.sentinel_guardian = guardian

    @gl.public.write
    def create_voucher(self, voucher_id: str, amount: int) -> None:
        _require(gl.message.sender_address == self.owner, "only owner")
        _require(not self.paused, "vault paused")
        _require(1 <= len(voucher_id) <= MAX_ID_LENGTH, "invalid voucher id")
        _require(amount > 0, "amount must be positive")
        _require(self.vouchers.get(voucher_id, 0) == 0, "voucher already exists")
        _require(amount <= self.total_demo_assets, "amount exceeds demo assets")

        self.vouchers[voucher_id] = u256(amount)
        self.voucher_ids.append(voucher_id)
        self.consumed_vouchers[voucher_id] = False

    @gl.public.write
    def redeem_voucher(self, voucher_id: str) -> None:
        _require(not self.paused, "vault paused")
        _require(1 <= len(voucher_id) <= MAX_ID_LENGTH, "invalid voucher id")
        amount = self.vouchers.get(voucher_id, 0)
        _require(amount > 0, "unknown voucher")

        # The deliberate vulnerability: while vulnerable_mode is true, the
        # voucher is never marked consumed, so an identical replay succeeds.
        if not self.vulnerable_mode:
            _require(not self.consumed_vouchers.get(voucher_id, False), "voucher consumed")
            self.consumed_vouchers[voucher_id] = True

        _require(amount <= self.total_demo_assets, "insufficient demo assets")
        self.total_demo_assets -= amount

    @gl.public.write
    def sentinel_pause(self, incident_id: str) -> None:
        _require(gl.message.sender_address == self.sentinel_guardian, "only Sentinel guardian")
        _require(1 <= len(incident_id) <= MAX_ID_LENGTH, "invalid incident id")

        # Finalized IC messages can be retried or duplicated. Pausing is
        # idempotent and the first finalized incident remains recorded.
        if self.paused:
            return
        self.paused = True
        self.pause_incident_id = incident_id

    @gl.public.write
    def sentinel_resume(self, incident_id: str) -> None:
        _require(gl.message.sender_address == self.sentinel_guardian, "only Sentinel guardian")
        _require(1 <= len(incident_id) <= MAX_ID_LENGTH, "invalid incident id")
        if not self.paused:
            return
        _require(incident_id == self.pause_incident_id, "incident mismatch")
        self.paused = False
        self.pause_incident_id = ""

    @gl.public.write
    def apply_demo_patch(self) -> None:
        _require(gl.message.sender_address == self.owner, "only owner")
        # Remediation is allowed while paused so the toy target can be safely
        # patched before any future recovery adjudication.
        self.vulnerable_mode = False

    @gl.public.view
    def get_status(self) -> dict[str, typing.Any]:
        return {
            "owner": self.owner.as_hex,
            "sentinel_guardian": self.sentinel_guardian.as_hex,
            "paused": self.paused,
            "pause_incident_id": self.pause_incident_id,
            "vulnerable_mode": self.vulnerable_mode,
            "total_demo_assets": self.total_demo_assets,
        }

    @gl.public.view
    def get_voucher(self, voucher_id: str) -> dict[str, typing.Any]:
        amount = self.vouchers.get(voucher_id, 0)
        return {
            "voucher_id": voucher_id,
            "exists": amount > 0,
            "amount": amount,
            "consumed": self.consumed_vouchers.get(voucher_id, False),
        }

    @gl.public.view
    def get_total_demo_assets(self) -> int:
        return self.total_demo_assets

    @gl.public.view
    def is_paused(self) -> bool:
        return self.paused

    @gl.public.view
    def is_vulnerable(self) -> bool:
        return self.vulnerable_mode

    @gl.public.view
    def contract_info(self) -> str:
        return "ProtectedVault:toy-vulnerable-replay-v1"
