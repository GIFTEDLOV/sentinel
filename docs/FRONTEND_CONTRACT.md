# Frontend contract boundary (Phase 2)

No frontend is built in Phase 1. This document defines the eventual UI boundary so future pages do not weaken the protocol invariants.

## Pages

The eventual application may provide:

`/` · `/app` · `/protocols` · `/protocols/[id]` · `/incidents` · `/incidents/[id]` · `/report` · `/lab` · `/activity` · `/integrate`

## Reads

The UI reads `ProtectedVault.get_status`, `get_voucher`, `get_total_demo_assets`, `is_paused`, `is_vulnerable`, and `contract_info`. It reads Sentinel `get_protocol`, `get_incident`, `get_protocol_ids`, `get_incident_ids`, `get_incidents_for_protocol` where available, and `contract_info`.

Incident screens must distinguish incident verdict (`OPEN`, `ADJUDICATING`, `DECIDED` plus the verdict enum) from target state (`ACTIVE`/paused or unpaused). There is no `PAUSED` incident verdict.

## Writes

Future forms may call `register_protocol`, `report_incident`, and `adjudicate_incident` on Sentinel, and the toy-only owner/test controls on ProtectedVault. Reporting must be presented as alarm intake, never as a pause control. The UI must not expose or imply an administrator verdict shortcut.

## Lab state machine

The Lab must be able to show:

`ACTIVE` → exploit succeeds → report incident → GenLayer adjudicates → `FINALIZED` → finalized Sentinel pause reaches target → same exploit fails.

It must show evidence admission, consensus decision, parent transaction status, child-message status, and verified target state separately.

## v0.6 transaction tracking boundary

For every write:

1. Broadcast exactly once.
2. Persist the transaction hash before polling.
3. Reconcile the same hash; never blind-rebroadcast after an ambiguous polling failure.
4. Require a protocol status of `ACCEPTED` or `FINALIZED` as appropriate.
5. Require the successful execution result (`FINISHED_WITH_RETURN`); an EVM submission receipt alone is not success.
6. For pause completion specifically, wait for `FINALIZED`, then read the target and verify `paused == true` and the expected incident identifier.

The UI must not equate `ACCEPTED` with `FINALIZED`, and it must not claim the target is paused merely because the parent Sentinel transaction was accepted. Child-message reconciliation and target-state verification are required.

