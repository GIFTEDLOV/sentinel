export interface EvidenceFormValues {
  evidenceId: string;
  phase: "EMERGENCY" | "RECOVERY";
  evidenceType: "TRANSACTION" | "CHAIN_TRANSACTION" | "PROTECTED_STATE" | "SECURITY_ADVISORY";
  sourceUrl: string;
  failureClass: string;
  contentDigest: string;
  transactionHash: string;
  transactionBlock: string;
  transactionInput: string;
}

export function validateEvidenceForm(values: EvidenceFormValues): string[] {
  const errors: string[] = [];
  if (!/^[^,\s]{1,96}$/.test(values.evidenceId)) errors.push("Evidence id must be a short identifier without commas.");
  if (!values.sourceUrl.startsWith("https://") || /[ ?#]/.test(values.sourceUrl)) errors.push("Evidence source must be canonical HTTPS.");
  if (!values.failureClass.trim()) errors.push("Failure class is required.");
  if (!/^([a-fA-F0-9]{64})$/.test(values.contentDigest)) errors.push("Content digest must be SHA-256 hex.");
  const transactionHash = values.transactionHash.startsWith("0x") ? values.transactionHash.slice(2) : values.transactionHash;
  if (!/^[a-fA-F0-9]{64}$/.test(transactionHash)) errors.push("Transaction hash must be a 32-byte hash.");
  if (values.evidenceType === "CHAIN_TRANSACTION" && !/^0x[0-9a-fA-F]*$/.test(values.transactionInput)) errors.push("Chain transaction calldata must be canonical hex.");
  const block = Number(values.transactionBlock);
  if (!Number.isSafeInteger(block) || block < 0 || (values.evidenceType !== "CHAIN_TRANSACTION" && block === 0)) errors.push("Transaction block must be a non-negative integer and is required for non-chain evidence.");
  return errors;
}
