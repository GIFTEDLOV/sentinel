import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const EXPECTED_CHAIN_ID = 61997;
const EXPECTED_ACCOUNT = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const DIAGNOSTIC = "0xb53Bc3307491Ac7f9557daA472bc196fF4b6c6A7";
const PROFILE_PATH = `${ROOT}/deploy/fee-profile.json`;
const EVIDENCE_PATH = `${ROOT}/deploy/evidence/hosted_advisory_get_runtime.json`;

async function loadInstalledSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const lastInit = source.lastIndexOf("initializeCLI();");
  if (lastInit < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, lastInit) + source.slice(lastInit + "initializeCLI();".length);
  const bundleFileUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleFileUrl)}).href`);
  transformed = transformed.replace(
    /export \{\s*initializeCLI\s*\};\s*$/m,
    "export { createClient2, studioDevnet, BaseAction };"
  );
  const requireFromBundle = createRequire(bundlePath);
  const builtins = new Set([
    "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises",
    "http", "https", "module", "net", "os", "path", "process", "stream",
    "stream/promises", "string_decoder", "tty", "url", "util", "zlib"
  ]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    const resolved = requireFromBundle.resolve(spec);
    return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function field(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) return value[name];
  }
  return null;
}

function receiptSummary(receipt) {
  return {
    status: field(receipt, ["statusName", "status_name", "status"]),
    consensus: field(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]),
    execution: field(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]),
  };
}

function requireSuccess(receipt) {
  const result = receiptSummary(receipt);
  const status = String(result.status ?? "").toUpperCase();
  const consensus = String(result.consensus ?? "").toUpperCase();
  const execution = String(result.execution ?? "").toUpperCase();
  if (status !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(consensus) || execution !== "FINISHED_WITH_RETURN") {
    throw new Error(`hosted advisory GET probe did not finish successfully: ${JSON.stringify(result)}`);
  }
  return result;
}

async function preflight(client, account) {
  const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = {
    network: "studio-dev",
    rpc: RPC,
    chainId: Number.parseInt(chainIdHex, 16),
    account: account.address,
    balanceWei: BigInt(balanceHex).toString(),
    latestNonce: Number.parseInt(latestHex, 16),
    pendingNonce: Number.parseInt(pendingHex, 16),
  };
  if (result.chainId !== EXPECTED_CHAIN_ID) throw new Error(`unexpected chain id ${result.chainId}`);
  if (result.account.toLowerCase() !== EXPECTED_ACCOUNT) throw new Error(`unexpected account ${result.account}`);
  if (result.latestNonce !== result.pendingNonce) throw new Error(`nonce mismatch ${result.latestNonce}/${result.pendingNonce}`);
  return result;
}

function profileOptions(profile) {
  const appealRounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return {
    leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation),
    appealRounds,
    executionBudgetPerRound: BigInt(profile.executionBudgetPerRound),
    totalMessageFees: BigInt(profile.totalMessageFees ?? 0),
    rotations: Array.from({ length: Number(appealRounds) + 1 }, () => rotation),
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
    transactionHashVariant: "latest-nonfinal",
  };
}

async function persist(value) {
  await writeFile(EVIDENCE_PATH, JSON.stringify(jsonSafe(value), null, 2) + "\n", "utf8");
}

const { createClient2, studioDevnet, BaseAction } = await loadInstalledSdk();
const account = await new BaseAction().getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const profileDocument = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
const profile = profileDocument.deploy;
if (!profile || profileDocument.chainId !== EXPECTED_CHAIN_ID) throw new Error("invalid measured deploy profile");
const options = profileOptions(profile);
const before = await preflight(client, account);
const currentPolicy = await client.getCurrentFeePolicy();
const probeFees = await client.estimateTransactionFeesForWrite({
  account,
  address: DIAGNOSTIC,
  functionName: "probe",
  args: [],
  ...options,
});
if (BigInt(probeFees.feeValue) <= 0n) throw new Error("probe fee quote is zero");
const simulation = await client.simulateWriteContract({
  account,
  address: DIAGNOSTIC,
  functionName: "probe",
  args: [],
  fees: probeFees,
  includeReceipt: true,
  transactionHashVariant: "latest-nonfinal",
});
console.log(JSON.stringify({ event: "PROBE_PREFLIGHT_AND_SIMULATION", preflight: before, profile, currentPolicy: jsonSafe(currentPolicy), probeFees: jsonSafe(probeFees), simulation: jsonSafe(simulation) }));

const beforeBroadcast = await preflight(client, account);
const probeTx = await client.writeContract({ account, address: DIAGNOSTIC, functionName: "probe", args: [], fees: probeFees });
console.log(JSON.stringify({ event: "PROBE_BROADCAST_RETURNED", evmHash: probeTx }));
await persist({ diagnosticAddress: DIAGNOSTIC, probePreflight: beforeBroadcast, probeFees, probeEvmHash: probeTx, profile, currentPolicy });

const probeReceipt = await client.waitForTransactionReceipt({ hash: probeTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
const finalResult = requireSuccess(probeReceipt);
console.log(JSON.stringify({ event: "PROBE_RECONCILED", evmHash: probeTx, receipt: finalResult }));
await persist({ diagnosticAddress: DIAGNOSTIC, probePreflight: beforeBroadcast, probeFees, probeEvmHash: probeTx, probeReceipt: finalResult, profile, currentPolicy, result: "PASS" });
