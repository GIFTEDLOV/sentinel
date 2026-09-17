# Hosted GenVM Web POST Diagnosis

Date: 2026-09-12  
Scope: diagnostic-only; no production contract, frontend, deployment, or transaction was changed or created by this diagnosis.

## Decision

**OUTCOME_D — the current failure is a request/body representation problem.**

The hosted error is not evidence that HTTP POST or Studio-dev self-RPC is
unsupported. The deployed diagnostic passed a Python mapping as the
`WebRequest.body` value. The installed v0.6-compatible GenVM wrapper accepts
only `str | bytes | None` for that field and does not JSON-encode mappings.
The mapping is therefore encoded as a GenLayer calldata map and reaches the
native web-call boundary with the wrong field type. The native call rejects
that payload with `SystemError: 2: inval` before an HTTP response exists.

The correct request representation is a UTF-8 JSON string or bytes, with the
JSON content type supplied explicitly:

```python
payload = json.dumps(
    {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getTransactionByHash",
        "params": [transaction_hash],
    },
    separators=(",", ":"),
)
response = gl.nondet.web.post(
    "https://studio-dev.genlayer.com/api",
    body=payload,
    headers={"content-type": "application/json"},
)
```

The equivalent generic form is:

```python
response = gl.nondet.web.request(
    "https://studio-dev.genlayer.com/api",
    method="POST",
    body=payload,
    headers={"content-type": "application/json"},
)
```

Do not pass `body=payload_as_dict` to this installed runtime. The wrapper does
not add `Content-Type` automatically; the caller must provide it when the
destination expects JSON.

## Installed runtime inspection

The dependency header used by the diagnostic resolves in the direct runner to
the extracted v0.6 RC runtime under:

`C:\Users\DELL\.cache\gltest-direct\extracted\v0.6.0-rc2\py-lib-genlayer-std\...\genlayer\nondet\web.py`

The actual source signatures are:

```python
class Response:
    status: int
    headers: dict[str, bytes]
    body: bytes | None

def request(
    url: str, /, *,
    method: Literal["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"],
    body: str | bytes | None = None,
    headers: dict[str, str | bytes] = {},
    sign: bool = False,
) -> Lazy[Response]

def post(
    url: str, /, *,
    body: str | bytes | None = None,
    headers: dict[str, str | bytes] = {},
    sign: bool = False,
) -> Lazy[Response]
```

`request` requires the HTTP method as a keyword. `post` simply calls
`request.lazy(..., method="POST", ...)`. The helper used by both methods is
equivalent to:

```python
if isinstance(data, str):
    return data.encode("utf-8")
return data
```

Consequently:

| Field | Accepted by the installed wrapper | Actual behavior |
|---|---|---|
| URL | `str` | passed through |
| method | fixed literal set | passed through |
| body | `str`, `bytes`, or `None` | strings become UTF-8 bytes; bytes remain bytes; a mapping is not converted |
| headers | `dict[str, str \| bytes]` | each value becomes bytes; no default content type is inserted |
| response | `Response` | `status`, byte-valued `headers`, and `body` |

