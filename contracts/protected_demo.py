# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import genlayer as gl
import typing

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnnecessaryIsInstance=false, reportCallIssue=false


class ProtectedDemo(gl.contract.Contract):
    """Small opt-in target used to prove Sentinel's response consequence."""

    owner: gl.Address
    authorized_sentinel: gl.Address
    controller_configured: bool
    paused: bool
    total_processed: gl.u256
    pause_count: gl.u32
    unpause_count: gl.u32
    # Demo accounting unit: one treasury unit is an abstract protocol unit,
    # not a native token or DeFi balance.
    treasury_balance: gl.u256
    total_outflow: gl.u256
    last_outflow_actor: gl.Address
    last_outflow_recipient: gl.Address
    last_outflow_amount: gl.u256
    remediated: bool

    def __init__(self, authorized_sentinel: gl.Address):
        self.owner = gl.message.sender_address
        self.authorized_sentinel = self._as_address(authorized_sentinel)
        # The ordered deployment deploys the target before Sentinel exists.
        # Keep the controller explicitly disabled until the owner performs the
        # one-time configuration write.  Avoid runtime string conversion of an
        # Address value in the constructor.
        self.controller_configured = False
        self.paused = False
        self.total_processed = gl.u256(0)
        self.pause_count = gl.u32(0)
        self.unpause_count = gl.u32(0)
        self.treasury_balance = gl.u256(1000)
        self.total_outflow = gl.u256(0)
        self.last_outflow_actor = self.owner
        self.last_outflow_recipient = self.owner
        self.last_outflow_amount = gl.u256(0)
        self.remediated = False

    def _require_sentinel(self) -> None:
        if not self.controller_configured:
            raise gl.vm.UserError("Sentinel controller is not configured")
        if gl.message.sender_address != self.authorized_sentinel:
            raise gl.vm.UserError("Only the configured Sentinel may change pause state")

    def _as_address(self, value: typing.Any) -> gl.Address:
        if isinstance(value, gl.Address):
            return value
        return gl.Address(value)

    @gl.public.view
    def get_owner(self) -> gl.Address:
        return self.owner

    @gl.public.view
    def is_paused(self) -> bool:
        return self.paused

    @gl.public.view
    def get_authorized_sentinel(self) -> gl.Address:
        return self.authorized_sentinel

    @gl.public.view
    def is_controller_configured(self) -> bool:
        return self.controller_configured

    @gl.public.view
    def get_total_processed(self) -> gl.u256:
        return self.total_processed

    @gl.public.view
    def get_pause_counters(self) -> dict[str, gl.u32]:
        return {
            "pause_count": self.pause_count,
            "unpause_count": self.unpause_count,
        }

    @gl.public.view
    def get_treasury_state(self) -> dict[str, typing.Any]:
        return {
            "treasury_balance": self.treasury_balance,
            "total_outflow": self.total_outflow,
            "remediated": self.remediated,
        }

    @gl.public.view
    def get_last_outflow(self) -> dict[str, typing.Any]:
        return {
            "actor": self.last_outflow_actor,
            "recipient": self.last_outflow_recipient,
            "amount": self.last_outflow_amount,
        }

    @gl.public.view
    def is_remediated(self) -> bool:
        return self.remediated

    @gl.public.write
    def process(self, amount: gl.u256) -> None:
        if self.paused:
            raise gl.vm.UserError("Protected protocol is paused")
        self.total_processed += amount

    @gl.public.write
    def execute_outflow(self, recipient: gl.Address, amount: gl.u256) -> None:
        if self.paused:
            raise gl.vm.UserError("Protected protocol is paused")
        if amount == gl.u256(0):
            raise gl.vm.UserError("Outflow amount must be positive")
        if amount > self.treasury_balance:
            raise gl.vm.UserError("Outflow exceeds treasury balance")
        if self.remediated and gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Outflow capability has been remediated")
        self.treasury_balance -= amount
        self.total_outflow += amount
        self.last_outflow_actor = gl.message.sender_address
        self.last_outflow_recipient = self._as_address(recipient)
        self.last_outflow_amount = amount

    @gl.public.write
    def apply_remediation(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Only the protocol owner may apply remediation")
        # Idempotent by design so a retry of the owner-only remediation is safe.
        self.remediated = True

    @gl.public.write
    def configure_sentinel(self, sentinel: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Only the protected protocol owner may configure Sentinel")
        if self.controller_configured:
            raise gl.vm.UserError("Sentinel controller is already configured")
        self.authorized_sentinel = self._as_address(sentinel)
        self.controller_configured = True

    @gl.public.write
    def emergency_pause(self) -> None:
        self._require_sentinel()
        if not self.paused:
            self.paused = True
            self.pause_count += gl.u32(1)

    @gl.public.write
    def emergency_unpause(self) -> None:
        self._require_sentinel()
        if self.paused:
            self.paused = False
            self.unpause_count += gl.u32(1)


