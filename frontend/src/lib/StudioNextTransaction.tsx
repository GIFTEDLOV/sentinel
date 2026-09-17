import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { FeeReceipt, HoldToSign, VerifyBadge } from "@genlayer/transaction-kit-react";
import type { PolicyQuote, SubmitInput } from "@genlayer/transaction-kit";
import { getEthereumProvider, GENLAYER_CHAIN_NAME, GenLayerClient, sentinelClientConfig } from "./genlayer-client";
import { createStudioNextClient } from "./genlayer-transport";
import { createActiveTransactionRunner, estimateActiveTransaction } from "./active-transaction";
import { SHARED_GENLAYER_CHAIN } from "./genlayer-network";
import {
  LocalStoragePendingTransactionStore,
  TransactionFailedError,
  TransactionPendingError,
  TransactionStateVerificationError,
  type PendingTransaction,
} from "./transaction-lifecycle";
import { useTransactionKit } from "./transaction-kit";
import { normalizeUserError, presentUserError, type UserFacingError } from "./user-errors";

interface StudioNextTransactionProps {
  address: string;
  method: string;
  args: readonly unknown[];
  prepare: () => Promise<void>;
  readback: () => Promise<unknown>;
  onVerified: () => void;
  label: string;
}

type TransactionPhase = "idle" | "preparing" | "review" | "approval" | "tracking" | "verification" | "complete" | "error";

function chainNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  return value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
}

function operationContext(address: string, method: string, args: readonly unknown[]): string {
  return `${address.toLowerCase()}|${method}|${args.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join("|")}`;
}

export function studioNextOperationId(address: string, method: string, args: readonly unknown[]): string {
  return `studio-next:${SHARED_GENLAYER_CHAIN.id}:${operationContext(address, method, args)}`;
}

function TransactionStages({ phase }: { phase: TransactionPhase }): ReactElement {
  const current = phase === "preparing" || phase === "review" ? 0 : phase === "approval" ? 1 : phase === "tracking" || phase === "verification" ? 2 : phase === "complete" ? 5 : -1;
  return <ol className="transaction-stages" aria-label="Transaction progress"><li className={current > 0 || phase === "complete" ? "complete" : current === 0 ? "current" : ""}>Preparing</li><li className={current > 1 || phase === "complete" ? "complete" : current === 1 ? "current" : ""}>Review fee / approval</li><li className={current > 2 || phase === "complete" ? "complete" : current === 2 ? "current" : ""}>Submitted</li><li className={current > 3 || phase === "complete" ? "complete" : ""}>Consensus</li><li className={current > 4 || phase === "complete" ? "complete" : ""}>Finalized</li><li className={phase === "complete" ? "complete" : phase === "verification" ? "current" : ""}>State verified</li></ol>;
}

function TransactionNotice({ status, action }: { status: UserFacingError; action?: ReactNode }): ReactElement {
  const view = presentUserError(status);
  return <div className={`transaction-notice notice-${view.tone}`} role={view.tone === "error" ? "alert" : "status"} aria-live="polite"><div><strong>{view.title}</strong><p>{view.message}</p>{view.action ? <small className="notice-action">{view.action}</small> : null}{action ? <div className="transaction-notice-action">{action}</div> : null}</div>{view.technical ? <details><summary>Technical details</summary><code>{view.technical}</code></details> : null}</div>;
}

function initialRecoveryStatus(pending: PendingTransaction | null): UserFacingError | null {
  return pending ? {
    title: "Transaction found",
    message: "A previous submission is preserved. Resume it to check the same hash; no new transaction will be sent.",
    tone: "information",
  } : null;
}

