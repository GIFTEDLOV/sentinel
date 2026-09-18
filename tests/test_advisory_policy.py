import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SENTINEL_PATH = str(ROOT / "contracts" / "sentinel.py")
ADVISORY_DIR = ROOT / "evidence" / "advisories"
FINAL_PROTECTED_DEMO_ADDRESS = "0xbfC7DD4e7c57997F74C56175DBad234E4CA01B05"
FINAL_SENTINEL_ADDRESS = "0x0000000000000000000000000000000000000001"
FINAL_NETWORK = "Studio Next"
FINAL_RPC_URL = "https://studio-next.genlayer.com/api"
HISTORICAL_STUDIO_DEV_PROTECTED_DEMO_ADDRESS = "0xFCeC042B2fcc1d793Bf92877665c9Bae16971AE1"
HISTORICAL_PROTECTED_DEMO_ADDRESS = (
    "0x38f38591" + "A2835e2e9b467FBAc94D4b613Ce27584"
)
FIXTURE_OWNER = "GIFTEDLOV"
FIXTURE_REPOSITORY = "sentinel-evidence"
FIXTURE_BRANCH = "main"
ADVISORY_PREFIX = (
    f"raw.githubusercontent.com|/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/"
    f"{FIXTURE_BRANCH}/evidence/advisories/"
)
RPC_PREFIX = "studio-next.genlayer.com|/api"
RPC_URL = "https://studio-next.genlayer.com/api"
ADVISORY_BASE = (
    f"https://raw.githubusercontent.com/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/"
    f"{FIXTURE_BRANCH}/evidence/advisories/"
)


