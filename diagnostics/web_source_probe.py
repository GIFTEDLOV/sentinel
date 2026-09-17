"""Read-only GenVM web-path probe.

The direct runner has a deterministic web mock boundary rather than outbound
Internet access. This script first fetches a candidate from the host using a
no-redirect client, then injects that exact status/headers/body at the direct
runner boundary and executes gl.nondet.web.request inside a diagnostic
contract. It proves the v0.6 request/response shape, hashing, and size handling
without deploying or broadcasting anything. It does not prove hosted-validator
egress; that remains a separate qualification gate.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1]
CONTRACT = ROOT / "diagnostics" / "web_source_probe_contract.py"

# Reuse the repository's RC/Windows loader compatibility shims. Loading the
# conftest applies them without importing or mutating any production contract.
_conftest_path = ROOT / "tests" / "conftest.py"
_conftest_spec = importlib.util.spec_from_file_location("sentinel_diagnostic_conftest", _conftest_path)
if _conftest_spec is None or _conftest_spec.loader is None:
    raise RuntimeError("Could not load direct-mode compatibility shims")
_conftest = importlib.util.module_from_spec(_conftest_spec)
_conftest_spec.loader.exec_module(_conftest)

from gltest.direct import VMContext, create_address, loader


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        return None


def fetch_host(url: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)})
    context = ssl.create_default_context()
    opener = urllib.request.build_opener(
        NoRedirect,
        urllib.request.HTTPSHandler(context=context),
    )
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Sentinel-evidence-qualification/1"})
    try:
        with opener.open(request, timeout=20) as response:
            body = response.read(65537)
            return {
                "dns": addresses,
                "status": response.status,
                "body_bytes_read": len(body),
                "body_sha256": hashlib.sha256(body).hexdigest(),
                "content_type": response.headers.get("Content-Type", ""),
                "headers": {key.lower(): value for key, value in response.headers.items()},
                "redirect_observed": False,
                "body": body,
            }
    except urllib.error.HTTPError as error:
        body = error.read(65537)
        return {
            "dns": addresses,
            "status": error.code,
            "body_bytes_read": len(body),
            "body_sha256": hashlib.sha256(body).hexdigest(),
            "content_type": error.headers.get("Content-Type", ""),
            "headers": {key.lower(): value for key, value in error.headers.items()},
            "redirect_observed": 300 <= error.code < 400 or "location" in {key.lower() for key in error.headers},
            "body": body,
        }


def probe_direct(url: str, response: dict[str, Any]) -> dict[str, Any]:
    vm = VMContext()
    vm.sender = create_address("diagnostic_sender")
    body = response.get("body", b"")
    headers = {key: value.encode("utf-8") for key, value in response.get("headers", {}).items()}
    # gltest-direct's documented live handler is the runtime-compatible
    # boundary used by glsim when an external transport supplies a response.
    # Feed it the exact host-fetched bytes; no production contract is loaded.
    vm._live_web_handler = lambda _request: {"ok": {"response": {
        "status": response["status"],
        "headers": headers,
        "body": body,
    }}}
    with vm.activate():
        contract = loader.deploy_contract(CONTRACT.resolve(), vm)
        result = contract.fetch(url)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("urls", nargs="+")
    args = parser.parse_args()
    output = []
    for url in args.urls:
        record: dict[str, Any] = {"url": url}
        try:
            response = fetch_host(url)
            record["host_fetch"] = {key: value for key, value in response.items() if key not in {"body", "headers"}}
            record["host_fetch"]["location_header"] = response.get("headers", {}).get("location", "")
            record["direct_genvm_probe"] = probe_direct(url, response)
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        output.append(record)
    print(json.dumps(output, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
