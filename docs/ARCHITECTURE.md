# Sentinel Contract Architecture

## Emergency path

```text
Protected protocol policy lock
        ↓
Incident + phase-correct evidence binding
        ↓
Canonical RPC/advisory authentication
        ↓
Assessment-time freshness + distinct-host quorum
        ↓
GenLayer bounded semantic consensus
        ↓
ACTIVE_INCIDENT
        ↓
finalized emergency_pause request
        ↓
target is_paused() readback
        ↓
PAUSED
```

## Recovery path

```text
positive cooldown elapsed
        ↓
new RECOVERY evidence only
        ↓
canonical remediation transaction + linked advisory authentication
        ↓
fresh recovery consensus
        ↓
RECOVERY_AUTHORIZED
        ↓
finalized emergency_unpause request
        ↓
target is_paused() == false readback
        ↓
RECOVERED
```

## Policy identity

Each protocol stores its target, owner, failure class, approved source hosts,
host/path prefixes, canonical RPC endpoint, source quorum, freshness window,
recovery cooldown, and permanent lock state. Source paths are segment-safe and
queries/fragments are rejected. The endpoint is policy-bound rather than chosen
by evidence submitters.

## Evidence roles

`CHAIN_TRANSACTION` is a narrow objective adapter for canonical GenLayer
transaction facts. `SECURITY_ADVISORY` carries protocol-owned context under a
locked HTTPS path prefix. The roles are not interchangeable, and the advisory
must deterministically reference the same transaction hash.

## Target interface

The reusable contract interface remains deliberately small:

```text
emergency_pause()
emergency_unpause()
is_paused()
```

ProtectedDemo additionally exposes its own treasury, outflow, and remediation
views for the showcase; Sentinel does not depend on them.

## Frontend boundary

The frontend must reconcile writes as:

```text
precondition → broadcast once → persist hash → reconcile same hash
→ FINALIZED + successful execution → read target state → next action
```

The contract does not add unbounded enumeration, event history, or verbose
model prose. A labeled off-chain proof projection may index transaction hashes,
evidence records, and lifecycle history while the contract views remain the
authoritative source for current state.