export function StudioNextTransaction({
  address,
  method,
  args,
  prepare,
  readback,
  onVerified,
  label,
}: StudioNextTransactionProps): ReactElement {
  const context = useMemo(() => operationContext(address, method, args), [address, method, args]);
  const operationId = useMemo(() => studioNextOperationId(address, method, args), [address, method, args]);
  const transaction = useMemo<SubmitInput>(() => ({ kind: "write", address: address as `0x${string}`, method, args: [...args] }), [address, method, args]);
  const store = useMemo(() => new LocalStoragePendingTransactionStore(), []);
  const client = useMemo(() => new GenLayerClient(createStudioNextClient()), []);
  const [pending, setPending] = useState<PendingTransaction | null>(() => store.get(operationId));
  const [account, setAccount] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [quote, setQuote] = useState<PolicyQuote | null>(null);
  const [estimateAttempt, setEstimateAttempt] = useState(0);
  const [status, setStatus] = useState<UserFacingError | null>(() => initialRecoveryStatus(pending));
  const [phase, setPhase] = useState<TransactionPhase>(() => pending ? "tracking" : "idle");
  const [busy, setBusy] = useState(false);
  const [retryPreparation, setRetryPreparation] = useState(false);
  const [retryReconciliation, setRetryReconciliation] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(() => pending?.hash ?? null);
  const running = useRef(false);
  const kit = useTransactionKit(account);

  useEffect(() => {
    const next = store.get(operationId);
    setPending(next);
    setLastHash(next?.hash ?? null);
    setPrepared(false);
    setQuote(null);
    setPhase(next ? "tracking" : "idle");
    setRetryPreparation(false);
    setRetryReconciliation(Boolean(next));
    setStatus(initialRecoveryStatus(next));
  }, [operationId, store]);

  const prepareTransaction = async () => {
    const existing = store.get(operationId);
    if (existing) {
      setPending(existing);
      setLastHash(existing.hash);
      setRetryReconciliation(true);
      setPhase("tracking");
      return;
    }
    const provider = getEthereumProvider();
    if (!provider) {
      setStatus(normalizeUserError(new Error("Wallet unavailable."), "wallet"));
      setRetryPreparation(true);
      return;
    }
    setBusy(true);
    setRetryPreparation(false);
    setRetryReconciliation(false);
    setPhase("preparing");
    setStatus({ title: "Preparing", message: "Checking the wallet network and live contract preconditions.", tone: "information" });
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Wallet approval did not return a signing account.");
      const chain = chainNumber(await provider.request({ method: "eth_chainId" }));
      if (chain !== sentinelClientConfig.chainId) throw new Error(`Wallet is on chain ${chain ?? "unknown"}; switch to ${sentinelClientConfig.chainId}.`);
      await prepare();
      setAccount(accounts[0]);
      setPrepared(true);
      setStatus({ title: "Preparing fee review", message: "Building a live fee quote before wallet approval.", tone: "information" });
    } catch (reason: unknown) {
      setPrepared(false);
      setAccount(null);
      setQuote(null);
      setPhase("idle");
      setStatus(normalizeUserError(reason, "transaction"));
      setRetryPreparation(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!prepared || !kit || pending || phase === "tracking" || phase === "verification") return;
    let active = true;
    setBusy(true);
    setPhase("preparing");
    setStatus({ title: "Preparing fee review", message: "Reading live Studio Next fee policy before approval.", tone: "information" });
    void estimateActiveTransaction(kit, transaction).then((next) => {
      if (!active) return;
      setQuote(next);
      setPhase("review");
      setStatus({ title: "Review fee", message: "The live fee quote is ready. Approve this transaction once in your wallet.", tone: "information" });
      setRetryPreparation(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setPrepared(false);
      setAccount(null);
      setQuote(null);
      setPhase("idle");
      setStatus(normalizeUserError(reason, "transaction"));
      setRetryPreparation(true);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [estimateAttempt, kit, pending, phase, prepared, transaction]);

  const retryFeeQuote = () => {
    if (pending) return;
    setQuote(null);
    setRetryPreparation(false);
    setEstimateAttempt((value) => value + 1);
  };

  const runTransaction = async () => {
    if (running.current) return;
    const existing = store.get(operationId);
    if (!existing && (!kit || !quote)) return;
    running.current = true;
    setBusy(true);
    setRetryPreparation(false);
    setRetryReconciliation(false);
    setPhase(existing ? "tracking" : "approval");
    setStatus(existing ? {
      title: "Checking transaction",
      message: "Reconnecting to the original submission. No new transaction will be sent.",
      tone: "information",
    } : {
      title: "Approve in wallet",
      message: "Review the fee and approve once. Sentinel will preserve the returned hash before reconciliation.",
      tone: "information",
    });
    try {
      const runner = createActiveTransactionRunner({
        operationId,
        network: GENLAYER_CHAIN_NAME,
        chainId: SHARED_GENLAYER_CHAIN.id,
        action: method,
        context,
        kit,
        quote,
        transaction,
        preconditionRead: prepare,
        readFinalState: readback,
        onHash: (next) => {
          setPending(next);
          setLastHash(next.hash);
          setPhase("tracking");
          setStatus({ title: "Transaction submitted", message: "The original transaction is being reconciled. No second submission will be made.", tone: "information", technical: next.hash });
        },
        onLifecycle: (lifecycle) => {
          setLastHash(lifecycle.hash);
          if (lifecycle.status === "FINALIZED" && lifecycle.executionSucceeded === true) {
            setPhase("verification");
            setStatus({ title: "Execution succeeded", message: "The transaction finalized successfully. Reading back the expected contract state before completion.", tone: "information", technical: lifecycle.hash });
          } else if (lifecycle.status === "FINALIZED" || lifecycle.status === "FAILED") {
            setPhase("error");
          } else {
            setPhase("tracking");
            setStatus({ title: "Checking transaction", message: "Sentinel is reconciling the original transaction.", tone: "information", technical: lifecycle.hash });
          }
        },
      }, { store, client });
      await runner.execute();
      setPending(null);
      setLastHash(null);
      setPhase("complete");
      setStatus({ title: `${label} complete`, message: "Finality, execution, and state readback are verified.", tone: "success" });
      onVerified();
    } catch (reason: unknown) {
      const unresolved = store.get(operationId);
      setPending(unresolved);
      if (reason instanceof TransactionPendingError) {
        setPhase("tracking");
        setRetryReconciliation(true);
        setStatus({ title: "Transaction still pending", message: "Finality is not confirmed yet. The original hash is preserved for another check.", tone: "warning", technical: reason.hash });
      } else if (reason instanceof TransactionFailedError) {
        setPrepared(false);
        setAccount(null);
        setQuote(null);
        setPhase("error");
        setRetryReconciliation(false);
        setStatus({ title: "Transaction execution failed", message: "The transaction finalized, but the contract operation did not succeed. No new transaction was sent.", tone: "error", technical: reason.lifecycle.hash });
      } else if (reason instanceof TransactionStateVerificationError) {
        setPhase("verification");
        setRetryReconciliation(Boolean(unresolved));
        setStatus(normalizeUserError(reason, "state"));
      } else if (unresolved) {
        setPhase("verification");
        setRetryReconciliation(true);
        setStatus(normalizeUserError(reason, "state"));
      } else {
        setPrepared(false);
        setAccount(null);
        setQuote(null);
        setPhase("idle");
        setRetryPreparation(true);
        setStatus(normalizeUserError(reason, "transaction"));
      }
    } finally {
      setBusy(false);
      running.current = false;
    }
  };

  const retryPreparationAction = retryPreparation ? <button className="button button-quiet button-small" type="button" disabled={busy} onClick={() => void prepareTransaction()}>Retry preparation</button> : undefined;
  const retryReconciliationAction = retryReconciliation ? <button className="button button-quiet button-small" type="button" disabled={busy} onClick={() => void runTransaction()}>{phase === "verification" ? "Retry verification" : "Check transaction"}</button> : undefined;

  if (pending) {
    return <div className="transaction-action"><TransactionStages phase={phase} /><TransactionNotice status={status ?? initialRecoveryStatus(pending)!} action={retryReconciliationAction ?? (!busy ? <button className="button button-quiet button-small" type="button" onClick={() => void runTransaction()}>Resume transaction</button> : undefined)} /><small className="mono transaction-hash">Same hash: {lastHash ?? pending.hash}</small></div>;
  }

  if (!prepared || !kit) {
    return <div className="transaction-action">{status ? <TransactionNotice status={status} action={retryPreparationAction} /> : <button className="button" disabled={busy} onClick={() => void prepareTransaction()} type="button">{busy ? "Preparing…" : label}</button>}</div>;
  }

  if (!quote) {
    return <div className="transaction-action"><TransactionStages phase="preparing" /><TransactionNotice status={status ?? { title: "Preparing fee review", message: "Reading live Studio Next fee policy.", tone: "information" }} action={!busy ? <button className="button button-quiet button-small" type="button" onClick={retryFeeQuote}>Retry estimate</button> : undefined} /></div>;
  }

  const verification = kit.verification(quote, transaction);
  const verificationBlocked = quote.verification.status === "mismatch" && !kit.allowUnverified;
  return <div className="transaction-action"><TransactionStages phase="review" /><FeeReceipt quote={quote} busy={busy} /><VerifyBadge feeConfigHash={verification.feeConfigHash} status={quote.verification.status} />{status ? <TransactionNotice status={status} action={verificationBlocked ? <button className="button button-quiet button-small" type="button" disabled={busy} onClick={retryFeeQuote}>Re-estimate</button> : retryPreparationAction} /> : null}<HoldToSign onConfirm={() => void runTransaction()} disabled={busy || verificationBlocked} label="Approve & sign" /><small className="transaction-safety-note">No approval means no broadcast. After submission, recovery always checks the same persisted hash.</small></div>;
}
