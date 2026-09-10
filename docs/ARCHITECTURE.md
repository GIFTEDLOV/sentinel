# SENTINEL architecture

SENTINEL is a Project in the Autonomous Protocols track: it is a reusable emergency-defense layer with protocol registration, permissionless incident intake, deterministic evidence admission, GenLayer semantic adjudication, and a finalized cross-contract safety consequence. The two Intelligent Contracts are the protocol boundary and the demo target; the value of the project is the end-to-end trust and lifecycle guarantee between them.

Core sentence: **Anyone can raise the alarm. Only GenLayer consensus can pull the emergency brake.**

## Components and flow

```text
Reporter (untrusted)
        |
        | report_incident (permissionless; no target call)
        v
Sentinel (registration + admission + incident state)
        |
        | run_nondet_unsafe: leader and independent validators
        v
GenLayer validator consensus
        |
        | agreed ACTIVE_CRITICAL_EXPLOIT only
        | emit(on="finalized")
        v
ProtectedVault.sentinel_pause(incident_id)
```

`ProtectedVault` is deliberately vulnerable toy accounting used only for local GenLayer/Studio/testnet demonstration. It has no real token, production asset, or third-party dependency.

## Contract roles

### ProtectedVault

The vault owns the toy accounting balance and voucher state. Its owner creates vouchers and may apply the demonstration patch. The configured `sentinel_guardian` is the only caller accepted by `sentinel_pause` and `sentinel_resume`. The vault independently checks `gl.message.sender_address`, so a caller cannot impersonate the guardian merely by supplying a Sentinel-looking incident identifier.

In `vulnerable_mode`, redeeming a voucher does not permanently consume its identifier. A replay therefore reduces `total_demo_assets` again. `apply_demo_patch` switches to safe behavior; the same voucher cannot be redeemed twice after the patch. All redemption attempts are rejected while paused.

### Sentinel

Sentinel stores protocol registrations and incident cases. Registration identifies the target and the policy that existed before the incident. Reporting is permissionless but only creates an `OPEN` case after deterministic admission; it never calls the target.

Adjudication is the only operation that can produce a target consequence. It first checks deterministic admission metadata and then runs the same admitted, delimited evidence through a leader and independently evaluating validators. The contract stores only a validated decision-bearing object and bounded explanation metadata.

## Exact write/read lifecycle

1. A protocol owner registers a target, policy, canonical evidence source, and optional allowed origins. Registration is active only for bounded, valid inputs. Duplicate protocol identifiers are rejected.
2. A reporter submits a claim and evidence reference(s), plus deterministic evidence metadata where available. The reporter is not trusted to authenticate the evidence. Sentinel validates lengths, HTTPS, origin/destination rules, fingerprints, and availability classification. A canonical incident/evidence fingerprint prevents duplicate cases.
3. The admitted incident is stored as `OPEN`. No message is emitted and no target state changes.
4. An authorized adjudication caller selects an `OPEN` incident. Sentinel marks it `ADJUDICATING` before the non-deterministic decision. The decision prompt fixes the policy and output schema and labels every evidence field as untrusted data.
5. `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` executes the leader and independent validator evaluation. Both use `gl.nondet.exec_prompt(..., response_format="json")`. Validators reject malformed, unknown, out-of-range, inconsistent, or policy-changing output. Raw LLM output is never compared with `strict_eq`.
6. After the non-deterministic block returns, in deterministic execution Sentinel stores the agreed verdict and fields, marks the incident `DECIDED`, and records the decision metadata.
7. Only `ACTIVE_CRITICAL_EXPLOIT` schedules `ProtectedVault.sentinel_pause(incident_id)` with `on="finalized"`. `NO_CRITICAL_EXPLOIT` and `INSUFFICIENT_EVIDENCE` only store the decision. There is no accepted-phase pause.
8. The finalized child message reaches the vault asynchronously. The vault checks the exact configured guardian, applies an idempotent pause, and records `pause_incident_id`. A duplicate finalized message leaves the already-paused state unchanged.
9. Reads (`get_status`, `get_protocol`, `get_incident`, list views, and `contract_info`) expose the stored protocol, incident, target, and execution state. A client must reconcile GenLayer transaction status and execution result separately; a status alone is not success.

## ACCEPTED versus FINALIZED

`ACCEPTED` means validator consensus accepted an execution receipt while the appeal window can still be open. It is not final and does not prove that execution succeeded. `FINALIZED` means the decided receipt is no longer appealable; it still does not turn an execution error into success. A transaction is successful only when the lifecycle status is `ACCEPTED` or `FINALIZED` **and** the execution result is `FINISHED_WITH_RETURN`.

SENTINEL intentionally uses `on="finalized"` for the pause message. An accepted-phase message cannot be recalled if an appeal changes the parent result and can be emitted again on re-execution. Pausing is an irreversible safety consequence for the current incident, so it must wait for the finalized parent decision. The receiving vault remains idempotent as defense in depth.

## Evidence authentication before semantic adjudication

Evidence admission is a deterministic gate, not a semantic verdict. Sentinel bounds all fields, requires HTTPS for external references, rejects localhost and private-network destinations, validates canonical origins against the registration where configured, and stores deterministic hashes/fingerprints when supplied. Missing, unavailable, unverifiable, or ambiguous evidence is explicitly classified and cannot be upgraded to `ACTIVE_CRITICAL_EXPLOIT` by a prompt.

Admitted evidence is copied into a prompt as **UNTRUSTED DATA** inside explicit delimiters. It is never treated as instructions and cannot override the policy, schema, validator rules, or decision procedure. The MVP does not grant the LLM authority to define “critical”; it may only classify the fixed policy supplied by Sentinel.

## Deterministic and semantic checks

Deterministic checks include authorization, lifecycle transitions, duplicate fingerprints, input bounds, URL scheme/host restrictions, allowed origins, evidence availability classification, hash format, exact schema shape, enum membership, logical consistency, and all state/message writes. Semantic checks are limited to whether admitted evidence demonstrates the fixed `ACTIVE_CRITICAL_EXPLOIT` definition. The consensus comparison is over stable fields, not prose reasoning.

## Fail-closed behavior

Invalid input reverts. Missing or unavailable evidence yields `INSUFFICIENT_EVIDENCE`. A malformed leader result, unknown enum, inconsistent combination, validator disagreement, or unsupported external result is rejected or rotates consensus; it never produces a critical verdict. Storage writes and child-message emission occur only after the non-deterministic block returns an agreed, validated result.

## Threat boundaries

The reporter, reporter prose, evidence references, and evidence contents are untrusted. The protocol owner and Sentinel deployer are also untrusted with respect to manufacturing an exploit verdict. An administrator has no direct critical-verdict method. The target trusts only its configured guardian address for pause/resume. GenLayer consensus is the adjudication trust boundary; it is not bypassed by a single LLM, an EVM receipt, an accepted status, or a caller-selected boolean.

Phase 1 intentionally excludes production contracts, third-party scanning, real funds, frontend, authentication, wallets beyond contract testing, deployment, and arbitrary URL fetching.

