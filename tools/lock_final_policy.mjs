import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const ACCOUNT = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const SENTINEL = "0x2dF0E12D4CE46f0312B7461972351F3cD074b3c9";
const DEMO = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584";
const ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const DOMAINS = "studio-dev.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-dev.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const SENTINEL_SHA = "17B170A8394EDD250536937898EFF1FFD30AE8E90258E7578B8DD00E5FE1BD7D";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const PROFILE = ROOT + "/deploy/fee-profile.json";
const EVIDENCE = ROOT + "/deploy/evidence/final/FINAL_POLICY_LOCK.txt";

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL("file://" + bundlePath).href;
  transformed = transformed.replaceAll("import.meta.url", "new URL(" + JSON.stringify(bundleUrl) + ").href");
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    const resolved = req.resolve(spec);
    return p + q + new URL("file://" + resolved.replaceAll("\\", "/")).href + close;
  });
  return import("data:text/javascript;base64," + Buffer.from(transformed).toString("base64"));
}

function safe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) {
  return String(value).toLowerCase();
}

function preflight(client, account) {
  return Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]).then((v) => {
    const result = {
      network: "studio-dev", rpc: RPC, chainId: Number.parseInt(v[0], 16),
      account: account.address, balanceWei: BigInt(v[1]).toString(),
      latestNonce: Number.parseInt(v[2], 16), pendingNonce: Number.parseInt(v[3], 16),
      unknownPendingTransactions: "eth_pendingTransactions unsupported; latest==pending is the available gate",
    };
    if (result.chainId !== CHAIN_ID || lower(result.account) !== ACCOUNT || result.latestNonce !== result.pendingNonce) {
      throw new Error("account preflight gate failed");
    }
    return result;
  });
}

function feesFromProfile(profile) {
  const rounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return {
    leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation),
    appealRounds: rounds,
    executionBudgetPerRound: BigInt(profile.executionBudgetPerRound),
    totalMessageFees: BigInt(profile.totalMessageFees ?? 0),
    rotations: Array.from({ length: Number(rounds) + 1 }, () => rotation),
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
    transactionHashVariant: "latest-nonfinal",
  };
}

function roundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((v, i) => String(v) === String(args[i]))) {
    throw new Error(method + " calldata roundtrip failed");
  }
  return {
    method, exact: true, encodedHex: "0x" + Buffer.from(encoded).toString("hex"),
    decodedArgs: decoded.map((v) => typeof v === "bigint" ? v.toString() : v),
  };
}

function policyCheck(policy, locked) {
  const actual = {
    target_address: lower(policy.target_address),
    critical_failure_class: policy.critical_failure_class,
    allowed_source_domains: policy.allowed_source_domains,
    allowed_source_prefixes: policy.allowed_source_prefixes,
    canonical_rpc_endpoint: policy.canonical_rpc_endpoint,
    minimum_sources: String(policy.minimum_sources),
    max_evidence_age_seconds: String(policy.max_evidence_age_seconds),
    recovery_cooldown_seconds: String(policy.recovery_cooldown_seconds),
    policy_locked: policy.policy_locked,
  };
  const expected = {
    target_address: lower(DEMO), critical_failure_class: FAILURE,
    allowed_source_domains: DOMAINS, allowed_source_prefixes: PREFIX,
    canonical_rpc_endpoint: RPC, minimum_sources: "2",
    max_evidence_age_seconds: "3600", recovery_cooldown_seconds: "900",
    policy_locked: locked,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("policy field readback mismatch");
  return actual;
}

function terminal(receipt) {
  return {
    status: receipt.statusName ?? receipt.status_name ?? receipt.status ?? null,
    consensus: receipt.resultName ?? receipt.result_name ?? receipt.consensusStatus ?? receipt.consensus_status ?? null,
    execution: receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? receipt.txExecutionResult ?? null,
  };
}

function requireSuccess(receipt) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" ||
      !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) ||
      String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") {
    throw new Error("lock terminal-success gate failed: " + JSON.stringify(result));
  }
  return result;
}

async function read(client, address, method, args = []) {
  return client.readContract({ address, functionName: method, args, jsonSafeReturn: true });
}

async function writeEvidence(lines) {
  await writeFile(EVIDENCE, lines.join("\n") + "\n", "utf8");
}

const { createClient2, studioDevnet, BaseAction } = await loadSdk();
const account = await new BaseAction().getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const localSentinelSha = createHash("sha256").update(await readFile(ROOT + "/contracts/sentinel.py")).digest("hex").toUpperCase();
const localDemoSha = createHash("sha256").update(await readFile(ROOT + "/contracts/protected_demo.py")).digest("hex").toUpperCase();
if (localSentinelSha !== SENTINEL_SHA || localDemoSha !== DEMO_SHA) throw new Error("frozen source hash gate failed");

const policyBefore = policyCheck(await read(client, SENTINEL, "get_protocol", [ID]), false);
const lockPreflight = await preflight(client, account);
const args = [ID];
const calldata = roundtrip("lock_emergency_policy", args);
const profileDoc = JSON.parse(await readFile(PROFILE, "utf8"));
if (profileDoc.chainId !== CHAIN_ID || !profileDoc.deploy) throw new Error("invalid current fee profile");
const profileOptions = feesFromProfile(profileDoc.deploy);
const lockFees = await client.estimateTransactionFeesForWrite({
  account, address: SENTINEL, functionName: "lock_emergency_policy", args, ...profileOptions
});
if (BigInt(lockFees.feeValue) <= 0n) throw new Error("lock fee quote is zero");
const simulation = await client.simulateWriteContract({
  account, address: SENTINEL, functionName: "lock_emergency_policy", args,
  fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
});
console.log(JSON.stringify({
  event: "LOCK_PREFLIGHT", policyBefore, preflight: lockPreflight, calldata,
  fees: safe(lockFees), simulation: terminal(simulation.receipt || {})
}));