The current official web-access page still shows a generic `body={}` example,
but that conflicts with the installed RC wrapper and the project boilerplate's
published `str | bytes | None` signature. For this deployment/runtime pair,
the installed wrapper and hosted trace are the authoritative evidence for the
wire shape. See the [official web-access documentation](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access)
and the [GenLayer project-boilerplate API guidance](https://github.com/genlayerlabs/genlayer-project-boilerplate/blob/main/CLAUDE.md#web-access-gl-nondetweb).

## Calldata boundary evidence

The installed GenLayer calldata codec supports maps, strings, and bytes as
general calldata values. That is not the same as saying every native operation
accepts every calldata type in every field.

The v0.6 encoder source defines these tags:

```text
TYPE_BYTES = 3
TYPE_STR   = 4
TYPE_MAP   = 6
```

For the small payload used in the matrix, the encoded `WebRequest.body` is:

| Input to `web` wrapper | Body observed at direct web boundary | Encoded body kind |
|---|---|---|
| Python mapping | `dict` | map (`TYPE_MAP`) |
| JSON text | `bytes` containing the exact UTF-8 JSON | string converted to bytes (`TYPE_BYTES` at the WebRequest field) |
| JSON bytes | `bytes` containing the exact UTF-8 JSON | bytes (`TYPE_BYTES`) |

The hosted stack trace for the existing diagnostic is:

```text
gl.nondet.web.request
  -> gl_call_generic
  -> SystemError: 2: inval
```

It occurs at the native `_imp_raw(...)` call, before `Response` decoding and
before the contract can parse `response.body`. The correctly typed transaction
hash argument was already present in the later read-only simulation, so the
remaining invalid value is the nested web request body representation.

## Direct-mode request matrix

Diagnostic-only files:

- `diagnostics/web_post_matrix_contract.py`
- `diagnostics/web_post_matrix_test.py`

The test uses the direct runner's live web boundary with a deterministic mock;
it does not claim hosted network reachability. It records the request object
that the GenVM wrapper presents to that boundary.

| Variant | Invocation | Direct call | Body at web boundary | Result |
|---|---|---:|---|---|
| A | `request(..., method="POST", body=dict, headers=...)` | executes in permissive direct shim | `dict` | **not hosted-compatible**; direct shim does not enforce native WebRequest field type |
| B | `request(..., method="POST", body=json_text, headers=...)` | pass | `bytes` | correct shape |
| C | `post(..., body=json_text, headers=...)` | pass | `bytes` | correct shape |
| D | `post(..., body=json_bytes, headers=...)` | pass | `bytes` | correct shape |

The direct matrix output showed the exact body for B–D:

```text
{"probe":"sentinel","value":"small"}
```

and the exact `content-type` header:

```text
application/json
```

Variant A is important: it can appear to “work” under the direct mock because
`gltest.direct` forwards the mapping to its Python handler. That permissive
test double does not prove that the hosted native web operation accepts a map.

## Existing hosted evidence

The already-deployed diagnostic schema was queried read-only. It contains only
one method:

```text
probe(transaction_hash: string) -> any
```

That method is hard-coded to use `gl.nondet.web.request` with a mapping body.
The previous read-only Studio simulation supplied the transaction hash through
the installed GenLayerJS calldata codec as an actual string. It still failed:

```text
RPC: https://studio-dev.genlayer.com/api
RPC method: sim_estimateTransactionFees
target: 0xBfA0d297b455Cc2EB6Ee8E629cdAb14411855d07
method: probe
simulation: execution failed
VM result: exit_code 1
trace: gl.nondet.web.request -> gl_call_generic -> SystemError: 2: inval
HTTP response parsed: no
```

This rules out the already-fixed transaction-hash BigInt issue as the current
cause. It also localizes the failure to the web-call request encoding rather
than JSON response parsing, receipt decoding, fee exhaustion, or the external
RPC's returned data.

At host level, outside GenVM, both of these POST destinations responded during
diagnosis:

- `https://test-server.genlayer.com/body/echo`: HTTP 200 and echoed the JSON body.
- `https://studio-dev.genlayer.com/api`: HTTP 200 and returned the requested `eth_getTransactionByHash` object.

These host-level checks are transport sanity checks only, not validator proofs.

## Why no hosted echo result is claimed

The undeployed matrix source contains separate methods for the official echo
endpoint, but the current deployed diagnostic has only the hard-coded
`probe` method. The CLI's `call` command accepts a deployed address and method;
it cannot execute an undeployed source file. The user explicitly prohibited
redeploying the diagnostic and broadcasting any new transaction. Therefore:

```text
OFFICIAL_ECHO_HOSTED_RESULT: NOT RUN — requires a deployed diagnostic method
that uses the corrected string/bytes body.
```

No hosted POST success is inferred from direct mocks or host-level HTTP. A
future qualification needs one explicitly approved hosted simulation/deploy
gate for the new diagnostic; it must not retry the malformed transaction.

## Studio-dev self-RPC conclusion

```text
SELF_RPC_ACCESS: UNKNOWN
```

The current failure happens before the web request is accepted by the native
transport, so it cannot distinguish “self-RPC blocked” from “bad request
representation.” It would be unsound to label Studio-dev self-RPC supported or
unsupported from this trace. After the corrected body shape is proven hosted,
test the official echo endpoint first and then the Studio-dev RPC POST. If echo
passes but Studio-dev fails, investigate self-RPC policy. Until then, do not
build a production receipt adapter or claim hosted self-RPC qualification.

## Outcome and implementation gate

```text
HOSTED_POST_SUPPORTED: NOT PROVEN BY THIS NO-DEPLOY DIAGNOSTIC
ROOT_CAUSE: WebRequest.body is a map because the deployed code passes a dict;
            the native hosted web ABI expects a string/bytes/null body and
            rejects the map with EINVAL (2).
CORRECT_REQUEST_FORM: gl.nondet.web.post(..., body=json.dumps(payload),
                     headers={"content-type": "application/json"})
OBJECTIVE_RPC_ARCHITECTURE_VIABLE: NOT YET PROVEN
SAFE_TO_IMPLEMENT_SENTINEL_RECEIPT_ADAPTER: NO — hosted corrected-path
                                             qualification remains required.
OUTCOME: OUTCOME_D
```

The next safe step is a separately approved hosted qualification using the
corrected diagnostic source. It should use the same one-broadcast/reconcile
rules as any other deployment. This task made no transaction and stopped before
that gate.

## Final report

```text
INSTALLED_REQUEST_SIGNATURE: request(url: str, /, *, method: Literal[GET, POST, PUT, DELETE, HEAD, OPTIONS, PATCH], body: str | bytes | None = None, headers: dict[str, str | bytes] = {}, sign: bool = False) -> Lazy[Response]
INSTALLED_POST_SIGNATURE: post(url: str, /, *, body: str | bytes | None = None, headers: dict[str, str | bytes] = {}, sign: bool = False) -> Lazy[Response]

DICT_BODY_SUPPORTED_DIRECT: DIRECT SHIM ACCEPTS, BUT NOT HOSTED-COMPATIBLE
JSON_STRING_BODY_SUPPORTED_DIRECT: PASS
WEB_POST_SUPPORTED_DIRECT: PASS

OFFICIAL_ECHO_HOSTED_RESULT: NOT RUN — no redeploy permitted
STUDIO_RPC_DICT_BODY_RESULT: FAIL — hosted existing diagnostic; EINVAL before HTTP
STUDIO_RPC_JSON_STRING_RESULT: NOT RUN HOSTED — existing deployed method is hard-coded to dict
STUDIO_RPC_WEB_POST_RESULT: NOT RUN HOSTED — no deployed method

HOSTED_POST_SUPPORTED: NOT PROVEN
SELF_RPC_ACCESS: UNKNOWN
ROOT_CAUSE: invalid nested WebRequest body type (map instead of UTF-8 bytes/null)
CORRECT_REQUEST_FORM: POST with json.dumps/json bytes and explicit application/json
OBJECTIVE_RPC_ARCHITECTURE_VIABLE: NOT YET PROVEN
SUPPORTED_ALTERNATIVE_IF_NOT: NONE selected; self-RPC has not been disproved
OUTCOME: OUTCOME_D
SAFE_TO_IMPLEMENT_SENTINEL_RECEIPT_ADAPTER: NO, pending hosted corrected-path proof

FILES_CHANGED: diagnostics/web_post_matrix_contract.py; diagnostics/web_post_matrix_test.py; docs/HOSTED_WEB_POST_DIAGNOSIS.md
PRODUCTION_CONTRACT_CHANGED: NO
FRONTEND_CHANGED: NO
TRANSACTIONS: NONE
DEPLOYMENTS: NONE
COMMITS: NONE
PUSHES: NONE
BLOCKERS: hosted corrected-body qualification requires an approved deployed/simulation method; no such method exists in the already-deployed diagnostic, and redeployment was prohibited
```
