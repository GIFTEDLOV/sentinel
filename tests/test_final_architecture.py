import hashlib
import json
from pathlib import Path

import pytest

from test_foundation import (
    _bind,
    _body,
    _digest,
    _mock_qualifying_evidence,
    _setup_sentinel,
)


ROOT = Path(__file__).parents[1]
SENTINEL_PATH = str(ROOT / "contracts" / "sentinel.py")
PROTECTED_DEMO_PATH = str(ROOT / "contracts" / "protected_demo.py")
TX_HASH = "0x" + "1" * 64
RPC_URL = "https://studio-next.genlayer.com/api"
RPC_HOSTS = "studio-next.genlayer.com,explorer.example,advisory.example"
RPC_PREFIXES = "studio-next.genlayer.com|/api;explorer.example|/;advisory.example|/advisories/"
OBSERVED_AT = 1704067200


def _facts(sender, target, *, input_data="0x1234", timestamp=OBSERVED_AT):
    return {
        "hash": TX_HASH,
        "sender": str(sender).lower(),
        "origin": str(sender).lower(),
        "target": str(target).lower(),
        "input": input_data,
        "status": "FINALIZED",
        "execution": "FINISHED_WITH_RETURN",
        "consensus": "MAJORITY_AGREE",
        "event_timestamp": timestamp,
    }


def _transaction_digest(facts):
    return hashlib.sha256(
        json.dumps(facts, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _setup_final_sentinel(
    direct_vm,
    direct_deploy,
    direct_alice,
    *,
    minimum_sources=2,
    max_evidence_age_seconds=86400,
):
    direct_vm.warp("2024-01-01T00:00:00Z")
    sentinel = direct_deploy(SENTINEL_PATH)
    sentinel.register_protected_protocol(
        "demo",
        direct_alice,
        "unauthorized-drain",
        RPC_HOSTS,
        RPC_PREFIXES,
        RPC_URL,
        minimum_sources,
        max_evidence_age_seconds,
        900,
    )
    sentinel.lock_emergency_policy("demo")
    return sentinel


def _mock_rpc(direct_vm, sender, target, *, input_data="0x1234", timestamp=OBSERVED_AT):
    facts = _facts(sender, target, input_data=input_data, timestamp=timestamp)
    response = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "hash": TX_HASH,
            "sender": str(sender),
            "recipient": str(target),
            "data": {"calldata": input_data},
            "status": "FINALIZED",
            "txExecutionResultName": "FINISHED_WITH_RETURN",
            "result_name": "MAJORITY_AGREE",
            "created_timestamp": str(timestamp),
        },
    }
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": json.dumps(response, separators=(",", ":"))},
    )
    return facts


def test_chain_validator_unwraps_return_and_rechecks_independent_facts(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-wrapper", "demo")
    facts = _mock_rpc(direct_vm, direct_bob, direct_alice)
    sentinel.bind_evidence(
        "incident-wrapper", "chain-wrapper", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )

    stored_leader_result, _, validator_fn = direct_vm._captured_validators[-1]
    from genlayer import vm as gl_vm

    # The direct harness exposes the same Result union shape used by GenVM.
    # This positive case would fail against the old implementation because it
    # passed the Return wrapper itself to _authentication_matches.
    assert validator_fn(gl_vm.Return(calldata=stored_leader_result)) is True

    for leader_result in (
        gl_vm.UserError("leader application error"),
        gl_vm.VMError("leader VM error"),
        gl_vm.Return(calldata=None),
        gl_vm.Return(calldata=[]),
        gl_vm.Return(calldata={"status": "VALID"}),
    ):
        assert validator_fn(leader_result) is False

    for field in ("authenticated_facts", "event_timestamp", "current", "critical_signal", "mitigation_complete"):
        changed = dict(stored_leader_result)
        changed[field] = "tampered" if isinstance(changed[field], str) else not changed[field]
        assert validator_fn(gl_vm.Return(calldata=changed)) is False


def test_chain_validator_ignores_volatile_current_timestamp_when_security_facts_match(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-volatile-clock", "demo")
    facts = _mock_rpc(direct_vm, direct_bob, direct_alice)
    direct_vm.clear_mocks()
    response = {
        "jsonrpc": "2.0", "id": 1, "result": {
            "hash": TX_HASH,
            "sender": str(direct_bob),
            "recipient": str(direct_alice),
            "data": {"calldata": "0x1234"},
            "status": "FINALIZED",
            "txExecutionResultName": "FINISHED_WITH_RETURN",
            "result_name": "MAJORITY_AGREE",
            "created_timestamp": str(OBSERVED_AT),
            "current_timestamp": "leader-time",
        }
    }
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": json.dumps(response, separators=(",", ":"))},
    )

    sentinel.bind_evidence(
        "incident-volatile-clock", "chain-volatile-clock", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )
    stored_leader_result, _, _ = direct_vm._captured_validators[-1]

    direct_vm.clear_mocks()
    response["result"]["current_timestamp"] = "validator-time"
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": json.dumps(response, separators=(",", ":"))},
    )
    assert direct_vm.run_validator(leader_result=stored_leader_result) is True


