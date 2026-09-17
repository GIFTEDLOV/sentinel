"""Build a bounded, deterministic Sentinel protocol advisory JSON document."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


PROTOCOL_ID = "sentinel-demo"
PROTOCOL_ADDRESS = "0xbfC7DD4e7c57997F74C56175DBad234E4CA01B05"
NETWORK = "Studio Next"
CANONICAL_RPC = "https://studio-next.genlayer.com/api"
FAILURE_CLASS = "unauthorized-drain"
MAX_DOCUMENT_BYTES = 65536
MAX_FACTS = 16
MAX_IDENTIFIER_LENGTH = 96
MAX_SUMMARY_LENGTH = 512
MAX_FACT_NAME_LENGTH = 64
MAX_FACT_VALUE_LENGTH = 512
HASH_PATTERN = re.compile(r"^0x[0-9a-fA-F]{64}$")
UTC_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"
)


def _bounded_text(value: str, label: str, maximum: int) -> str:
    if not isinstance(value, str) or value == "" or len(value) > maximum:
        raise ValueError(f"{label} must be a non-empty string of at most {maximum} characters")
    if "\n" in value or "\r" in value:
        raise ValueError(f"{label} must not contain a line break")
    return value


def _transaction_hash(value: str) -> str:
    if not isinstance(value, str) or HASH_PATTERN.fullmatch(value) is None:
        raise ValueError("transaction hash must be a 32-byte 0x-prefixed hexadecimal string")
    return value.lower()


def _issued_at(value: str) -> str:
    if UTC_PATTERN.fullmatch(value) is None:
        raise ValueError("issued_at must be an explicit UTC RFC3339 timestamp ending in Z")
    return value


def _phase(value: str) -> tuple[str, str, bool, bool, bool]:
    normalized = value.strip().upper()
    if normalized in ("INCIDENT", "EMERGENCY"):
        return "EMERGENCY", "CONFIRMED", True, True, False
    if normalized == "RECOVERY":
        return "RECOVERY", "REMEDIATED", False, False, True
    raise ValueError("phase must be INCIDENT, EMERGENCY, or RECOVERY")


def _facts(values: list[str]) -> list[dict[str, str]]:
    if len(values) > MAX_FACTS:
        raise ValueError(f"at most {MAX_FACTS} facts are allowed")
    result: list[dict[str, str]] = []
    for item in values:
        if "=" not in item:
            raise ValueError("each fact must use NAME=VALUE")
        name, value = item.split("=", 1)
        result.append(
            {
                "name": _bounded_text(name, "fact name", MAX_FACT_NAME_LENGTH),
                "value": _bounded_text(value, "fact value", MAX_FACT_VALUE_LENGTH),
            }
        )
    return result


def build_document(
    *,
    phase: str,
    incident_id: str,
    transaction_hash: str,
    issued_at: str,
    summary: str,
    facts: list[str],
) -> bytes:
    contract_phase, status, current, critical_signal, mitigation_complete = _phase(phase)
    document = {
        "schema": "sentinel-advisory-v1",
        "protocol_id": PROTOCOL_ID,
        "protocol_address": PROTOCOL_ADDRESS,
        "network": NETWORK,
        "canonical_rpc": CANONICAL_RPC,
        "incident_id": _bounded_text(incident_id, "incident_id", MAX_IDENTIFIER_LENGTH),
        "phase": contract_phase,
        "failure_class": FAILURE_CLASS,
        "status": status,
        "transaction_hash": _transaction_hash(transaction_hash),
        "issued_at": _issued_at(issued_at),
        "current": current,
        "critical_signal": critical_signal,
        "mitigation_complete": mitigation_complete,
        "summary": _bounded_text(summary, "summary", MAX_SUMMARY_LENGTH),
        "facts": _facts(facts),
    }
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_DOCUMENT_BYTES:
        raise ValueError(f"advisory exceeds the {MAX_DOCUMENT_BYTES}-byte contract input limit")
    return encoded


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=("INCIDENT", "EMERGENCY", "RECOVERY"))
    parser.add_argument("--incident-id", required=True)
    parser.add_argument("--transaction-hash", required=True)
    parser.add_argument("--issued-at", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--fact", action="append", default=[], help="repeatable NAME=VALUE fact")
    parser.add_argument("--output", type=Path, help="write exact UTF-8 bytes to this path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        encoded = build_document(
            phase=args.phase,
            incident_id=args.incident_id,
            transaction_hash=args.transaction_hash,
            issued_at=args.issued_at,
            summary=args.summary,
            facts=args.fact,
        )
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    else:
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.write(b"\n")
    print(f"SHA256: {hashlib.sha256(encoded).hexdigest()}", file=sys.stderr)
    print(f"BYTES: {len(encoded)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
