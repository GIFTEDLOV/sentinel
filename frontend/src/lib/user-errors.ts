export type UserErrorTone = "information" | "warning" | "error" | "success";

export interface UserFacingError {
  title: string;
  message: string;
  action?: string;
  technical?: string;
  tone: UserErrorTone;
}

type ErrorContext = "wallet" | "transaction" | "state";

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown Sentinel error.";
}

export function normalizeUserError(reason: unknown, context: ErrorContext = "transaction"): UserFacingError {
  const technical = errorMessage(reason);
  const message = technical.toLowerCase();

  if (message.includes("4902") || message.includes("wrong network") || message.includes("chain ") || message.includes("studio next")) {
    return {
      title: "Wrong network",
      message: "Sentinel operates on GenLayer Studio Next.",
      action: "Switch network",
      technical,
      tone: "warning",
    };
  }
  if (message.includes("4001") || message.includes("user rejected") || message.includes("rejected") || message.includes("cancelled") || message.includes("canceled") || message.includes("signature")) {
    return {
      title: "Transaction cancelled",
      message: "Your wallet did not approve the transaction.",
      technical,
      tone: "warning",
    };
  }
  if (message.includes("cooldown") || message.includes("not elapsed") || message.includes("too early")) {
    return {
      title: "Recovery isn't available yet",
      message: "The safety cooldown must finish before recovery can be assessed.",
      action: "Review the recovery guardian",
      technical,
      tone: "information",
    };
  }
  if (message.includes("evidence") && (message.includes("insufficient") || message.includes("required") || message.includes("quorum"))) {
    return {
      title: "More evidence is required",
      message: "Sentinel requires two fresh, independent evidence sources before assessment.",
      action: "Review evidence coverage",
      technical,
      tone: "warning",
    };
  }
  if (message.includes("consensus") || message.includes("majority_disagree") || message.includes("no majority")) {
    return {
      title: "Validators could not reach agreement",
      message: "No protocol action was taken. The incident remains unresolved.",
      action: "Review the incident evidence",
      technical,
      tone: "warning",
    };
  }
  if (message.includes("execution") || message.includes("finished_with_error")) {
    return {
      title: "Transaction did not execute successfully",
      message: "The network finalized the transaction, but the expected contract operation failed.",
      action: "Reconcile the same transaction",
      technical,
      tone: "error",
    };
  }
  if (context === "state" || message.includes("readback") || message.includes("state verification")) {
    return {
      title: "State verification failed",
      message: "The transaction completed, but Sentinel could not confirm the expected on-chain state.",
      action: "Refresh and reconcile the same transaction",
      technical,
      tone: "error",
    };
  }
  if (context === "wallet" && (message.includes("wallet") || message.includes("account"))) {
    return {
      title: "Wallet connection unavailable",
      message: "Connect an EIP-1193 wallet to continue this write workflow.",
      action: "Connect wallet",
      technical,
      tone: "warning",
    };
  }
  return {
    title: "Sentinel needs attention",
    message: "Sentinel could not complete this action.",
    action: "Review technical details",
    technical,
    tone: "error",
  };
}

/** Presentation copy for normal users; technical classification remains intact. */
export function presentUserError(error: UserFacingError): UserFacingError {
  if (error.title === "Transaction did not execute successfully") {
    return { ...error, title: "Transaction could not be completed", message: "The network finalized the request, but the contract operation did not succeed." };
  }
  if (error.title === "State verification failed") {
    return { ...error, title: "Transaction verification failed", message: "Sentinel could not confirm the expected state after finality." };
  }
  return error;
}