def test_semantic_result_normalizes_v06_json_text_and_exact_boolean_strings(
    direct_vm, direct_deploy, direct_alice
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    expected = {
        "verdict": "ACTIVE_INCIDENT",
        "criteria_met": True,
        "reason": "corroborated",
    }
    assert sentinel._parse_judgment_result(json.dumps(expected)) == expected
    assert sentinel._parse_judgment_result(
        b'{"verdict":"ACTIVE_INCIDENT","criteria_met":"true","reason":"corroborated"}'
    ) == expected
    assert sentinel._parse_judgment_result(
        '```json\n{"verdict":"ACTIVE_INCIDENT","criteria_met":"true","reason":"corroborated"}\n```'
    ) == expected


def test_semantic_result_normalizes_hosted_wrapper_shapes_without_truthy_coercion(
    direct_vm, direct_deploy, direct_alice
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    expected = {
        "verdict": "ACTIVE_INCIDENT",
        "criteria_met": True,
        "reason": "corroborated",
    }
    payload = json.dumps(expected, separators=(",", ":"))
    assert sentinel._parse_judgment_result({"ok": payload}) == expected
    assert sentinel._parse_judgment_result({"result": expected}) == expected
    assert sentinel._parse_judgment_result(
        {"ok": payload.encode("utf-8")}
    ) == expected
    assert sentinel._parse_judgment_result(
        json.dumps({"ok": payload}).encode("utf-8")
    ) == expected
    aliased = sentinel._parse_judgment_result(
        'model response: {"decision":"ACTIVE_INCIDENT","criteriaMet":true,"reason":"corroborated"}'
    )
    assert aliased is not None
    assert aliased["verdict"] == expected["verdict"]
    assert aliased["criteria_met"] is True


def test_semantic_result_rejects_ambiguous_or_unbounded_coercions(
    direct_vm, direct_deploy, direct_alice
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    assert sentinel._parse_judgment_result({"verdict": "ACTIVE_INCIDENT", "criteria_met": 1}) is None
    assert sentinel._parse_judgment_result(
        {"verdict": "ACTIVE_INCIDENT", "criteria_met": "TRUE"}
    ) is None
    assert sentinel._parse_judgment_result(
        "The incident is active; criteria_met=true"
    ) is None


def _advisory(protocol_address, incident_id, *, phase="EMERGENCY", current=True):
    return json.dumps(
        {
            "protocol_id": "demo",
            "protocol_address": str(protocol_address),
            "incident_id": incident_id,
            "phase": phase,
            "failure_class": "unauthorized-drain",
            "current": current,
            "critical_signal": current,
            "mitigation_complete": not current,
            "transaction_hash": TX_HASH,
            "narrative": "Untrusted advisory text is never policy.",
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def test_rpc_adapter_uses_explicit_json_string_post_body():
    source = (ROOT / "contracts" / "sentinel.py").read_text(encoding="utf-8")
    start = source.index("def _authenticate_chain_transaction")
    end = source.index("def _authenticate_web_evidence", start)
    adapter = source[start:end]
    assert 'json.dumps(payload, separators=(",", ":"))' in adapter
    assert 'body=body' in adapter
    assert 'headers={"content-type": "application/json"}' in adapter
    assert "body=payload" not in adapter


@pytest.mark.parametrize(
    "response_body",
    [
        json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32601}}),
        json.dumps({"jsonrpc": "2.0", "id": 1, "result": None}),
        "{not-json",
    ],
)
def test_rpc_adapter_rejects_rpc_errors_missing_result_and_malformed_json(
    direct_vm, direct_deploy, direct_alice, direct_bob, response_body
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-rpc", "demo")
    facts = _mock_rpc(direct_vm, direct_bob, direct_alice)
    sentinel.bind_evidence(
        "incident-rpc", "chain-1", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": response_body},
    )
    item = {
        "source_url": RPC_URL,
        "source_domain": "studio-next.genlayer.com",
        "content_digest": _transaction_digest(facts),
        "observed_at": 0,
        "phase": "EMERGENCY",
        "evidence_type": "CHAIN_TRANSACTION",
        "transaction_hash": TX_HASH,
        "transaction_input": "0x1234",
        "transaction_block": 0,
    }
    result = sentinel._authenticate_one(
        item, sentinel.protocols["demo"], "demo", str(direct_alice),
        "unauthorized-drain", "incident-rpc", "EMERGENCY"
    )
    assert result["status"] == "INVALID"


def test_rpc_transaction_evidence_authenticates_normalized_facts(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-rpc", "demo")
    facts = _mock_rpc(direct_vm, direct_bob, direct_alice)
    sentinel.bind_evidence(
        "incident-rpc", "chain-1", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )
    advisory = _advisory(direct_alice, "incident-rpc")
    direct_vm.mock_web(
        r"advisory\.example/advisories/incident",
        {"status": 200, "body": advisory},
    )
    sentinel.bind_evidence(
        "incident-rpc", "advisory-1", "EMERGENCY", "SECURITY_ADVISORY",
        "https://advisory.example/advisories/incident", "unauthorized-drain",
        _digest(advisory), TX_HASH, 123
    )
    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"corroborated"}',
    )
    protocol = sentinel.protocols["demo"]
    items = sentinel._copied_evidence(sentinel.incidents["incident-rpc"], protocol, "EMERGENCY")
    sentinel.assess_incident("incident-rpc")
    assert sentinel.get_state("incident-rpc") == "ACTIVE_INCIDENT"
    assert sentinel.get_protocol("demo")["canonical_rpc_endpoint"] == RPC_URL


def test_external_chain_time_is_data_not_the_genvm_freshness_clock(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-clock", "demo")
    external_event_time = 1789325441
    facts = _mock_rpc(
        direct_vm,
        direct_bob,
        direct_alice,
        timestamp=external_event_time,
    )
    sentinel.bind_evidence(
        "incident-clock", "chain-clock", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )
    evidence = sentinel.get_evidence("chain-clock")
    assert evidence["observed_at"] == OBSERVED_AT
    assert evidence["event_timestamp"] == external_event_time


def test_advisory_observation_time_is_internal_and_not_caller_controlled(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-advisory-clock", "demo")
    advisory = _advisory(direct_alice, "incident-advisory-clock")
    direct_vm.mock_web(
        r"advisory\.example/advisories/incident",
        {"status": 200, "body": advisory},
    )
    sentinel.bind_evidence(
        "incident-advisory-clock", "advisory-clock", "EMERGENCY", "SECURITY_ADVISORY",
        "https://advisory.example/advisories/incident", "unauthorized-drain",
        _digest(advisory), TX_HASH, 123
    )
    evidence = sentinel.get_evidence("advisory-clock")
    assert evidence["observed_at"] == OBSERVED_AT
    assert evidence["event_timestamp"] == 0
    source = (ROOT / "contracts" / "sentinel.py").read_text(encoding="utf-8")
    bind_section = source[source.index("def bind_evidence"):source.index("def assess_incident")]
    assert "observed_at: u64" not in bind_section


def test_freshness_revalidation_uses_only_internal_genvm_observation_time(
    direct_vm, direct_deploy, direct_alice
):
    sentinel = _setup_final_sentinel(
        direct_vm,
        direct_deploy,
        direct_alice,
        max_evidence_age_seconds=10,
        minimum_sources=1,
    )
    sentinel.open_incident("incident-same-clock", "demo")
    body = _advisory(direct_alice, "incident-same-clock")
    direct_vm.mock_web(
        r"advisory\.example/advisories/clock",
        {"status": 200, "body": body},
    )
    sentinel.bind_evidence(
        "incident-same-clock", "evidence-clock", "EMERGENCY", "TRANSACTION",
        "https://advisory.example/advisories/clock", "unauthorized-drain",
        _digest(body), TX_HASH, 123
    )
    direct_vm.warp("2024-01-01T00:00:11Z")
    sentinel.assess_incident("incident-same-clock")
    assert sentinel.get_incident("incident-same-clock")["incident_authentication_block_code"] == "STALE_EVIDENCE"


def test_clock_domain_end_to_end_assessment_uses_internal_observations(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-clock-e2e", "demo")

    # The external RPC event time intentionally lives in a very different
    # domain from the GenVM transaction time. It is retained as event data,
    # but must not control evidence freshness.
    facts = _mock_rpc(
        direct_vm,
        direct_bob,
        direct_alice,
        timestamp=1789325441,
    )
    sentinel.bind_evidence(
        "incident-clock-e2e",
        "chain-clock-e2e",
        "EMERGENCY",
        "CHAIN_TRANSACTION",
        RPC_URL,
        "unauthorized-drain",
        _transaction_digest(facts),
        TX_HASH,
        0,
        "0x1234",
    )

    advisory = _advisory(direct_alice, "incident-clock-e2e")
    direct_vm.mock_web(
        r"advisory\.example/advisories/clock-e2e",
        {"status": 200, "body": advisory},
    )
    sentinel.bind_evidence(
        "incident-clock-e2e",
        "advisory-clock-e2e",
        "EMERGENCY",
        "SECURITY_ADVISORY",
        "https://advisory.example/advisories/clock-e2e",
        "unauthorized-drain",
        _digest(advisory),
        TX_HASH,
        123,
    )

    # 3,599 seconds have elapsed on the GenVM clock, while the external
    # timestamp remains far in the future relative to that clock.
    direct_vm.warp("2024-01-01T00:59:59Z")
    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"corroborated"}',
    )
    sentinel.assess_incident("incident-clock-e2e")
    assert sentinel.get_state("incident-clock-e2e") == "ACTIVE_INCIDENT"


def test_live_studio_next_two_source_assessment_counts_storage_records(
    direct_vm, direct_deploy, direct_alice
):
    """Regression for the final deployment's two-record assessment failure."""
    incident_id = "incident-studio-next-mu1fr5u2"
    tx_hash = "0x8288af3d8f09139895cea0bd105c30e66e7384c1fb243161b50f3d7c64d20ff9"
    target = "0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B"
    sender = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8"
    tx_input = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg=="
    rpc_url = "https://studio-next.genlayer.com/api"
    advisory_url = (
        "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/"
        "evidence/advisories/incident-studio-next-mu1fr5u2.json"
    )
    advisory = json.dumps(
        {
            "schema": "sentinel-advisory-v1",
            "protocol_id": "sentinel-demo",
            "protocol_address": target,
            "incident_id": incident_id,
            "phase": "EMERGENCY",
            "failure_class": "unauthorized-drain",
            "current": True,
            "critical_signal": True,
            "mitigation_complete": False,
            "transaction_hash": tx_hash,
            "narrative": "The target remains unpaused pending assessment.",
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    chain_facts = {
        "hash": tx_hash,
        "sender": sender,
        "origin": sender,
        "target": target.lower(),
        "input": tx_input,
        "status": "FINALIZED",
        "execution": "FINISHED_WITH_RETURN",
        "consensus": "MAJORITY_AGREE",
        "event_timestamp": 1789402447,
    }
    chain_response = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "hash": tx_hash,
            "sender": sender,
            "recipient": target,
            "data": {"calldata": tx_input},
            "status": "FINALIZED",
            "txExecutionResultName": "FINISHED_WITH_RETURN",
            "result_name": "MAJORITY_AGREE",
            "created_timestamp": "1789402447",
        },
    }

    def iso(epoch):
        from datetime import datetime, timezone

        return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    direct_vm.warp(iso(1789402615))
    sentinel = direct_deploy(SENTINEL_PATH)
    sentinel.register_protected_protocol(
        "sentinel-demo",
        target,
        "unauthorized-drain",
        "studio-next.genlayer.com,raw.githubusercontent.com",
        "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/",
        rpc_url,
        2,
        3600,
        900,
    )
    sentinel.lock_emergency_policy("sentinel-demo")
    sentinel.open_incident(incident_id, "sentinel-demo")

    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {
            "method": "POST",
            "status": 200,
            "body": json.dumps(chain_response, separators=(",", ":")),
        },
    )
    direct_vm.warp(iso(1789402675))
    sentinel.bind_evidence(
        incident_id,
        "chain-8288af3d8f09",
        "EMERGENCY",
        "CHAIN_TRANSACTION",
        rpc_url,
        "unauthorized-drain",
        _transaction_digest(chain_facts),
        tx_hash,
        0,
        tx_input,
    )

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"raw\.githubusercontent\.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-studio-next-mu1fr5u2\.json",
        {"status": 200, "body": advisory},
    )
    direct_vm.warp(iso(1789402809))
    sentinel.bind_evidence(
        incident_id,
        "advisory-8288af3d8f09",
        "EMERGENCY",
        "SECURITY_ADVISORY",
        advisory_url,
        "unauthorized-drain",
        hashlib.sha256(advisory.encode("utf-8")).hexdigest(),
        tx_hash,
        1,
        "",
    )

    direct_vm.warp(iso(1789404735))
    incident = sentinel.incidents[incident_id]
    protocol = sentinel.protocols["sentinel-demo"]
    items = sentinel._copied_evidence(incident, protocol, "EMERGENCY")
    assert len(incident.evidence_ids_csv.split(",")) == 2
    assert len(items) == 2
    assert {item["source_domain"] for item in items} == {
        "studio-next.genlayer.com",
        "raw.githubusercontent.com",
    }
    assert {item["observed_at"] for item in items} == {1789402675, 1789402809}
    context = sentinel._build_assessment_context(
        incident, protocol, "EMERGENCY", incident_id
    )
    assert context["bound_count"] == 2
    assert context["authenticated_count"] == 2
    assert context["fresh_count"] == 2
    assert context["distinct_count"] == 2
    assert len(context["evidence"]) == 2

    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"two independent sources"}',
    )
    sentinel.assess_incident(incident_id)
    assert sentinel.get_state(incident_id) == "ACTIVE_INCIDENT"

    source = (ROOT / "contracts" / "sentinel.py").read_text(encoding="utf-8")
    helper = source[source.index("def _copied_evidence"):source.index("def register_protected_protocol")]
    assert "record = self.evidence[evidence_id]" in helper


