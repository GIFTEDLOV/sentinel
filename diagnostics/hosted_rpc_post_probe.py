# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

"""Temporary hosted diagnostic for a typed JSON-string RPC POST.

This source is not production Sentinel.  It is intentionally limited to one
read-only objective lookup and returns only stable transaction facts.
"""

import json
import typing

import genlayer as gl


RPC_URL = "https://studio-dev.genlayer.com/api"
RPC_METHOD = "eth_getTransactionByHash"
MAX_RESPONSE_BYTES = 65536


def _fetch_normalized(transaction_hash: str) -> dict[str, typing.Any]:
    payload = {
        "jsonrpc": "2.0",
        "method": RPC_METHOD,
        "params": [transaction_hash],
        "id": 1,
    }
    serialized = json.dumps(payload, separators=(",", ":"))
    response = gl.nondet.web.post(
        RPC_URL,
        body=serialized,
        headers={"content-type": "application/json"},
    )
    if response.status != 200 or response.body is None:
        raise gl.vm.UserError("canonical RPC HTTP response unavailable")
    if len(response.body) > MAX_RESPONSE_BYTES:
        raise gl.vm.UserError("canonical RPC response exceeds bound")
    try:
        envelope = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise gl.vm.UserError("canonical RPC response is not valid JSON")
    if not isinstance(envelope, dict):
        raise gl.vm.UserError("canonical RPC envelope is not an object")
    if envelope.get("error") is not None:
        raise gl.vm.UserError("canonical RPC returned an error")
    result = envelope.get("result")
    if not isinstance(result, dict):
        raise gl.vm.UserError("canonical RPC result is not an object")

    returned_hash = result.get("hash")
    from_address = result.get("from_address")
    to_address = result.get("to_address") or result.get("recipient")
    data = result.get("data")
    input_data = data.get("calldata") if isinstance(data, dict) else None
    if not isinstance(returned_hash, str) or returned_hash != transaction_hash:
        raise gl.vm.UserError("canonical RPC hash mismatch")
    if not isinstance(from_address, str) or not from_address:
        raise gl.vm.UserError("canonical RPC sender missing")
    if not isinstance(to_address, str) or not to_address:
        raise gl.vm.UserError("canonical RPC target missing")
    if not isinstance(input_data, str) or not input_data:
        raise gl.vm.UserError("canonical RPC calldata missing")

    block_number = result.get("blockNumber")
    if block_number is None:
        block_number = result.get("block_number")
    return {
        "hash": returned_hash,
        "from": from_address,
        "to": to_address,
        "input": input_data,
        "blockNumber": block_number,
    }


class HostedRpcPostProbe(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def probe_transaction(self, tx_hash: str) -> typing.Any:
        return gl.eq_principle.strict_eq(lambda: _fetch_normalized(tx_hash))
