import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const ACCOUNT = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const SENTINEL = "0x2dF0E12D4CE46f0312B7461972351F3cD074b3c9";
const PROTECTED_DEMO = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE_CLASS = "unauthorized-drain";
const DOMAINS = "studio-dev.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-dev.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const EXPECTED_SENTINEL_SHA = "17B170A8394EDD250536937898EFF1FFD30AE8E90258E7578B8DD00E5FE1BD7D";
const EXPECTED_PROTECTED_DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const PROFILE_PATH = ROOT + "/deploy/fee-profile.json";
const REGISTRATION_EVIDENCE = ROOT + "/deploy/evidence/final/FINAL_POLICY_REGISTRATION.txt";
const LOCK_EVIDENCE = ROOT + "/deploy/evidence/final/FINAL_POLICY_LOCK.txt";

async function loadInstalledSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const lastInit = source.lastIndexOf("initializeCLI();");
  if (lastInit < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, lastInit) + source.slice(lastInit + "initializeCLI();".length);
  const bundleFileUrl = new URL("file://" + bundlePath).href;
  transformed = transformed.replaceAll("import.meta.url", "new URL(" + JSON.stringify(bundleFileUrl) + ").href");
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
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefixText, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return prefixText + quote + "node:" + spec + close;
    const resolved = requireFromBundle.resolve(spec);
    return prefixText + quote + new URL("file://" + resolved.replaceAll("\\", "/")).href + close;
  });
  return import("data:text/javascript;base64," + Buffer.from(transformed).toString("base64"));
}

function safe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) {
  return String(value).toLowerCase();
}

function first(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) return value[name];
  }
  return null;
}

function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]),
  };
}

function requireSuccess(receipt, operation) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" ||
      !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) ||
      String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") {
    throw new Error(operation + " failed terminal-success gate: " + JSON.stringify(result));
  }
  return result;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

async function preflight(client, account) {
  const values = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = {
    network: "studio-dev",
    rpc: RPC,
    chainId: Number.parseInt(values[0], 16),
    account: account.address,
    balanceWei: BigInt(values[1]).toString(),
    latestNonce: Number.parseInt(values[2], 16),
    pendingNonce: Number.parseInt(values[3], 16),
    unknownPendingTransactions: "eth_pendingTransactions unsupported; latest==pending is the available gate",
  };
  if (result.chainId !== CHAIN_ID) throw new Error("unexpected chain id " + result.chainId);
  if (lower(result.account) !== ACCOUNT) throw new Error("unexpected account " + result.account);
  if (result.latestNonce !== result.pendingNonce) throw new Error("nonce mismatch");
  return result;
}

function feeOptions(profile) {
  const appealRounds = BigInt(profile.appealRounds ?? 1);
  const rotations = BigInt(profile.rotationsPerRound ?? 3);
  return {
    leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation),
    appealRounds,
    executionBudgetPerRound: BigInt(profile.executionBudgetPerRound),
    totalMessageFees: BigInt(profile.totalMessageFees ?? 0),
    rotations: Array.from({ length: Number(appealRounds) + 1 }, () => rotations),
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
    transactionHashVariant: "latest-nonfinal",
  };
}

function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded);
  const decodedArgs = decoded.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== args.length ||
      !decodedArgs.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(method + " calldata roundtrip mismatch");
  }
  return {
    method,
    encodedHex: "0x" + Buffer.from(encoded).toString("hex"),
    decodedArgs: decodedArgs.map((value) => typeof value === "bigint" ? value.toString() : value),
    exact: true,
  };
}

async function readContract(client, address, method, args = []) {
  return client.readContract({ address, functionName: method, args, jsonSafeReturn: true });
}

async function requireUnregistered(client) {
  try {
    await readContract(client, SENTINEL, "get_protocol", [PROTOCOL_ID]);
  } catch (error) {
    const encoded = error?.cause?.data?.receipt?.result;
    const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    if (decoded.includes("Unknown protected protocol") || String(error).includes("Unknown protected protocol")) {
      return "UNKNOWN_PROTECTED_PROTOCOL";
    }
    throw new Error("protocol precondition read failed");
  }
  throw new Error("sentinel-demo already exists; no registration will be submitted");
}

