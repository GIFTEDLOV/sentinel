import { describe, expect, it } from "vitest";
import { normalizeUserError } from "./user-errors";

describe("user-facing error normalization", () => {
  it("translates wallet network failures without exposing them as the primary message", () => {
    const result = normalizeUserError(new Error("Wallet is on chain 1; switch to 61997."), "wallet");
    expect(result.title).toBe("Wrong network");
    expect(result.message).toBe("Sentinel operates on GenLayer Studio Next.");
    expect(result.technical).toContain("chain 1");
  });

  it("translates a cooldown failure into a recovery action", () => {
    const result = normalizeUserError(new Error("Recovery cooldown has not elapsed"), "transaction");
    expect(result.title).toBe("Recovery isn't available yet");
    expect(result.action).toBe("Review the recovery guardian");
  });

  it("keeps consensus and execution failures distinct", () => {
    expect(normalizeUserError(new Error("Consensus disagreement"), "transaction").title).toBe("Validators could not reach agreement");
    expect(normalizeUserError(new Error("FINISHED_WITH_ERROR"), "transaction").title).toBe("Transaction did not execute successfully");
  });
});
