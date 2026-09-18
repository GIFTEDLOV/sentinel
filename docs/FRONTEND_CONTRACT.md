# Frontend contract

The frontend is a real Bradbury client for the deployed Sentinel and ProtectedDemo addresses. It
does not create local incident truth, fake metrics, or simulated target state.

## Network and reads

`BradburyGenLayerTransport` uses `genlayer-js 1.1.8` with the official `testnetBradbury` chain
definition (`4221`, `https://rpc-bradbury.genlayer.com`). Read clients are created without a wallet.
Configured protocol and incident ids are explicit read hints because the MVP intentionally has no
map-enumeration view.

## Wallet and writes

Writes require an injected EIP-1193 provider and an account on chain `4221`. The wallet is asked to
sign only after the UI has read the relevant precondition. No automatic network switch or auto-sign
is performed. The stable client submits the SDK's normal `writeContract` request with `value: 0`;
the RC fee-estimation API is not used.

## Write lifecycle

```text
PRECONDITION READ
  -> BROADCAST ONCE
  -> PERSIST HASH IMMEDIATELY
  -> RECONCILE SAME HASH
  -> FINALIZED + FINISHED_WITH_RETURN
  -> READ FINAL CONTRACT STATE
```

`TransactionCoordinator` stores pending operation hashes in localStorage, resumes them after a
refresh, distinguishes provisional `ACCEPTED` from final consensus, preserves the last trustworthy
state during a temporary lookup failure, and never rebroadcasts after a hash exists. Triggered
cross-contract transaction ids are read when Bradbury exposes them.

## UI rules

- No fake incident, verdict, pause state, balance, or deployment address.
- `ACTIVE_INCIDENT` and `PAUSED` are rendered only from contract reads.
- Evidence metadata is labeled separately from contract-side authentication and consensus.
- A finalized execution error is surfaced as a failure, not as a successful state change.
- Recovery controls require fresh recovery consensus and target confirmation.
