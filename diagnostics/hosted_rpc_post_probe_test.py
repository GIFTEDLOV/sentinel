"""Direct-mode tests for the temporary corrected RPC POST diagnostic."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

from gltest.direct import VMContext, create_address, loader


ROOT = Path(__file__).parents[1]
CONTRACT = ROOT / "diagnostics" / "hosted_rpc_post_probe.py"
TX_HASH = "0x101816026d41441709293b7f946963dd894262bdedc88a788ea934290ffc5099"
RESPONSE = {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "hash": TX_HASH,
        "from_address": "0xB1E3ea743DF2b006b66751D57337C2bb10e23eCc",
        "to_address": "0xb7385835D950fdE5F43c95b252759701E6287Ffe",
        "data": {"calldata": "FgCsAWxvY2tfZW1lcmdlbmN5X3BvbGljeQRhcmdzDSRkZW1v"},
        "txExecutionResultName": "FINISHED_WITH_RETURN",
    },
}


def _load_conftest() -> None:
    path = ROOT / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("hosted_rpc_post_probe_conftest", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load direct-mode compatibility shims")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def _run(response: Any, tx_hash: str = TX_HASH) -> tuple[Any, list[dict[str, Any]]]:
    vm = VMContext()
    vm.sender = create_address("hosted_rpc_post_probe_sender")
    captured: list[dict[str, Any]] = []

    def handler(request: dict[str, Any]) -> dict[str, Any]:
        captured.append(request)
        body = request.get("body")
        assert isinstance(body, bytes), f"web body was {type(body).__name__}, not bytes"
        parsed = json.loads(body.decode("utf-8"))
        assert parsed == {
            "jsonrpc": "2.0",
            "method": "eth_getTransactionByHash",
            "params": [tx_hash],
            "id": 1,
        }
        assert request.get("method") == "POST"
        assert request.get("url") == "https://studio-dev.genlayer.com/api"
        headers = request.get("headers")
        assert isinstance(headers, dict)
        assert headers.get("content-type") == b"application/json"
        return {
            "ok": {
                "response": {
                    "status": 200,
                    "headers": {"content-type": b"application/json"},
                    "body": json.dumps(response, separators=(",", ":")).encode("utf-8"),
                }
            }
        }

    vm._live_web_handler = handler
    with vm.activate():
        contract = loader.deploy_contract(CONTRACT.resolve(), vm)
        result = contract.probe_transaction(tx_hash)
    return result, captured


def _assert_rejected(response: Any, tx_hash: str = TX_HASH) -> str:
    try:
        _run(response, tx_hash)
    except Exception as error:  # noqa: BLE001 - negative matrix records fail-closed behavior
        return f"{type(error).__name__}: {error}"
    raise AssertionError("malformed RPC response was accepted")


if __name__ == "__main__":
    _load_conftest()
    result, captured = _run(RESPONSE)
    # gltest-direct evaluates the leader path for this operation; hosted
    # consensus will execute the same strict-equivalence function for each
    # validator.  The captured request still proves the wire representation.
    assert len(captured) == 1
    assert result["hash"] == TX_HASH
    assert result["blockNumber"] is None

    cases = {
        "missing_result": {"jsonrpc": "2.0", "id": 1},
        "rpc_error": {"jsonrpc": "2.0", "id": 1, "error": {"code": -32601}},
        "wrong_hash": {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {**RESPONSE["result"], "hash": "0x" + "1" * 64},
        },
        "malformed_json": None,
    }
    rejected = {}
    for name, response in cases.items():
        if name == "malformed_json":
            response = "not-json"
        rejected[name] = _assert_rejected(response)
    print(json.dumps({"success": result, "request_count": len(captured), "rejected": rejected}, indent=2, default=str))
