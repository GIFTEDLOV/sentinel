# Protocol-owned advisory channel

This directory is the authoritative demo advisory channel for the final
`sentinel-demo` protocol. It is intended to be published at:

```text
https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/
```

The final deployment uses the public `GIFTEDLOV/sentinel-evidence` repository
on `main`. Templates remain reusable placeholders and are not live evidence.

Final deployment: Network `Studio Next`, RPC
`https://studio-next.genlayer.com/api`, ProtectedDemo
`0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B`.

## Trust boundary

- The canonical Studio Next RPC independently proves objective transaction
  facts. It is not replaced by this advisory channel.
- An advisory supplies protocol-owner context: why the referenced, already
  authenticated transaction is classified as an incident or as remediation.
- Sentinel authenticates the two evidence sources before semantic assessment.
- An advisory alone cannot pause or unpause a protocol.
- Validator consensus does not authenticate GitHub ownership, HTTPS transport,
  or the advisory digest. Those are deterministic source and content checks.
- Recovery requires new `RECOVERY` evidence. The incident advisory and incident
  transaction are not reused as recovery proof.

## Contract-compatible JSON

The deployed Sentinel ABI uses `EMERGENCY` for the incident phase and
`RECOVERY` for the recovery phase. The product may label `EMERGENCY` as
`INCIDENT` in the UI, but the published JSON must use the contract token.

Both templates contain the fields required by the current web-authentication
path:

- `protocol_id` = `sentinel-demo`;
- `protocol_address` = the final ProtectedDemo address;
- `network` = `Studio Next`;
- `canonical_rpc` = `https://studio-next.genlayer.com/api`;
- `incident_id` = the exact on-chain incident identifier;
- `phase`, `failure_class`, and the three deterministic semantic flags;
- `transaction_hash`, which must equal the hash supplied to `bind_evidence`;
- bounded owner-authored `summary` and `facts` context.

The contract checks the SHA-256 digest of the exact UTF-8 response bytes. Keep
the generated file minified and do not add a trailing newline after generation.
The bound `content_digest` is the digest printed by
`tools/build_advisory.py`.

`issued_at` is included for judges and the frontend. In the current deployed
Sentinel, advisory freshness is enforced by the internally assigned
`observed_at` value and rechecked at assessment time; `issued_at` is not parsed
by the contract. Set the evidence observation time from the publication/fetch
record and never invent it.

## Publication procedure

1. Configure and verify the real public GitHub remote identity. The locked
   prefix must be the exact normalized serialized entry:

   ```text
   raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/
   ```

2. Publish the templates and this README in an ordinary repository commit.
   Do not publish a template as an incident or recovery record.
3. After the real attacker/outflow transaction finalizes, create one unique
   incident file with `tools/build_advisory.py`, passing the canonical
   transaction hash and an explicit UTC `issued_at`. Publish it in a new commit.
4. Fetch the raw URL, verify HTTP 200 with no observable redirect, compute the
   SHA-256 over the exact bytes, and retain the digest with the transaction
   evidence bundle.
5. Bind the incident advisory only after the canonical RPC evidence and the
   advisory body are both available. Use the same incident id and transaction
   hash in both records.
6. After owner remediation, repeat the process with a new recovery file and a
   new recovery evidence id. The recovery file references the remediation
   transaction, not the incident transaction.

Never rewrite an already-used advisory file. Use a new filename and a new
commit for every incident or recovery record. The branch is mutable, so the
per-evidence SHA-256 and exact transaction linkage are mandatory safeguards;
the prefix is not an assertion that GitHub proves an independent organization.

## Naming convention

Use lower-case, unique incident identifiers as filenames:

```text
evidence/advisories/<incident-id>.incident.json
evidence/advisories/<incident-id>.recovery.json
```

The filename is a publication convention, not an authentication primitive.
The contract authenticates the URL prefix, fetched bytes, required fields, and
linked transaction hash.
