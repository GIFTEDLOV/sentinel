from pathlib import Path

from test_foundation import (
    SENTINEL_PATH,
    _body,
    _digest,
    _mock_qualifying_evidence,
    _setup_sentinel,
)


def test_verifier_outage_blocks_binding_and_assessment_without_semantic_call(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, target = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice, minimum_sources=1
    )
    sentinel.open_incident("incident-outage", "demo")
    body = _body(protocol_id="demo", target_address=str(target), incident_id="incident-outage")
    direct_vm.mock_web(r"explorer\.example/tx/outage", {"status": 503, "body": "offline"})
    sentinel.bind_evidence(
        "incident-outage", "outage-evidence", "EMERGENCY", "TRANSACTION",
        "https://explorer.example/tx/outage", "unauthorized-drain", _digest(body),
        "0x" + "1" * 64, 123,
    )
    evidence = sentinel.get_evidence("outage-evidence")
    assert evidence["authentication_state"] == "BLOCKED"
    assert evidence["authentication_block_code"] == "SOURCE_UNAVAILABLE"
    before = len(direct_vm._captured_validators)
    sentinel.assess_incident("incident-outage")
    assert len(direct_vm._captured_validators) == before
    result = sentinel.get_incident("incident-outage")
    assert result["incident_authentication_state"] == "BLOCKED"
    assert result["state"] == "ASSESSING"
    assert result["incident_verdict"] == "INCONCLUSIVE"


def test_verifier_timeout_is_blocked_and_never_becomes_approval(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, target = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice, minimum_sources=1
    )
    incident_id = "incident-timeout"
    sentinel.open_incident(incident_id, "demo")
    body = _body(protocol_id="demo", target_address=str(target), incident_id=incident_id)
    direct_vm.mock_web(r"explorer\.example/tx/timeout", {"status": 504, "body": "timeout"})
    sentinel.bind_evidence(incident_id, "timeout-evidence", "EMERGENCY", "TRANSACTION", "https://explorer.example/tx/timeout", "unauthorized-drain", _digest(body), "0x" + "1" * 64, 123)
    assert sentinel.get_evidence("timeout-evidence")["authentication_block_code"] == "VERIFIER_TIMEOUT"
    before = len(direct_vm._captured_validators)
    sentinel.assess_incident(incident_id)
    assert len(direct_vm._captured_validators) == before
    assert sentinel.get_incident(incident_id)["state"] == "ASSESSING"


def test_owner_retry_reauthenticates_but_never_overrides_blocked_state(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    sentinel, target = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice, minimum_sources=1
    )
    incident_id = "incident-owner-retry"
    sentinel.open_incident(incident_id, "demo")
    body = _body(protocol_id="demo", target_address=str(target), incident_id=incident_id)
    url = "https://explorer.example/tx/retry"
    direct_vm.mock_web(r"explorer\.example/tx/retry", {"status": 503, "body": "offline"})
    sentinel.bind_evidence(incident_id, "retry-evidence", "EMERGENCY", "TRANSACTION", url, "unauthorized-drain", _digest(body), "0x" + "1" * 64, 123)
    before = sentinel.get_incident(incident_id)
    assert before["incident_authentication_state"] == "BLOCKED"

    with direct_vm.prank(direct_bob), direct_vm.expect_revert("protected protocol owner"):
        sentinel.retry_authentication(incident_id)
    assert sentinel.get_incident(incident_id)["incident_authentication_state"] == "BLOCKED"

    with direct_vm.prank(direct_owner):
        sentinel.retry_authentication(incident_id)
    assert sentinel.get_incident(incident_id)["incident_authentication_state"] == "BLOCKED"

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"explorer\.example/tx/retry", {"status": 200, "body": body})
    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"verified"}',
    )
    with direct_vm.prank(direct_owner):
        sentinel.retry_authentication(incident_id)
    assert sentinel.get_incident(incident_id)["incident_authentication_state"] == "VERIFIED"
    sentinel.assess_incident(incident_id)
    assert sentinel.get_incident(incident_id)["state"] == "ACTIVE_INCIDENT"


def test_decision_input_record_is_deterministic_and_context_bound(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, target = _setup_sentinel(direct_vm, direct_deploy, direct_owner, direct_alice)
    incident_id = "incident-decision-record"
    sentinel.open_incident(incident_id, "demo")
    first, second = _mock_qualifying_evidence(direct_vm, target, incident_id=incident_id)
    sentinel.bind_evidence(incident_id, "decision-one", "EMERGENCY", "TRANSACTION", "https://explorer.example/tx/one", "unauthorized-drain", _digest(first), "0x" + "1" * 64, 123)
    sentinel.bind_evidence(incident_id, "decision-two", "EMERGENCY", "SECURITY_ADVISORY", "https://advisory.example/incident/one", "unauthorized-drain", _digest(second), "0x" + "1" * 64, 123)
    sentinel.assess_incident(incident_id)
    incident = sentinel.get_incident(incident_id)
    assert incident["incident_assessment_id"]
    record = sentinel.get_decision_input(incident["incident_assessment_id"])
    assert record["question_version"] == "INCIDENT_ASSESSMENT_V1"
    assert record["authentication_state"] == "VERIFIED"
    assert record["evidence_ids_csv"] == "decision-one,decision-two"
    assert record["resulting_state"] == "ACTIVE_INCIDENT"
    context = sentinel._build_assessment_context(sentinel.incidents[incident_id], sentinel.protocols["demo"], "EMERGENCY", incident_id)
    expected = sentinel._decision_input_hash(context, "INCIDENT_ASSESSMENT_V1")
    assert record["decision_input_hash"] == expected


def test_no_manual_authentication_or_verdict_bypass_exists():
    source = Path(SENTINEL_PATH).read_text(encoding="utf-8")
    for forbidden in ("force_verify", "force_approve", "manual_recover", "admin_override_verdict"):
        assert forbidden not in source