function checkProtected(state, stage) {
  if (lower(state.owner) !== ACCOUNT) throw new Error(stage + ": owner mismatch");
  if (lower(state.authorized) !== lower(SENTINEL)) throw new Error(stage + ": authorized sentinel mismatch");
  if (state.configured !== true) throw new Error(stage + ": controller not configured");
  if (state.paused !== false || state.remediated !== false) throw new Error(stage + ": protected state changed");
  if (String(state.treasury.treasury_balance) !== "1000" || String(state.treasury.total_outflow) !== "0") {
    throw new Error(stage + ": treasury state mismatch");
  }
  if (String(state.totalProcessed) !== "0" ||
      String(state.counters.pause_count) !== "0" ||
      String(state.counters.unpause_count) !== "0") {
    throw new Error(stage + ": lifecycle counters changed");
  }
}

function checkPolicy(policy, locked) {
  const actual = {
    protocol_id: policy.protocol_id,
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
    protocol_id: PROTOCOL_ID,
    target_address: lower(PROTECTED_DEMO),
    critical_failure_class: FAILURE_CLASS,
    allowed_source_domains: DOMAINS,
    allowed_source_prefixes: PREFIX,
    canonical_rpc_endpoint: RPC,
    minimum_sources: "2",
    max_evidence_age_seconds: "3600",
    recovery_cooldown_seconds: "900",
    policy_locked: locked,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("policy readback mismatch: " + JSON.stringify(actual));
  }
  return actual;
}

async function persist(path, lines) {
  await writeFile(path, lines.join("\n") + "\n", "utf8");
}

const { createClient2, studioDevnet, BaseAction } = await loadInstalledSdk();
const account = await new BaseAction().getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const sentinelSha = await sha256(ROOT + "/contracts/sentinel.py");
const protectedDemoSha = await sha256(ROOT + "/contracts/protected_demo.py");
if (sentinelSha !== EXPECTED_SENTINEL_SHA || protectedDemoSha !== EXPECTED_PROTECTED_DEMO_SHA) {
  throw new Error("frozen source hash gate failed");
}

const profileDocument = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
if (profileDocument.chainId !== CHAIN_ID || !profileDocument.deploy) throw new Error("invalid fee profile");
const options = feeOptions(profileDocument.deploy);
const protectedState = {
  owner: await readContract(client, PROTECTED_DEMO, "get_owner"),
  authorized: await readContract(client, PROTECTED_DEMO, "get_authorized_sentinel"),
  configured: await readContract(client, PROTECTED_DEMO, "is_controller_configured"),
  paused: await readContract(client, PROTECTED_DEMO, "is_paused"),
  remediated: await readContract(client, PROTECTED_DEMO, "is_remediated"),
  treasury: await readContract(client, PROTECTED_DEMO, "get_treasury_state"),
  totalProcessed: await readContract(client, PROTECTED_DEMO, "get_total_processed"),
  counters: await readContract(client, PROTECTED_DEMO, "get_pause_counters"),
};
checkProtected(protectedState, "before registration");
const protocolPrecondition = await requireUnregistered(client);
const registerPreflight = await preflight(client, account);
const registerArgs = [
  PROTOCOL_ID, PROTECTED_DEMO, FAILURE_CLASS, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n
];
const registerCalldata = calldataRoundtrip("register_protected_protocol", registerArgs);
const registerFees = await client.estimateTransactionFeesForWrite({
  account, address: SENTINEL, functionName: "register_protected_protocol", args: registerArgs, ...options
});
if (BigInt(registerFees.feeValue) <= 0n) throw new Error("registration fee quote is zero");
const registerSimulation = await client.simulateWriteContract({
  account, address: SENTINEL, functionName: "register_protected_protocol",
  args: registerArgs, fees: registerFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
});
console.log(JSON.stringify({
  event: "REGISTER_PREFLIGHT",
  sourceHashes: { sentinel: sentinelSha, protectedDemo: protectedDemoSha },
  protectedState: safe(protectedState), protocolPrecondition, preflight: registerPreflight,
  calldata: registerCalldata, fees: safe(registerFees),
  simulation: terminal(registerSimulation.receipt || {})
}));