def test_assessment_materializes_storage_policy_before_nondeterminism():
    """Nondeterministic callbacks receive plain policy values, not storage objects."""
    source = (ROOT / "contracts" / "sentinel.py").read_text(encoding="utf-8")
    assert "def _assessment_protocol_snapshot" in source
    assert "protocol_in_memory = gl.storage.copy_to_memory(protocol)" in source

    emergency = source[source.index("def assess_incident"):source.index("def execute_pause")]
    recovery = source[source.index("def assess_recovery"):source.index("def execute_unpause")]
    assert "assessment_context = self._build_assessment_context(" in emergency
    assert "assessment_context = self._build_assessment_context(" in recovery
    assert "self._judge_evidence(assessment_context)" in emergency
    assert "self._judge_evidence(assessment_context)" in recovery
    assert "self._authenticate_one" not in emergency
    assert "self._authenticate_one" not in recovery


def test_assessment_context_is_plain_and_shared_by_both_callbacks(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, _ = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice
    )
    sentinel.open_incident("incident-context", "demo")
    body_one, body_two = _mock_qualifying_evidence(
        direct_vm, direct_alice, incident_id="incident-context"
    )
    _bind(
        sentinel,
        evidence_id="context-chain",
        url="https://explorer.example/tx/one",
        body=body_one,
        incident_id="incident-context",
    )
    _bind(
        sentinel,
        evidence_id="context-advisory",
        url="https://advisory.example/incident/one",
        body=body_two,
        evidence_type="SECURITY_ADVISORY",
        incident_id="incident-context",
    )
    context = sentinel._build_assessment_context(
        sentinel.incidents["incident-context"],
        sentinel.protocols["demo"],
        "EMERGENCY",
        "incident-context",
    )
    assert context["bound_count"] == 2
    assert context["authenticated_count"] == 2
    assert context["fresh_count"] == 2
    assert context["distinct_count"] == 2
    assert len(context["evidence"]) == 2
    assert all(isinstance(item["authenticated_facts"], str) for item in context["evidence"])
    assert all(isinstance(item["fresh"], bool) for item in context["evidence"])
    assert all(
        isinstance(value, (bool, int, str))
        for item in context["evidence"]
        for value in item.values()
    )
    assert "self.storage" not in repr(context)


