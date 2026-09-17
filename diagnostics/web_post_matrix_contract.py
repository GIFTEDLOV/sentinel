"""Undeployed diagnostic for GenVM POST argument serialization.

This source is intentionally not part of Sentinel production.  Its methods
call the official GenLayer test-server echo endpoint, while direct-mode tests
replace the web transport with a deterministic mock and inspect the encoded
request that reached that boundary.
"""

# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
import typing

import genlayer as gl


ECHO_URL = "https://test-server.genlayer.com/body/echo"
PAYLOAD = {"probe": "sentinel", "value": "small"}
JSON_BODY = json.dumps(PAYLOAD, separators=(",", ":"))
JSON_HEADERS = {"content-type": "application/json"}


def _normalized(response: typing.Any) -> dict[str, typing.Any]:
    body = response.body or b""
    return {
        "status": response.status,
        "body_bytes": len(body),
        "body_prefix": body[:128].decode("utf-8", errors="replace"),
    }


class WebPostMatrix(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def probe_official_request_dict(self) -> typing.Any:
        response = gl.nondet.web.request(
            ECHO_URL,
            method="POST",
            body=PAYLOAD,
            headers=JSON_HEADERS,
        )
        return _normalized(response)

    @gl.public.write
    def probe_official_request_json_string(self) -> typing.Any:
        response = gl.nondet.web.request(
            ECHO_URL,
            method="POST",
            body=JSON_BODY,
            headers=JSON_HEADERS,
        )
        return _normalized(response)

    @gl.public.write
    def probe_official_post_json_string(self) -> typing.Any:
        response = gl.nondet.web.post(
            ECHO_URL,
            body=JSON_BODY,
            headers=JSON_HEADERS,
        )
        return _normalized(response)

    @gl.public.write
    def probe_official_post_bytes(self) -> typing.Any:
        response = gl.nondet.web.post(
            ECHO_URL,
            body=JSON_BODY.encode("utf-8"),
            headers=JSON_HEADERS,
        )
        return _normalized(response)
