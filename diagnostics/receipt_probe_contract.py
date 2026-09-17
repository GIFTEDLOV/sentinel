# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

"""Temporary hosted-validator probe for the canonical Studio-dev receipt RPC.

This is deliberately not part of either production contract.  It makes one
POST through the GenVM nondeterministic web interface and returns only the
small receipt facts needed to prove that the canonical RPC response was
obtained and parsed by the GenVM runner.
"""

import json
import hashlib
import typing

import genlayer as gl


RPC_URL = "https://studio-dev.genlayer.com/api"
RPC_METHOD = "eth_getTransactionByHash"


class ReceiptProbe(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def probe(self, transaction_hash: str) -> typing.Any:
        def read_receipt() -> typing.Any:
            response = gl.nondet.web.request(
                RPC_URL,
                method="POST",
                body={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": RPC_METHOD,
                    "params": [transaction_hash],
                },
            )
            raw_body = response.body or b""
            if len(raw_body) > 65536:
                raise gl.vm.UserError("receipt response exceeds diagnostic bound")
            try:
                envelope = json.loads(raw_body.decode("utf-8"))
                receipt = envelope["result"]
            except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
                raise gl.vm.UserError("canonical receipt response is not valid JSON")
            if not isinstance(receipt, dict):
                raise gl.vm.UserError("canonical receipt result is not an object")

            data = receipt.get("data") or {}
            if not isinstance(data, dict):
                raise gl.vm.UserError("canonical receipt data is not an object")

            return {
                "rpc_method": RPC_METHOD,
                "rpc_status": response.status,
                "receipt_id": receipt.get("hash"),
                "tx_id": receipt.get("tx_id"),
                "sender": receipt.get("sender") or receipt.get("from_address"),
                "origin": receipt.get("origin_address"),
                "recipient": receipt.get("recipient") or receipt.get("to_address"),
                "status": receipt.get("status"),
                "execution_result_name": receipt.get("txExecutionResultName"),
                "consensus_result": receipt.get("result_name"),
                "created_timestamp": receipt.get("created_timestamp"),
                "current_timestamp": receipt.get("current_timestamp"),
                "calldata_base64": data.get("calldata"),
                "tx_data_hex": receipt.get("tx_data"),
                "response_bytes": len(raw_body),
                "response_sha256": hashlib.sha256(raw_body).hexdigest(),
            }

        return gl.vm.run_nondet(read_receipt, lambda _result: True)
