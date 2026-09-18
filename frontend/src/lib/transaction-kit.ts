import { useMemo } from "react";
import { createTransactionKit, type SubmitInput, type TransactionKit } from "@genlayer/transaction-kit";
import { getEthereumProvider } from "./genlayer-client";
import { SHARED_GENLAYER_CHAIN } from "./genlayer-network";

export function useTransactionKit(account: string | null): TransactionKit | null {
  const provider = getEthereumProvider();
  return useMemo(() => {
    if (!provider || !account?.startsWith("0x")) return null;
    return createTransactionKit({
      chain: SHARED_GENLAYER_CHAIN,
      provider,
      account: account as `0x${string}`,
    });
  }, [account, provider]);
}

export function createWriteTransaction(
  address: string,
  method: string,
  args: readonly unknown[],
): SubmitInput {
  return {
    kind: "write",
    address: address as `0x${string}`,
    method,
    args: [...args],
  };
}