const beforeBroadcast = await preflight(client, account);
const lockTx = await client.writeContract({ account, address: SENTINEL, functionName: "lock_emergency_policy", args, fees: lockFees });
console.log(JSON.stringify({ event: "LOCK_BROADCAST_RETURNED", tx: lockTx }));
await writeEvidence([
  "FINAL POLICY LOCK",
  "SENTINEL_SHA: " + localSentinelSha,
  "PROTECTED_DEMO_SHA: " + localDemoSha,
  "NETWORK: studio-dev", "RPC: " + RPC, "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + beforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + beforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + beforeBroadcast.pendingNonce,
  "POLICY_BEFORE: " + JSON.stringify(policyBefore),
  "LOCK_CALLDATA_ROUNDTRIP: PASS", "LOCK_SIMULATION: PASS",
  "LOCK_FEE_VALUE: " + lockFees.feeValue,
  "LOCK_FEE_DISTRIBUTION: " + JSON.stringify(safe(lockFees.distribution)),
  "LOCK_TX: " + lockTx, "LOCK_BROADCAST_COUNT: 1",
]);

const receipt = await client.waitForTransactionReceipt({
  hash: lockTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true
});
const final = requireSuccess(receipt);
const policyAfter = policyCheck(await read(client, SENTINEL, "get_protocol", [ID]), true);

let updateSimulation = "REJECTED";
try {
  await client.simulateWriteContract({
    account, address: SENTINEL, functionName: "update_emergency_policy",
    args: [ID, FAILURE, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n],
    fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
  });
  updateSimulation = "UNEXPECTED_SUCCESS";
} catch {}
let secondLockSimulation = "REJECTED";
try {
  await client.simulateWriteContract({
    account, address: SENTINEL, functionName: "lock_emergency_policy", args,
    fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
  });
  secondLockSimulation = "UNEXPECTED_SUCCESS";
} catch {}

const protectedState = {
  owner: await read(client, DEMO, "get_owner"),
  authorized_sentinel: await read(client, DEMO, "get_authorized_sentinel"),
  controller_configured: await read(client, DEMO, "is_controller_configured"),
  paused: await read(client, DEMO, "is_paused"),
  remediated: await read(client, DEMO, "is_remediated"),
  treasury_state: await read(client, DEMO, "get_treasury_state"),
  total_processed: await read(client, DEMO, "get_total_processed"),
  pause_counters: await read(client, DEMO, "get_pause_counters"),
};
if (lower(protectedState.owner) !== ACCOUNT ||
    lower(protectedState.authorized_sentinel) !== lower(SENTINEL) ||
    protectedState.controller_configured !== true || protectedState.paused !== false ||
    protectedState.remediated !== false ||
    String(protectedState.treasury_state.treasury_balance) !== "1000" ||
    String(protectedState.treasury_state.total_outflow) !== "0" ||
    String(protectedState.total_processed) !== "0" ||
    String(protectedState.pause_counters.pause_count) !== "0" ||
    String(protectedState.pause_counters.unpause_count) !== "0") {
  throw new Error("ProtectedDemo post-lock state changed unexpectedly");
}
const after = await preflight(client, account);
await writeEvidence([
  "FINAL POLICY LOCK",
  "SENTINEL_SHA: " + localSentinelSha,
  "PROTECTED_DEMO_SHA: " + localDemoSha,
  "NETWORK: studio-dev", "RPC: " + RPC, "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + beforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + beforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + beforeBroadcast.pendingNonce,
  "POLICY_BEFORE: " + JSON.stringify(policyBefore),
  "LOCK_CALLDATA_ROUNDTRIP: PASS", "LOCK_SIMULATION: PASS",
  "LOCK_FEE_VALUE: " + lockFees.feeValue,
  "LOCK_FEE_DISTRIBUTION: " + JSON.stringify(safe(lockFees.distribution)),
  "LOCK_TX: " + lockTx, "LOCK_BROADCAST_COUNT: 1",
  "LOCK_FINAL_STATUS: " + final.status,
  "LOCK_CONSENSUS: " + final.consensus,
  "LOCK_EXECUTION: " + final.execution,
  "FINAL_POLICY_READBACK: " + JSON.stringify(policyAfter),
  "FINAL_POLICY_LOCKED: true",
  "UPDATE_AFTER_LOCK_SIMULATION: " + updateSimulation,
  "SECOND_LOCK_SIMULATION: " + secondLockSimulation,
  "PROTECTED_DEMO_STATE_AFTER: " + JSON.stringify(safe(protectedState)),
  "BALANCE_AFTER_WEI: " + after.balanceWei,
  "LATEST_NONCE_AFTER: " + after.latestNonce,
  "PENDING_NONCE_AFTER: " + after.pendingNonce,
  "INCIDENT_CREATED: NO", "EVIDENCE_BOUND: NO",
  "OUTFLOW_EXECUTED: NO", "REMEDIATION_EXECUTED: NO",
]);
console.log(JSON.stringify({ event: "FINAL_POLICY_LOCKED", tx: lockTx, terminal: final, policyAfter, updateSimulation, secondLockSimulation, protectedDemo: safe(protectedState), after }));
