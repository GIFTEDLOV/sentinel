import { describe, expect, it } from "vitest";
import type { EvidenceFormValues } from "./evidence-form";
import { validateEvidenceForm } from "./evidence-form";

const valid: EvidenceFormValues = {
  evidenceId: "evidence-1",
  phase: "EMERGENCY",
  evidenceType: "TRANSACTION",
  sourceUrl: "https://explorer.example/tx/1",
  failureClass: "unauthorized-drain",
  contentDigest: "a".repeat(64),
  transactionHash: `0x${"b".repeat(64)}`,
  transactionBlock: "123",
  transactionInput: "0x1234",
};

describe("evidence form validation", () => {
  it("accepts the contract's bounded evidence shape", () => {
    expect(validateEvidenceForm(valid)).toEqual([]);
  });

  it("rejects non-HTTPS, malformed digests, and missing associations", () => {
    expect(validateEvidenceForm({ ...valid, sourceUrl: "http://untrusted.example/a", contentDigest: "bad", transactionBlock: "0" })).toEqual([
      "Evidence source must be canonical HTTPS.",
      "Content digest must be SHA-256 hex.",
      "Transaction block must be a non-negative integer and is required for non-chain evidence.",
    ]);
  });
});
