import { createClient } from "genlayer-js";
import {
  executionResultNumberToName,
  transactionsStatusNumberToName,
  type CalldataEncodable,
  type GenLayerTransaction,
} from "genlayer-js/types";
import type {
  ContractReadRequest,
  GenLayerTransport,
  TransactionHash,
  TransactionLifecycle,
} from "./genlayer-client";
import { SHARED_GENLAYER_CHAIN } from "./genlayer-network";

type SdkAddress = `0x${string}`;
type SdkHash = `0x${string}` & { length: 66 };

function address(value: string): SdkAddress {
  return value as SdkAddress;
}

function hash(value: string): SdkHash {
  return value as SdkHash;
}

function sdkArgs(args: readonly unknown[] | undefined): CalldataEncodable[] | undefined {
  return args?.map((value) => value as CalldataEncodable);
}

function namedStatus(transaction: GenLayerTransaction): string | undefined {
  if (transaction.statusName) return transaction.statusName;
  if (typeof transaction.status === "number") {
    return transactionsStatusNumberToName[String(transaction.status) as keyof typeof transactionsStatusNumberToName];
  }
  return typeof transaction.status === "string" ? transaction.status : undefined;
}

function namedExecution(transaction: GenLayerTransaction): string | undefined {
  if (transaction.txExecutionResultName) return transaction.txExecutionResultName;
  if (typeof transaction.txExecutionResult === "number") {
    return executionResultNumberToName[String(transaction.txExecutionResult) as keyof typeof executionResultNumberToName];
  }
  return undefined;
}

function executionSucceeded(transaction: GenLayerTransaction): boolean | null {
  const execution = namedExecution(transaction);
  if (execution === "FINISHED_WITH_RETURN") return true;
  if (execution === "FINISHED_WITH_ERROR") return false;
  const result = transaction.resultName;
  if (result === "MAJORITY_DISAGREE" || result === "NO_MAJORITY" || result === "DISAGREE" || result === "TIMEOUT") {
    return false;
  }
  return null;
}

function lifecycleStatus(transaction: GenLayerTransaction): TransactionLifecycle["status"] {
  const status = namedStatus(transaction);
  if (status === "FINALIZED") return "FINALIZED";
  if (status === "CANCELED" || status === "VALIDATORS_TIMEOUT" || status === "LEADER_TIMEOUT") return "FAILED";
  if (status === "ACCEPTED") return "ACCEPTED";
  return "PENDING";
}

export class StudioNextGenLayerTransport implements GenLayerTransport {
  private readonly readClient = createClient({ chain: SHARED_GENLAYER_CHAIN });

  public async readContract<T>(request: ContractReadRequest): Promise<T> {
    return (await this.readClient.readContract({
      address: address(request.address),
      functionName: request.method,
      args: sdkArgs(request.args),
      jsonSafeReturn: true,
    })) as T;
  }

  public async getTransactionLifecycle(txHash: TransactionHash): Promise<TransactionLifecycle> {
    const transaction = await this.readClient.getTransaction({ hash: hash(txHash) });
    let triggeredTransactionHashes: TransactionHash[] | undefined;
    try {
      triggeredTransactionHashes = (await this.readClient.getTriggeredTransactionIds({
        hash: hash(txHash),
      })) as TransactionHash[];
    } catch {
      triggeredTransactionHashes = undefined;
    }
    return {
      hash: txHash,
      status: lifecycleStatus(transaction),
      executionSucceeded: executionSucceeded(transaction),
      triggeredTransactionHashes,
    };
  }
}

export function createStudioNextClient(): GenLayerTransport {
  return new StudioNextGenLayerTransport();
}
