# Objective Evidence Architecture

This is the production contract architecture for the final Studio Next pair.

```text
Network: Studio Next
RPC: https://studio-next.genlayer.com/api
Chain ID: 61997
Sentinel: 0x452CA08CfF00A792bFcc0CdFCFaBe3CFe0B54709
ProtectedDemo: 0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B
```

The temporary hosted diagnostic was historical Studio-dev qualification only.
No diagnostic is part of the production trust surface.

## Two evidence roles

1. `CHAIN_TRANSACTION` is objective evidence. Sentinel posts a compact JSON
   string to the locked `canonical_rpc_endpoint` using
   `eth_getTransactionByHash`.
2. `SECURITY_ADVISORY` is protocol-owned semantic context. Its HTTPS URL must
   match a locked canonical host and path prefix, and its SHA-256 body digest is
   checked before any semantic judgment.

These are different evidence roles. Two approved hostnames are counted, but the
contract does not claim that hostname diversity proves separate organizations.

## Canonical transaction request

The contract constructs the request itself:

```python
payload = {
    "jsonrpc": "2.0",
    "method": "eth_getTransactionByHash",
    "params": [transaction_hash],
    "id": 1,
}
body = json.dumps(payload, separators=(",", ":"))
gl.nondet.web.post(
    canonical_rpc_endpoint,
    body=body,
    headers={"content-type": "application/json"},
)
```

A Python dictionary is never passed as `WebRequest.body`.

## Authenticated transaction facts

The adapter accepts only a complete compatible response and normalizes:

```text
hash, sender, origin, target, input,
    status, execution, consensus, event_timestamp
```

It then requires:

- returned hash equals the bound transaction hash after lowercase canonicalization;
- target equals the locked ProtectedDemo target;
- emergency origin is not the protocol owner, while recovery origin is the owner;
- fetched input equals the stored exact input generated with the official SDK;
- `FINALIZED`, accepted/`MAJORITY_AGREE`, and `FINISHED_WITH_RETURN`;
- the canonical timestamp is retained as authenticated `event_timestamp` data;
- the stored digest equals SHA-256 over the normalized facts.

The RPC/node event timestamp and the GenVM transaction timestamp are separate
clock domains. Historical Studio-dev runtime evidence established this
distinction; the final Studio Next Sentinel never compares them
for freshness. `event_timestamp` describes when the underlying chain event was
recorded by the canonical RPC; `observed_at` is assigned internally from
Sentinel's GenVM `_now()` after the evidence fetch, authentication, digest,
schema, linkage, and policy checks have succeeded.

The current Python runtime does not provide a supported general-purpose
calldata decoder for this adapter. Exact input equality is the narrow fallback;
the client prepares that value through the official GenLayerJS codec and never
uses a human-readable method claim as proof.

## Locked source identity

Registration stores compact entries in the form:

```text
host|/normalized/path/prefix/
```

All URLs require HTTPS, valid DNS-style hostnames, no userinfo/port/query/
fragment/backslash, exact allowlisted host matching, and segment-safe prefix
matching. Therefore `/approved/pathology` does not match `/approved/path/`.

The RPC endpoint is also stored in the policy and must be inside an approved
host/prefix. Evidence callers cannot choose an arbitrary RPC URL.

The v0.6 response exposes status, headers, and body but not final URL or redirect
chain. Observable 3xx responses and `Location` headers fail closed. A final
deployment must use direct endpoints or a content-addressed/signed source that
does not depend on invisible redirect provenance.

## Advisory linkage

An advisory must carry `transaction_hash`, `event_transaction_hash`, or
`remediation_transaction_hash`, and the normalized value must equal the same
bound transaction hash. This deterministic linkage is checked before the LLM
sees the evidence. `issued_at` is audit/display metadata; it is not used as a
cross-domain freshness clock.

## Clock-domain correction

The old model accepted a caller-supplied `observed_at` and compared it with
GenVM `_now()`. That was unsafe because canonical node timestamps and GenVM
execution timestamps can differ by millions of seconds. The final ABI removes
the caller field. Chain and advisory evidence
are authenticated before binding, then Sentinel stores `observed_at = _now()`.
Assessment revalidation compares only the current GenVM `_now()` with that
stored internal observation time. `max_evidence_age_seconds` therefore means
the maximum time from Sentinel evidence acceptance to assessment, in one clock
domain; it does not claim an externally authenticated event-age limit.

## Trust ordering

```text
FETCH
  → AUTHENTICATE
  → NORMALIZE
  → VERIFY POLICY / TARGET / HASH / DIGEST
  → VERIFY ASSESSMENT-TIME FRESHNESS
  → COUNT DISTINCT CANONICAL HOSTS
  → SEMANTIC VERDICT
  → CONSENSUS
```

Validators receive authenticated facts plus untrusted advisory bytes. They only
judge whether those facts satisfy the locked `unauthorized-drain` emergency or
recovery question. They cannot choose policy, trust sources, or request an
action outside the contract lifecycle.
