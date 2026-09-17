"""Direct-mode proof for the canonical receipt POST request shape.

The direct runner has no external network.  The host fetch below obtains the
real Studio-dev response, then injects those exact bytes at gltest's live web
boundary.  The contract still performs the actual POST-shaped
``gl.nondet.web.request`` call, so this checks GenVM request encoding and JSON
parsing without broadcasting.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import socket
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

from gltest.direct import VMContext, create_address, loader


ROOT = Path(__file__).parents[1]
CONTRACT = ROOT / "diagnostics" / "receipt_probe_contract.py"
RPC_URL = "https://studio-dev.genlayer.com/api"
RPC_METHOD = "eth_getTransactionByHash"
TX_HASH = "0x101816026d41441709293b7f946963dd894262bdedc88a788ea934290ffc5099"


def _load_conftest() -> None:
    path = ROOT / "tests" / "conftest.py"
    spec = importlib.util.spec_from_file_location("receipt_probe_conftest", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load direct-mode compatibility shims")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def fetch_receipt() -> dict:
    parsed = urllib.parse.urlparse(RPC_URL)
    socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    context = ssl.create_default_context()
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": RPC_METHOD,
            "params": [TX_HASH],
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        RPC_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Sentinel-evidence-qualification/1",
        },
    )
    with urllib.request.urlopen(request, context=context, timeout=20) as response:
        raw = response.read(65537)
        return {
            "status": response.status,
            "headers": {key.lower(): value for key, value in response.headers.items()},
            "body": raw,
            "sha256": hashlib.sha256(raw).hexdigest(),
        }


def run_direct(host_response: dict) -> dict:
    vm = VMContext()
    vm.sender = create_address("receipt_probe_sender")
    vm._live_web_handler = lambda request: {
        "ok": {
            "response": {
                "status": host_response["status"],
                "headers": {
                    key: value.encode("utf-8")
                    for key, value in host_response["headers"].items()
                },
                "body": host_response["body"],
            }
        }
    }
    with vm.activate():
        contract = loader.deploy_contract(CONTRACT.resolve(), vm)
        return contract.probe(TX_HASH)


if __name__ == "__main__":
    _load_conftest()
    response = fetch_receipt()
    result = run_direct(response)
    print(json.dumps({"host": {key: value for key, value in response.items() if key != "body"}, "direct": result}, indent=2, sort_keys=True, default=str))
