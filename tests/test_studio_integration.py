"""Smallest real Studio proof for finalized IC→IC pause delivery.

This is intentionally skipped unless a caller explicitly provides a Studio
RPC. The Phase 1 environment does not start Studio or contact a network.
"""

import hashlib
import json
import os

import pytest


@pytest.mark.integration
def test_finalized_sentinel_message_reaches_protected_vault():
    rpc_url = os.environ.get("GENLAYER_STUDIO_RPC")
    if not rpc_url:
        pytest.skip("Studio integration requires GENLAYER_STUDIO_RPC; Direct Mode cannot deliver IC→IC messages")

    from gltest import get_contract_factory, get_default_account
    from gltest.assertions import tx_execution_succeeded

    account = get_default_account()
    vault_factory = get_contract_factory(contract_file_path="contracts/protected_vault.py")
    sentinel_factory = get_contract_factory(contract_file_path="contracts/sentinel.py")

    # The gltest config selects the supplied Studio RPC. Every action waits
    # for the parent to be finalized and verifies execution success.
    vault = vault_factory.deploy(
        args=[account.address, 1000],
        account=account,
        wait_until="finalized",
        wait_triggered_transactions=False,
    )
    sentinel = sentinel_factory.deploy(
        args=[account.address],
        account=account,
        wait_until="finalized",
    )

    configure_receipt = vault.configure_sentinel_guardian(args=[sentinel.address]).transact(
        wait_until="finalized"
    )
    assert tx_execution_succeeded(configure_receipt)

    policy = (
        "ACTIVE_CRITICAL_EXPLOIT means reliable evidence demonstrates an exploit "
        "currently actionable against the registered target and capable of causing "
        "unauthorized transfer or loss of protected assets, unauthorized privileged "
        "control, or material corruption of security-critical state."
    )
    register_receipt = sentinel.register_protocol(
        args=[
            "toy-vault",
            "ProtectedVault demo",
            vault.address,
            account.address,
            policy,
            "https://example.com/security/policy",
            "https://example.com",
        ]
    ).transact(wait_until="finalized")
    assert tx_execution_succeeded(register_receipt)

    body = "A replay of voucher-1 reduced the toy accounting balance twice."
    report_receipt = sentinel.report_incident(
        args=[
            "incident-1",
            "toy-vault",
            "The toy vault voucher can be replayed while active.",
            "https://example.com/security/incidents/vault-replay",
            "sha256:" + hashlib.sha256(body.encode()).hexdigest(),
            "ADMITTED",
        ]
    ).transact(wait_until="finalized")
    assert tx_execution_succeeded(report_receipt)

    adjudicate_receipt = sentinel.adjudicate_incident(
        args=["incident-1"],
        wait_until="finalized",
        wait_triggered_transactions=True,
        wait_triggered_transactions_status="finalized",
        transaction_context={
            "validators": [
                {
                    "provider": "openai",
                    "model": "gpt-4o",
                    "config": {"temperature": 0, "max_tokens": 200},
                    "plugin": "openai-compatible",
                    "plugin_config": {"api_key_env_var": "OPENAIKEY"},
                }
            ]
        },
    ).transact(wait_until="finalized", wait_triggered_transactions=True, wait_triggered_transactions_status="finalized")
    assert tx_execution_succeeded(adjudicate_receipt)

    incident = sentinel.get_incident(args=["incident-1"]).call()
    assert incident["verdict"] == "ACTIVE_CRITICAL_EXPLOIT"
    status = vault.get_status().call()
    assert status["paused"] is True
    assert status["pause_incident_id"] == "incident-1"