const registerBeforeBroadcast = await preflight(client, account);
const registerTx = await client.writeContract({
  account, address: SENTINEL, functionName: "register_protected_protocol",
  args: registerArgs, fees: registerFees
});
console.log(JSON.stringify({ event: "REGISTER_BROADCAST_RETURNED", tx: registerTx }));
await persist(REGISTRATION_EVIDENCE, [
  "FINAL POLICY REGISTRATION",
  "SENTINEL_SHA: " + sentinelSha,
  "PROTECTED_DEMO_SHA: " + protectedDemoSha,
  "NETWORK: studio-dev",
  "RPC: " + RPC,
  "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + registerBeforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + registerBeforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + registerBeforeBroadcast.pendingNonce,
  "PROTOCOL_PRECONDITION: " + protocolPrecondition,
  "REGISTER_CALLDATA_ROUNDTRIP: PASS",
  "REGISTER_SIMULATION: PASS",
  "REGISTER_FEE_VALUE: " + registerFees.feeValue,
  "REGISTER_FEE_DISTRIBUTION: " + JSON.stringify(safe(registerFees.distribution)),
  "REGISTER_TX: " + registerTx,
  "REGISTER_BROADCAST_COUNT: 1",
]);
const registerReceipt = await client.waitForTransactionReceipt({
  hash: registerTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true
});
const registerTerminal = requireSuccess(registerReceipt, "registration");
const policyAfterRegister = checkPolicy(await readContract(client, SENTINEL, "get_protocol", [PROTOCOL_ID]), false);
await persist(REGISTRATION_EVIDENCE, [
  "FINAL POLICY REGISTRATION",
  "SENTINEL_SHA: " + sentinelSha,
  "PROTECTED_DEMO_SHA: " + protectedDemoSha,
  "NETWORK: studio-dev",
  "RPC: " + RPC,
  "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + registerBeforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + registerBeforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + registerBeforeBroadcast.pendingNonce,
  "PROTOCOL_PRECONDITION: " + protocolPrecondition,
  "REGISTER_CALLDATA_ROUNDTRIP: PASS",
  "REGISTER_SIMULATION: PASS",
  "REGISTER_FEE_VALUE: " + registerFees.feeValue,
  "REGISTER_FEE_DISTRIBUTION: " + JSON.stringify(safe(registerFees.distribution)),
  "REGISTER_TX: " + registerTx,
  "REGISTER_BROADCAST_COUNT: 1",
  "REGISTER_FINAL_STATUS: " + registerTerminal.status,
  "REGISTER_CONSENSUS: " + registerTerminal.consensus,
  "REGISTER_EXECUTION: " + registerTerminal.execution,
  "PROTOCOL_READBACK_AFTER_REGISTER: " + JSON.stringify(policyAfterRegister),
  "POLICY_LOCKED_AFTER_REGISTER: false",
]);

const lockPreflight = await preflight(client, account);
const lockArgs = [PROTOCOL_ID];
const lockCalldata = calldataRoundtrip("lock_emergency_policy", lockArgs);
const lockPolicyBefore = checkPolicy(await readContract(client, SENTINEL, "get_protocol", [PROTOCOL_ID]), false);
const lockFees = await client.estimateTransactionFeesForWrite({
  account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, ...options
});
if (BigInt(lockFees.feeValue) <= 0n) throw new Error("lock fee quote is zero");
const lockSimulation = await client.simulateWriteContract({
  account, address: SENTINEL, functionName: "lock_emergency_policy",
  args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
});
console.log(JSON.stringify({
  event: "LOCK_PREFLIGHT", preflight: lockPreflight, policy: lockPolicyBefore,
  calldata: lockCalldata, fees: safe(lockFees), simulation: terminal(lockSimulation.receipt || {})
}));

const lockBeforeBroadcast = await preflight(client, account);
const lockTx = await client.writeContract({
  account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees
});
console.log(JSON.stringify({ event: "LOCK_BROADCAST_RETURNED", tx: lockTx }));
await persist(LOCK_EVIDENCE, [
  "FINAL POLICY LOCK",
  "SENTINEL_SHA: " + sentinelSha,
  "PROTECTED_DEMO_SHA: " + protectedDemoSha,
  "NETWORK: studio-dev",
  "RPC: " + RPC,
  "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + lockBeforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + lockBeforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + lockBeforeBroadcast.pendingNonce,
  "POLICY_BEFORE: " + JSON.stringify(lockPolicyBefore),
  "LOCK_CALLDATA_ROUNDTRIP: PASS",
  "LOCK_SIMULATION: PASS",
  "LOCK_FEE_VALUE: " + lockFees.feeValue,
  "LOCK_FEE_DISTRIBUTION: " + JSON.stringify(safe(lockFees.distribution)),
  "LOCK_TX: " + lockTx,
  "LOCK_BROADCAST_COUNT: 1",
]);
const lockReceipt = await client.waitForTransactionReceipt({
  hash: lockTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true
});
const lockTerminal = requireSuccess(lockReceipt, "policy lock");
const policyAfterLock = checkPolicy(await readContract(client, SENTINEL, "get_protocol", [PROTOCOL_ID]), true);

