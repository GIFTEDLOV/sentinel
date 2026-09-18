# Final Demo Scenario

The final showcase uses a fresh Sentinel and ProtectedDemo pair. The current
staging pair is not mutated.

## Final Studio Next deployment

```text
Network: Studio Next
RPC: https://studio-next.genlayer.com/api
Chain ID: 61997
Sentinel: 0x452CA08CfF00A792bFcc0CdFCFaBe3CFe0B54709
ProtectedDemo: 0xc4C76868AA96b58C71Ef85Da3e53E96BC538984B
```

## Locked policy shape

```text
protocol_id: sentinel-demo
failure_class: unauthorized-drain
minimum_sources: 2
max_evidence_age_seconds: 3600
recovery_cooldown_seconds: 900
```

The two approved identities are the exact Studio Next RPC endpoint/prefix and a
protocol-owned advisory repository/path prefix selected and pinned before final
registration. A broad `raw.githubusercontent.com` allowlist is not sufficient.

## Incident

1. ProtectedDemo starts with a healthy abstract treasury of 1000 accounting
   units and `remediated=false`.
2. A separate test account calls the neutral `execute_outflow(recipient,
   amount)` action before remediation. The action succeeds and records the
   actor, recipient, amount, total outflow, and reduced treasury balance.
3. The transaction hash is reconciled as finalized, accepted, and successfully
   executed.
4. Sentinel binds `CHAIN_TRANSACTION` evidence with the exact RPC endpoint,
   exact expected calldata, and the digest of normalized receipt facts. The
   canonical transaction time is retained as `event_timestamp`; Sentinel's
   freshness clock is its internally assigned GenVM observation time.
5. A new `SECURITY_ADVISORY` document under the locked path references the same
   transaction hash and explains why the owner classifies it as unauthorized.
6. GenLayer authenticates both sources before validators judge only whether the
   locked unauthorized-drain condition is established.
7. `ACTIVE_INCIDENT` authorizes `execute_pause`; `confirm_pause` reads
   `is_paused() == true` before the product says **Emergency pause active**.

## Remediation and recovery

1. While paused, the owner calls `apply_remediation()`. It is owner-only,
   one-way, idempotent, and intentionally callable while paused.
2. The owner transaction is reconciled through the same canonical RPC adapter.
3. New `RECOVERY` evidence is bound under a new evidence id: a chain transaction
   record plus a new advisory referencing the remediation hash and declaring the
   incident contained.
4. The incident receipt is not reused. The positive 900-second cooldown is
   enforced independently by Sentinel.
5. Validators judge only whether the fresh authenticated recovery facts establish
   `SAFE_TO_RECOVER`.
6. Sentinel executes unpause; `confirm_recovered` requires target readback
   `is_paused() == false` before the product says **Recovered**.
7. After recovery, normal `process()` succeeds, while the former arbitrary
   caller's `execute_outflow` fails. The owner may still perform a legitimate
   outflow.

## Clock-domain correction

The canonical RPC event timestamp and GenVM transaction `_now()` remain separate
domains. Historical Studio-dev development evidence demonstrated the mismatch;
the final Studio Next deployment preserves the same safe separation. External
event time is authenticated as a fact, not used as Sentinel freshness time.
Sentinel assigns an internal `observed_at`
only after it fetches and authenticates the evidence. Assessment compares the
current GenVM time to that stored observation time, so the 3600-second policy
window is meaningful and cannot be manipulated by a caller-supplied timestamp.

## Judge-facing explanation

“The RPC source proves what transaction actually happened. The protocol advisory
explains why that transaction is an incident. Sentinel authenticates both before
validators make the narrow semantic judgment. Validators do not choose policy or
pause a contract themselves. Sentinel only requests the pause after consensus,
and the UI only claims a pause or recovery after reading the target’s real state.”
