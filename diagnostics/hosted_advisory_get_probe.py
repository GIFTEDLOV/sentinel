# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

"""Temporary hosted proof for the published Sentinel advisory channel."""

import hashlib
import json
import typing

import genlayer as gl


ADVISORY_URL = (
    "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/"
    "main/evidence/advisories/incident-template.json"
)
EXPECTED_SHA256 = "ae15c55049e883e8f3d623eb21ef3ce818c56ed563d5afc38e5d5734ba781c57"
EXPECTED_BYTES = 825
MAX_RESPONSE_BYTES = 65536


def _probe_published_advisory() -> dict[str, typing.Any]:
    response = gl.nondet.web.get(ADVISORY_URL, headers={"Accept": "application/json"})
    if response.status != 200 or response.body is None:
        raise gl.vm.UserError("advisory HTTP response unavailable")
    for header_name in response.headers:
        if header_name.lower() == "location":
            raise gl.vm.UserError("advisory redirect provenance is unavailable")
    body = response.body
    if len(body) > MAX_RESPONSE_BYTES or len(body) != EXPECTED_BYTES:
        raise gl.vm.UserError("advisory response size is invalid")
    digest = hashlib.sha256(body).hexdigest()
    if digest != EXPECTED_SHA256:
        raise gl.vm.UserError("advisory digest does not match published artifact")
    try:
        document = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise gl.vm.UserError("advisory is not valid UTF-8 JSON")
    if not isinstance(document, dict):
        raise gl.vm.UserError("advisory JSON is not an object")
    if document.get("schema") != "sentinel-advisory-v1":
        raise gl.vm.UserError("advisory schema is unexpected")
    if document.get("protocol_id") != "sentinel-demo":
        raise gl.vm.UserError("advisory protocol is unexpected")
    return {
        "status": "HTTP_200",
        "body_sha256": digest,
        "body_bytes": len(body),
        "schema": document["schema"],
        "protocol_id": document["protocol_id"],
    }


class HostedAdvisoryGetProbe(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def probe(self) -> typing.Any:
        return gl.eq_principle.strict_eq(_probe_published_advisory)