let updateSimulation = "REJECTED";
try {
  await client.simulateWriteContract({
    account, address: SENTINEL, functionName: "update_emergency_policy",
    args: [PROTOCOL_ID, FAILURE_CLASS, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n],
    fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
  });
  updateSimulation = "UNEXPECTED_SUCCESS";
} catch {
  updateSimulation = "REJECTED";
}
let secondLockSimulation = "REJECTED";
try {
  await client.simulateWriteContract({
    account, address: SENTINEL, functionName: "lock_emergency_policy",
    args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal"
  });
  secondLockSimulation = "UNEXPECTED_SUCCESS";
} catch {
  secondLockSimulation = "REJECTED";
}
const finalProtectedState = {
  owner: await readContract(client, PROTECTED_DEMO, "get_owner"),
  authorized: await readContract(client, PROTECTED_DEMO, "get_authorized_sentinel"),
  configured: await readContract(client, PROTECTED_DEMO, "is_controller_configured"),
  paused: await readContract(client, PROTECTED_DEMO, "is_paused"),
  remediated: await readContract(client, PROTECTED_DEMO, "is_remediated"),
  treasury: await readContract(client, PROTECTED_DEMO, "get_treasury_state"),
  totalProcessed: await readContract(client, PROTECTED_DEMO, "get_total_processed"),
  counters: await readContract(client, PROTECTED_DEMO, "get_pause_counters"),
};
checkProtected(finalProtectedState, "after policy lock");
const after = await preflight(client, account);
await persist(LOCK_EVIDENCE, [
  "FINAL POLICY LOCK",
  "SENTINEL_SHA: " + sentinelSha,
  "PROTECTED_DEMO_SHA: " + protectedDemoSha,
  "NETWORK: studio-dev",
  "RPC: " + RPC,
  "CHAIN_ID: " + CHAIN_ID,
  "ACCOUNT: " + account.address,
  "BALANCE_BEFORE_WEI: " + lockBeforeBroadcast.balanceWei,
  "LATEST_NONCE_BEFORE: " + lockBeforeBroadcast.latestNonce,
  "PENDING_NONCE_BEFORE: " + lockBeforeBroadcast.pendingNonce,
  "POLICY_BEFORE: " + JSON.stringify(lockPolicyBefore),
  "LOCK_CALLDATA_ROUNDTRIP: PASS",
  "LOCK_SIMULATION: PASS",
  "LOCK_FEE_VALUE: " + lockFees.feeValue,
  "LOCK_FEE_DISTRIBUTION: " + JSON.stringify(safe(lockFees.distribution)),
  "LOCK_TX: " + lockTx,
  "LOCK_BROADCAST_COUNT: 1",
  "LOCK_FINAL_STATUS: " + lockTerminal.status,
  "LOCK_CONSENSUS: " + lockTerminal.consensus,
  "LOCK_EXECUTION: " + lockTerminal.execution,
  "FINAL_POLICY_READBACK: " + JSON.stringify(policyAfterLock),
  "FINAL_POLICY_LOCKED: true",
  "UPDATE_AFTER_LOCK_SIMULATION: " + updateSimulation,
  "SECOND_LOCK_SIMULATION: " + secondLockSimulation,
  "PROTECTED_DEMO_STATE_AFTER: " + JSON.stringify(safe(finalProtectedState)),
  "BALANCE_AFTER_WEI: " + after.balanceWei,
  "LATEST_NONCE_AFTER: " + after.latestNonce,
  "PENDING_NONCE_AFTER: " + after.pendingNonce,
  "INCIDENT_CREATED: NO",
  "EVIDENCE_BOUND: NO",
  "OUTFLOW_EXECUTED: NO",
  "REMEDIATION_EXECUTED: NO",
]);
console.log(JSON.stringify({
  event: "FINAL_POLICY_LOCKED",
  registration: { tx: registerTx, ...registerTerminal },
  lock: { tx: lockTx, ...lockTerminal },
  policyAfterRegister, policyAfterLock, updateSimulation, secondLockSimulation,
  protectedDemo: safe(finalProtectedState), after
}));
