"""Direct-mode serialization matrix for the undeployed web POST diagnostic."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

from gltest.direct import VMContext, create_address, loader


ROOT = Path(__file__).parents[1]
CONTRACT = ROOT / "diagnostics" / "web_post_matrix_contract.py"
ECHO_URL = "https://test-server.genlayer.com/body/echo"
EXPECTED_BODY = b'{"probe":"sentinel","value":"small"}'


def _load_conftest() -> None:
    path = ROOT / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("web_post_matrix_conftest", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load direct-mode compatibility shims")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def _run(method_name: str) -> dict[str, Any]:
    vm = VMContext()
    vm.sender = create_address("web_post_matrix_sender")
    captured: list[dict[str, Any]] = []

    def handler(request: dict[str, Any]) -> dict[str, Any]:
        captured.append(
            {
                "url": request.get("url"),
                "method": request.get("method"),
                "body_type": type(request.get("body")).__name__,
                "body": request.get("body"),
                "headers": request.get("headers"),
            }
        )
        return {
            "ok": {
                "response": {
                    "status": 200,
                    "headers": {"content-type": b"application/json"},
                    "body": b'{"echo":"ok"}',
                }
            }
        }

    vm._live_web_handler = handler
    with vm.activate():
        contract = loader.deploy_contract(CONTRACT.resolve(), vm)
        try:
            result = getattr(contract, method_name)()
            outcome: dict[str, Any] = {"result": result}
        except Exception as error:  # noqa: BLE001 - matrix records runtime behavior
            outcome = {
                "error_type": type(error).__name__,
                "error": str(error),
            }
    outcome["captured"] = captured
    if captured:
        request = captured[0]
        raw_body = request["body"]
        outcome["body_utf8"] = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else None
        outcome["body_matches_expected"] = raw_body == EXPECTED_BODY
        outcome["content_type"] = {
            str(key): (value.decode("utf-8") if isinstance(value, bytes) else value)
            for key, value in request["headers"].items()
        }
    return outcome


if __name__ == "__main__":
    _load_conftest()
    methods = [
        "probe_official_request_dict",
        "probe_official_request_json_string",
        "probe_official_post_json_string",
        "probe_official_post_bytes",
    ]
    print(json.dumps({method: _run(method) for method in methods}, indent=2, sort_keys=True, default=str))