def _load_generator():
    path = ROOT / "tools" / "build_advisory.py"
    spec = importlib.util.spec_from_file_location("build_advisory", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _deploy_with_fixture_policy(direct_deploy, direct_alice):
    sentinel = direct_deploy(SENTINEL_PATH)
    sentinel.register_protected_protocol(
        "sentinel-demo",
        direct_alice,
        "unauthorized-drain",
        "studio-next.genlayer.com,raw.githubusercontent.com",
        f"{RPC_PREFIX};{ADVISORY_PREFIX}",
        RPC_URL,
        2,
        3600,
        900,
    )
    return sentinel


def test_generator_emits_contract_compatible_incident_and_digest():
    builder = _load_generator()
    transaction_hash = "0x" + "ab" * 32
    encoded = builder.build_document(
        phase="INCIDENT",
        incident_id="incident-2026-01",
        transaction_hash=transaction_hash,
        issued_at="2026-09-12T12:00:00Z",
        summary="The owner classifies the referenced outflow as unauthorized.",
        facts=["authorization=owner-confirmed", "containment=pause-recommended"],
    )
    document = json.loads(encoded)
    assert list(document) == [
        "schema", "protocol_id", "protocol_address", "network", "canonical_rpc",
        "incident_id", "phase",
        "failure_class", "status", "transaction_hash", "issued_at", "current",
        "critical_signal", "mitigation_complete", "summary", "facts",
    ]
    assert document["phase"] == "EMERGENCY"
    assert document["status"] == "CONFIRMED"
    assert document["protocol_address"] == FINAL_PROTECTED_DEMO_ADDRESS
    assert document["network"] == FINAL_NETWORK
    assert document["canonical_rpc"] == FINAL_RPC_URL
    assert document["transaction_hash"] == transaction_hash
    assert len(encoded) < 65536
    assert HISTORICAL_PROTECTED_DEMO_ADDRESS.lower() not in encoded.decode("utf-8").lower()
    assert HISTORICAL_STUDIO_DEV_PROTECTED_DEMO_ADDRESS.lower() not in encoded.decode("utf-8").lower()
    assert "studio-dev.genlayer.com" not in encoded.decode("utf-8").lower()
    repeat = builder.build_document(
        phase="INCIDENT",
        incident_id="incident-2026-01",
        transaction_hash=transaction_hash,
        issued_at="2026-09-12T12:00:00Z",
        summary="The owner classifies the referenced outflow as unauthorized.",
        facts=["authorization=owner-confirmed", "containment=pause-recommended"],
    )
    assert encoded == repeat
    assert hashlib.sha256(encoded).hexdigest() == hashlib.sha256(repeat).hexdigest()
    assert len(encoded) == len(repeat)
    assert hashlib.sha256(encoded).hexdigest() == hashlib.sha256(repeat).hexdigest()
    assert len(encoded) == len(repeat)


def test_generator_emits_recovery_flags_and_rejects_unbounded_or_implicit_inputs():
    builder = _load_generator()
    document = json.loads(
        builder.build_document(
            phase="RECOVERY",
            incident_id="incident-2026-01",
            transaction_hash="0x" + "1" * 64,
            issued_at="2026-09-12T12:00:00Z",
            summary="The owner confirms remediation and containment.",
            facts=["remediation=owner-confirmed"],
        )
    )
    assert document["phase"] == "RECOVERY"
    assert document["status"] == "REMEDIATED"
    assert document["current"] is False
    assert document["critical_signal"] is False
    assert document["mitigation_complete"] is True
    assert document["protocol_address"] == FINAL_PROTECTED_DEMO_ADDRESS
    assert document["network"] == FINAL_NETWORK
    assert document["canonical_rpc"] == FINAL_RPC_URL
    assert document["transaction_hash"] == "0x" + "1" * 64
    assert HISTORICAL_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(document).lower()
    assert HISTORICAL_STUDIO_DEV_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(document).lower()
    assert "studio-dev.genlayer.com" not in json.dumps(document).lower()
    with pytest.raises(ValueError, match="transaction hash"):
        builder.build_document(
            phase="INCIDENT", incident_id="i", transaction_hash="<HASH>",
            issued_at="2026-09-12T12:00:00Z", summary="x", facts=[]
        )
    with pytest.raises(ValueError, match="issued_at"):
        builder.build_document(
            phase="INCIDENT", incident_id="i", transaction_hash="0x" + "1" * 64,
            issued_at="now", summary="x", facts=[]
        )


def test_final_prefix_shape_is_segment_safe_and_accepts_incident_and_recovery_urls(
    direct_deploy, direct_alice
):
    sentinel = _deploy_with_fixture_policy(direct_deploy, direct_alice)
    policy = sentinel.protocols["sentinel-demo"]
    for phase in ("incident", "recovery"):
        url = ADVISORY_BASE + f"incident-1.{phase}.json"
        assert sentinel._allowed_source_identity(policy, url)[0] == "raw.githubusercontent.com"


@pytest.mark.parametrize(
    "url",
    [
        f"https://raw.githubusercontent.com/another-owner/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/advisories/incident.json",
        f"https://raw.githubusercontent.com/{FIXTURE_OWNER}/OtherRepo/{FIXTURE_BRANCH}/evidence/advisories/incident.json",
        f"https://raw.githubusercontent.com/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/dev/evidence/advisories/incident.json",
        f"https://raw.githubusercontent.com/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/other/incident.json",
        f"https://raw.githubusercontent.com/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/advisories-old/incident.json",
        ADVISORY_BASE + "incident.json?download=1",
        ADVISORY_BASE + "incident.json#section",
        f"https://{FIXTURE_OWNER}@raw.githubusercontent.com.attacker.example/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/advisories/incident.json",
        f"https://raw.githubusercontent.com@attacker.example/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/advisories/incident.json",
        f"http://raw.githubusercontent.com/{FIXTURE_OWNER}/{FIXTURE_REPOSITORY}/{FIXTURE_BRANCH}/evidence/advisories/incident.json",
    ],
)
def test_final_prefix_rejects_identity_attacks(url, direct_deploy, direct_alice):
    sentinel = _deploy_with_fixture_policy(direct_deploy, direct_alice)
    with pytest.raises(Exception):
        sentinel._allowed_source_identity(sentinel.protocols["sentinel-demo"], url)


def test_policy_call_shape_matches_current_sentinel_source():
    source = (ROOT / "contracts" / "sentinel.py").read_text(encoding="utf-8")
    start = source.index("def register_protected_protocol(")
    end = source.index(") -> None:", start)
    signature = source[start:end]
    expected = [
        "protocol_id: str",
        "target_address: str",
        "critical_failure_class: str",
        "allowed_source_domains: str",
        "allowed_source_prefixes: str",
        "canonical_rpc_endpoint: str",
        "minimum_sources: gl.u8",
        "max_evidence_age_seconds: gl.u64",
        "recovery_cooldown_seconds: gl.u64",
    ]
    for item in expected:
        assert item in signature
    assert "def lock_emergency_policy(self, protocol_id: str)" in source


def test_templates_are_placeholders_not_fake_live_evidence():
    incident = json.loads((ADVISORY_DIR / "incident-template.json").read_text(encoding="utf-8"))
    recovery = json.loads((ADVISORY_DIR / "recovery-template.json").read_text(encoding="utf-8"))
    assert incident["transaction_hash"] == "<INCIDENT_TX_HASH>"
    assert recovery["transaction_hash"] == "<REMEDIATION_TX_HASH>"
    assert incident["protocol_address"] == FINAL_PROTECTED_DEMO_ADDRESS
    assert recovery["protocol_address"] == FINAL_PROTECTED_DEMO_ADDRESS
    assert incident["network"] == FINAL_NETWORK
    assert recovery["network"] == FINAL_NETWORK
    assert incident["canonical_rpc"] == FINAL_RPC_URL
    assert recovery["canonical_rpc"] == FINAL_RPC_URL
    assert HISTORICAL_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(incident).lower()
    assert HISTORICAL_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(recovery).lower()
    assert HISTORICAL_STUDIO_DEV_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(incident).lower()
    assert HISTORICAL_STUDIO_DEV_PROTECTED_DEMO_ADDRESS.lower() not in json.dumps(recovery).lower()
    assert "studio-dev.genlayer.com" not in json.dumps(incident).lower()
    assert "studio-dev.genlayer.com" not in json.dumps(recovery).lower()
    assert incident["phase"] == "EMERGENCY"
    assert recovery["phase"] == "RECOVERY"
