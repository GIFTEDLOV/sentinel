import { describe, expect, it } from "vitest";
import { csvToIds, decodeDecisionInput, decodeIncident, decodeProtocol, decodeProtectedDemoState, mapIncidentStateToLabel } from "./decoders";

describe("chain data decoders", () => {
  it("normalizes GenLayer snake_case and JSON-safe numeric values", () => {
    const protocol = decodeProtocol({
      target_address: "0x1111111111111111111111111111111111111111",
      owner: "0x2222222222222222222222222222222222222222",
      policy_locked: true,
      critical_failure_class: "unauthorized-drain",
      allowed_source_domains: "explorer.example,advisory.example",
      minimum_sources: "2",
      max_evidence_age_seconds: 86400n,
      recovery_cooldown_seconds: 0,
    }, "demo");
    expect(protocol.protocolId).toBe("demo");
    expect(protocol.minimumSources).toBe(2);
    expect(protocol.policyLocked).toBe(true);
  });

  it("maps unknown verdicts and states to the fail-closed UI values", () => {
    const incident = decodeIncident({ state: "UNKNOWN", incident_verdict: "UNKNOWN", recovery_verdict: "UNKNOWN" }, "i-1");
    expect(incident.state).toBe("ASSESSING");
    expect(incident.incidentVerdict).toBe("INCONCLUSIVE");
    expect(incident.recoveryVerdict).toBe("INCONCLUSIVE");
    expect(mapIncidentStateToLabel("RECOVERY_ASSESSING")).toBe("RECOVERY ASSESSING");
  });

  it("preserves affirmative, paused, inconclusive, and recovery states for rendering", () => {
    const active = decodeIncident({ state: "ACTIVE_INCIDENT", incident_verdict: "ACTIVE_INCIDENT" }, "i-active");
    const paused = decodeIncident({ state: "PAUSED", incident_verdict: "ACTIVE_INCIDENT" }, "i-paused");
    const recovery = decodeIncident({ state: "RECOVERY_AUTHORIZED", recovery_verdict: "SAFE_TO_RECOVER" }, "i-recovery");
    expect(active.incidentVerdict).toBe("ACTIVE_INCIDENT");
    expect(paused.state).toBe("PAUSED");
    expect(recovery.state).toBe("RECOVERY_AUTHORIZED");
    expect(recovery.recoveryVerdict).toBe("SAFE_TO_RECOVER");
  });

  it("decodes the target readback without inventing pause state", () => {
    const target = decodeProtectedDemoState("0x3333333333333333333333333333333333333333", {
      owner: "0x1",
      authorizedSentinel: "0x2",
      controllerConfigured: true,
      paused: false,
      totalProcessed: "7",
    });
    expect(target.paused).toBe(false);
    expect(target.totalProcessed).toBe(7);
  });

  it("parses only explicitly configured csv identifiers", () => {
    expect(csvToIds("incident-1, incident-2,,")).toEqual(["incident-1", "incident-2"]);
  });

  it("decodes the authentication boundary without inventing missing commitments", () => {
    const incident = decodeIncident({
      state: "ASSESSING",
      incident_authentication_state: "BLOCKED",
      incident_authentication_block_code: "SOURCE_UNAVAILABLE",
      incident_assessment_id: "",
    }, "incident-blocked");
    const legacy = decodeDecisionInput({});
    expect(incident.incidentAuthenticationState).toBe("BLOCKED");
    expect(incident.incidentAuthenticationBlockCode).toBe("SOURCE_UNAVAILABLE");
    expect(legacy.questionVersion).toBe("LEGACY / NOT RECORDED");
    expect(legacy.decisionInputHash).toBe("");
    expect(legacy.authenticationState).toBe("LEGACY");
  });
});
