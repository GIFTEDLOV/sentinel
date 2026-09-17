"""Direct-mode test for the temporary hosted advisory GET probe."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

from gltest.direct import VMContext, create_address, loader


ROOT = Path(__file__).parents[1]
CONTRACT = ROOT / "diagnostics" / "hosted_advisory_get_probe.py"
ADVISORY = ROOT / "evidence" / "advisories" / "incident-template.json"
URL = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-template.json"


def _load_conftest() -> None:
    path = ROOT / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("hosted_advisory_probe_conftest", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load direct-mode compatibility shims")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def run_direct() -> dict:
    body = ADVISORY.read_bytes()
    vm = VMContext()
    vm.sender = create_address("hosted_advisory_probe_sender")
    captured = []

    def handler(request):
        captured.append(request)
        return {
            "ok": {
                "response": {
                    "status": 200,
                    "headers": {"content-type": b"application/json"},
                    "body": body,
                }
            }
        }

    vm._live_web_handler = handler
    with vm.activate():
        contract = loader.deploy_contract(CONTRACT.resolve(), vm)
        result = contract.probe()
    assert captured[0]["url"] == URL
    assert captured[0]["method"] == "GET"
    assert hashlib.sha256(body).hexdigest() == result["body_sha256"]
    assert len(body) == result["body_bytes"]
    assert json.loads(body.decode("utf-8"))["schema"] == result["schema"]
    return {"result": result, "request": {"url": captured[0]["url"], "method": captured[0]["method"]}}


if __name__ == "__main__":
    _load_conftest()
    print(json.dumps(run_direct(), indent=2, sort_keys=True, default=str))