def test_invalid_evidence_is_rejected_before_assessment_snapshot(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, _ = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice
    )
    sentinel.open_incident("incident-invalid", "demo")
    body = _advisory(direct_alice, "incident-invalid")
    _bind(sentinel, evidence_id="invalid", url="https://explorer.example/tx/one", body=body, incident_id="incident-invalid")
    assert sentinel.get_evidence("invalid")["authentication_state"] == "BLOCKED"


def test_one_source_fails_deterministic_quorum_before_nondeterminism(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, _ = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice
    )
    sentinel.open_incident("incident-one-source", "demo")
    body_one, _ = _mock_qualifying_evidence(
        direct_vm, direct_alice, incident_id="incident-one-source"
    )
    _bind(
        sentinel,
        evidence_id="one-source",
        url="https://explorer.example/tx/one",
        body=body_one,
        incident_id="incident-one-source",
    )
    before = len(direct_vm._captured_validators)
    sentinel.assess_incident("incident-one-source")
    assert len(direct_vm._captured_validators) == before
    assert sentinel.get_incident("incident-one-source")["incident_authentication_block_code"] == "INSUFFICIENT_EVIDENCE"


def test_two_records_same_source_fail_distinct_quorum_before_nondeterminism(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, _ = _setup_sentinel(
        direct_vm, direct_deploy, direct_owner, direct_alice
    )
    sentinel.open_incident("incident-same-source", "demo")
    body_one, body_two = _mock_qualifying_evidence(
        direct_vm, direct_alice, incident_id="incident-same-source"
    )
    direct_vm.mock_web(
        r"explorer\.example/tx/two", {"status": 200, "body": body_two}
    )
    _bind(
        sentinel,
        evidence_id="same-source-one",
        url="https://explorer.example/tx/one",
        body=body_one,
        incident_id="incident-same-source",
    )
    _bind(
        sentinel,
        evidence_id="same-source-two",
        url="https://explorer.example/tx/two",
        body=body_two,
        incident_id="incident-same-source",
    )
    sentinel.assess_incident("incident-same-source")
    assert sentinel.get_incident("incident-same-source")["incident_authentication_block_code"] == "DUPLICATE_SOURCE"


def test_stale_authenticated_snapshot_fails_deterministic_freshness_quorum(
    direct_vm, direct_deploy, direct_owner, direct_alice
):
    sentinel, _ = _setup_sentinel(
        direct_vm,
        direct_deploy,
        direct_owner,
        direct_alice,
        max_evidence_age_seconds=10,
    )
    sentinel.open_incident("incident-stale-snapshot", "demo")
    body_one, body_two = _mock_qualifying_evidence(
        direct_vm, direct_alice, incident_id="incident-stale-snapshot"
    )
    _bind(
        sentinel,
        evidence_id="stale-one",
        url="https://explorer.example/tx/one",
        body=body_one,
        incident_id="incident-stale-snapshot",
    )
    _bind(
        sentinel,
        evidence_id="stale-two",
        url="https://advisory.example/incident/one",
        body=body_two,
        evidence_type="SECURITY_ADVISORY",
        incident_id="incident-stale-snapshot",
    )
    direct_vm.warp("2024-01-01T00:00:11Z")
    sentinel.assess_incident("incident-stale-snapshot")
    assert sentinel.get_incident("incident-stale-snapshot")["incident_authentication_block_code"] == "STALE_EVIDENCE"


def test_assessment_uses_internal_observation_floor_when_genvm_clock_rolls_back(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A stale gen_call datetime must not make internally fresh evidence future-dated."""
    sentinel = _setup_final_sentinel(
        direct_vm, direct_deploy, direct_alice, max_evidence_age_seconds=3600
    )
    target_address = direct_alice
    incident_id = "incident-genvm-clock-floor"
    sentinel.open_incident(incident_id, "demo")
    facts = _mock_rpc(direct_vm, direct_bob, target_address, timestamp=1789402447)
    advisory = _advisory(target_address, incident_id)
    direct_vm.warp("2024-01-02T00:00:00Z")
    sentinel.bind_evidence(
        incident_id,
        "clock-floor-one",
        "EMERGENCY",
        "CHAIN_TRANSACTION",
        RPC_URL,
        "unauthorized-drain",
        _transaction_digest(facts),
        TX_HASH,
        0,
        "0x1234",
    )
    direct_vm.mock_web(
        r"advisory\.example/advisories/clock-floor",
        {"status": 200, "body": advisory},
    )
    sentinel.bind_evidence(
        incident_id,
        "clock-floor-two",
        "EMERGENCY",
        "SECURITY_ADVISORY",
        "https://advisory.example/advisories/clock-floor",
        "unauthorized-drain",
        _digest(advisory),
        TX_HASH,
        123,
    )
    direct_vm.warp("2024-01-01T00:00:01Z")
    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"clock floor"}',
    )
    sentinel.assess_incident(incident_id)
    assert sentinel.get_state(incident_id) == "ACTIVE_INCIDENT"


def test_assessment_preserves_locked_age_bound_after_clock_floor(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """The clock floor fixes rollback without waiving the configured age bound."""
    from datetime import datetime, timezone

    def iso(epoch):
        return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    sentinel = _setup_final_sentinel(
        direct_vm, direct_deploy, direct_alice, max_evidence_age_seconds=3600
    )
    incident_id = "incident-clock-floor-age-bound"
    sentinel.open_incident(incident_id, "demo")
    facts = _mock_rpc(direct_vm, direct_bob, direct_alice)
    sentinel.bind_evidence(
        incident_id,
        "age-bound-chain",
        "EMERGENCY",
        "CHAIN_TRANSACTION",
        RPC_URL,
        "unauthorized-drain",
        _transaction_digest(facts),
        TX_HASH,
        0,
        "0x1234",
    )

    advisory = _advisory(direct_alice, incident_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"advisory\.example/advisories/incident",
        {"status": 200, "body": advisory},
    )
    direct_vm.warp(iso(OBSERVED_AT + 7385))
    sentinel.bind_evidence(
        incident_id,
        "age-bound-advisory",
        "EMERGENCY",
        "SECURITY_ADVISORY",
        "https://advisory.example/advisories/incident",
        "unauthorized-drain",
        _digest(advisory),
        TX_HASH,
        123,
    )

    # Reproduce the hosted smoke's exact two-hour-plus source gap while the
    # GenVM transaction clock is also rolled back before both observations.
    direct_vm.warp(iso(OBSERVED_AT + 1))
    sentinel.assess_incident(incident_id)
    assert sentinel.get_incident(incident_id)["incident_authentication_block_code"] == "STALE_EVIDENCE"


@pytest.mark.parametrize(
    "field, value, message",
    [
        ("hash", "0x" + "2" * 64, ""),
        ("sender", "0x" + "4" * 40, ""),
        ("recipient", "0x" + "3" * 40, ""),
        ("data", {"calldata": "0x5678"}, ""),
        ("status", None, ""),
        ("status", "PENDING", ""),
        ("txExecutionResultName", "FINISHED_WITH_ERROR", ""),
        ("result_name", "MINORITY_AGREE", ""),
    ],
)
def test_assessment_uses_frozen_authenticated_facts_after_source_changes(
    direct_vm, direct_deploy, direct_alice, direct_bob, field, value, message
):
    sentinel = _setup_final_sentinel(direct_vm, direct_deploy, direct_alice)
    sentinel.open_incident("incident-rpc", "demo")
    facts = _facts(direct_bob, direct_alice)
    response = {
        "jsonrpc": "2.0", "id": 1, "result": {
            "hash": TX_HASH,
            "sender": str(direct_bob),
            "recipient": str(direct_alice),
            "data": {"calldata": "0x1234"},
            "status": "FINALIZED",
            "txExecutionResultName": "FINISHED_WITH_RETURN",
            "result_name": "MAJORITY_AGREE",
            "created_timestamp": str(OBSERVED_AT),
        }
    }
    # Bind against an authenticated result, then replace only the remote
    # response. Assessment must use the stored authenticated snapshot.
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": json.dumps(response, separators=(",", ":"))},
    )
    sentinel.bind_evidence(
        "incident-rpc", "chain-1", "EMERGENCY", "CHAIN_TRANSACTION", RPC_URL,
        "unauthorized-drain", _transaction_digest(facts), TX_HASH, 0, "0x1234"
    )
    response["result"][field] = value
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"studio-next\.genlayer\.com/api",
        {"method": "POST", "status": 200, "body": json.dumps(response, separators=(",", ":"))},
    )
    advisory = _advisory(direct_alice, "incident-rpc")
    direct_vm.mock_web(
        r"advisory\.example/advisories/incident",
        {"status": 200, "body": advisory},
    )
    sentinel.bind_evidence(
        "incident-rpc", "advisory-1", "EMERGENCY", "SECURITY_ADVISORY",
        "https://advisory.example/advisories/incident", "unauthorized-drain",
        _digest(advisory), TX_HASH, 123
    )
    direct_vm.mock_llm(
        "Assess only whether an active critical incident",
        '{"verdict":"ACTIVE_INCIDENT","criteria_met":true,"reason":"unsafe"}',
    )
    sentinel.assess_incident("incident-rpc")
    assert sentinel.get_state("incident-rpc") == "ACTIVE_INCIDENT"


def test_source_prefix_is_segment_safe_and_queries_are_not_identity(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.warp("2024-01-01T00:00:00Z")
    sentinel = direct_deploy(SENTINEL_PATH)
    with direct_vm.expect_revert("outside the locked source prefix"):
        sentinel.register_protected_protocol(
            "demo", direct_alice, "unauthorized-drain", "advisory.example",
            "advisory.example|/approved/path/", "https://advisory.example/approved/pathology",
            1, 3600, 0,
        )
    with direct_vm.expect_revert("canonical"):
        sentinel.register_protected_protocol(
            "demo", direct_alice, "unauthorized-drain", "advisory.example",
            "advisory.example|/approved/path/", "https://advisory.example/approved/path/?x=1",
            1, 3600, 0,
        )


def test_protected_demo_outflow_remediation_and_pause_boundary(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    direct_vm.warp("2024-01-01T00:00:00Z")
    target = direct_deploy(PROTECTED_DEMO_PATH, direct_alice)
    with direct_vm.prank(direct_owner):
        target.configure_sentinel(direct_alice)
    state = target.get_treasury_state()
    assert state["treasury_balance"] == 1000
    assert state["total_outflow"] == 0
    assert state["remediated"] is False

    with direct_vm.prank(direct_bob):
        target.execute_outflow(direct_owner, 125)
    assert target.get_treasury_state()["treasury_balance"] == 875
    last = target.get_last_outflow()
    assert str(last["actor"]).lower() == str(direct_bob).lower()
    assert str(last["recipient"]).lower() == str(direct_owner).lower()
    assert last["amount"] == 125

    with direct_vm.prank(direct_alice):
        target.emergency_pause()
    with direct_vm.prank(direct_bob), direct_vm.expect_revert("protocol is paused"):
        target.execute_outflow(direct_owner, 1)
    with direct_vm.prank(direct_owner):
        target.apply_remediation()
        target.apply_remediation()
    assert target.is_remediated() is True
    with direct_vm.prank(direct_alice):
        target.emergency_unpause()
    with direct_vm.prank(direct_bob), direct_vm.expect_revert("remediated"):
        target.execute_outflow(direct_owner, 1)
    with direct_vm.prank(direct_owner):
        target.execute_outflow(direct_owner, 1)
    assert target.get_treasury_state()["treasury_balance"] == 874


def test_protected_demo_rejects_invalid_outflow_amounts(
    direct_vm, direct_deploy, direct_owner
):
    direct_vm.warp("2024-01-01T00:00:00Z")
    target = direct_deploy(PROTECTED_DEMO_PATH, "0x" + "00" * 20)
    with direct_vm.expect_revert("must be positive"):
        target.execute_outflow(direct_owner, 0)
    with direct_vm.expect_revert("exceeds treasury"):
        target.execute_outflow(direct_owner, 1001)
