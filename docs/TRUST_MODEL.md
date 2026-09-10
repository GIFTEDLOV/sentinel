# SENTINEL trust model

SENTINEL is designed around a narrow authority rule:

> Anyone can raise the alarm. Only GenLayer consensus can pull the emergency brake.

## Actors and trust assumptions

- The reporter is untrusted. A reporter may submit false claims, duplicate submissions, hostile strings, prompt-injection text, or evidence they do not control.
- The protocol owner is untrusted with respect to manufacturing verdicts. Ownership permits registration and target maintenance, not setting `ACTIVE_CRITICAL_EXPLOIT`.
- The Sentinel deployer/operator is untrusted with respect to manufacturing verdicts. There is no hidden admin verdict method or emergency shortcut that impersonates consensus.
- Submitted evidence is untrusted data, never instructions. Text in a report cannot change the security policy, output schema, validator rules, or contract control flow.
- One LLM result is insufficient. The leader result must pass structural and logical validation and independent validators must re-evaluate the same admitted evidence.

## Authority and consequences

- Sentinel may pause a target only through a GenLayer-consensus-agreed decision whose child message is scheduled with `on="finalized"`.
- `ACCEPTED` is not `FINALIZED`; neither status alone proves successful execution. The client and integration tests must verify both lifecycle status and the execution result.
- The target accepts pause and resume commands only from its configured `sentinel_guardian`, checked from the authenticated GenLayer message sender.
- `report_incident` is permissionless and has no target side effect. A report is an input to adjudication, not an authorization to pause.
- `NO_CRITICAL_EXPLOIT` and `INSUFFICIENT_EVIDENCE` store decisions and emit no pause message.

## Evidence and policy invariants

- The registered policy is fixed and known before the incident. The MVP definition is: reliable evidence demonstrates an exploit currently actionable against the registered target that can cause unauthorized transfer/loss of protected assets, unauthorized privileged control, or material corruption of security-critical state.
- The LLM cannot invent a new definition of criticality. It must return a narrow enum-shaped object against that fixed policy.
- Ambiguous, missing, unavailable, unauthenticated, or otherwise insufficient evidence must never become `ACTIVE_CRITICAL_EXPLOIT`.
- URL admission requires bounded inputs, HTTPS, and rejection of local/private-network destinations. Canonical source and allowed-origin constraints are enforced deterministically where configured.
- Evidence hashes/fingerprints are integrity metadata, not proof of truth. Semantic adjudication still requires the consensus process.

## Consensus invariants

- Leader and validator logic use `gl.vm.run_nondet_unsafe` for the custom pattern. Each validator independently evaluates the same admitted evidence.
- Raw LLM output is never passed to `strict_eq`. Consensus compares validated decision-bearing fields: verdict, policy match, exploitability, and, for a critical result, impact class.
- Unknown keys, missing keys, wrong types, unknown enums, boundedness failures, and logically inconsistent fields are invalid. Disagreement rejects the result or causes rotation; broken output is not accepted.
- The leader and validator nondeterministic code performs no storage writes and emits no messages. Consequences happen deterministically after consensus returns.

## Target safety invariants

- `sentinel_pause` is guardian-only and idempotent. Duplicate finalized deliveries cannot corrupt target state.
- Redemption is rejected while paused, so the controlled replay exploit stops once the finalized pause reaches the vault.
- `apply_demo_patch` and voucher creation are owner-only, but neither can manufacture or substitute a GenLayer verdict.
- `sentinel_resume` is guardian-only and is implemented as an interface for Phase 2 recovery adjudication; it is not an administrator bypass.

## Scope boundary

This phase uses only a deliberately vulnerable toy `ProtectedVault` with internal demo accounting. It does not scan, exploit, or interact with third-party or production contracts and does not handle real user funds. The frontend, authentication, wallet UX, Bradbury deployment, Vercel deployment, and speculative features are out of scope.

