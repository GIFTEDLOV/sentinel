import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { executionResultNumberToName, transactionsStatusNumberToName } from "genlayer-js/types";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ZERO = "0x0000000000000000000000000000000000000000";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE_CLASS = "unauthorized-drain";
const DOMAINS = "studio-next.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const ADVISORY_PREFIX = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const EXPECTED_SENTINEL_SHA = "7780D346ECCC497AE54DC93268FC42FD87B2266DB73168EDF07ACEA1E393A1E5";
const EXPECTED_PROTECTED_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const SENTINEL_SOURCE_PATH = `${ROOT}/contracts/sentinel.py`;
const PROTECTED_SOURCE_PATH = `${ROOT}/contracts/protected_demo.py`;
const EVIDENCE_DIR = `${ROOT}/deploy/evidence/final-v4`;
const JOURNAL_PATH = `${EVIDENCE_DIR}/STUDIO_NEXT_DEPLOYMENT_JOURNAL.json`;
const FEE_PROFILE_PATH = `${EVIDENCE_DIR}/STUDIO_NEXT_FEE_PROFILE.json`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function first(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) return value[name];
  }
  return null;
}

function terminal(receipt) {
  const status = first(receipt, ["statusName", "status_name", "status"]);
  const consensus = first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status", "consensus"]);
  const execution = first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult", "execution"]);
  const executionName = typeof execution === "number"
    ? executionResultNumberToName[String(execution)] ?? String(execution)
    : execution;
  const statusName = typeof status === "number"
    ? transactionsStatusNumberToName[String(status)] ?? String(status)
    : status;
  return {
    status: statusName,
    consensus,
    execution: executionName,
    id: first(receipt, ["id", "txHash", "hash"]),
    contractAddress: first(receipt?.data, ["contract_address", "contractAddress"]) ?? first(receipt, ["contractAddress", "contract_address"]),
  };
}

function requireSuccessful(receipt, operation) {
  const result = terminal(receipt);
  const status = String(result.status).toUpperCase();
  const consensus = String(result.consensus).toUpperCase();
  const execution = String(result.execution).toUpperCase();
  if (status !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(consensus) || execution !== "FINISHED_WITH_RETURN") {
    throw new Error(`${operation} terminal-success gate failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

async function loadSigningAccount() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const lastInit = source.lastIndexOf("initializeCLI();");
  if (lastInit < 0) throw new Error("GenLayer CLI initializer not found");
  let transformed = source.slice(0, lastInit) + source.slice(lastInit + "initializeCLI();".length);
  const bundleFileUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleFileUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };");
  const requireFromBundle = createRequire(bundlePath);
  const builtins = new Set([
    "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises",
    "http", "https", "module", "net", "os", "path", "process", "stream",
    "stream/promises", "string_decoder", "tty", "url", "util", "zlib",
  ]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    const resolved = requireFromBundle.resolve(spec);
    return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
  });
  const { BaseAction } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
  const action = new BaseAction();
  action.accountOverride = "beacon-final-deployer";
  return action.getAccount(false);
}

function makeChain() {
  return {
    ...studioDevnet,
    id: CHAIN_ID,
    name: "GenLayer Studio Next",
    nativeCurrency: { ...studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
}

async function readContract(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, jsonSafeReturn: true });
}

async function rpcPreflight(client, account, stage) {
  const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = {
    stage,
    rpc: RPC,
    chainId: Number.parseInt(chainIdHex, 16),
    account: account.address,
    balanceWei: BigInt(balanceHex).toString(),
    latestNonce: Number.parseInt(latestHex, 16),
    pendingNonce: Number.parseInt(pendingHex, 16),
  };
  if (result.rpc !== RPC || result.chainId !== CHAIN_ID) throw new Error(`${stage}: Studio Next RPC/chain gate failed: ${JSON.stringify(result)}`);
  if (lower(result.account) !== OWNER) throw new Error(`${stage}: unexpected owner ${result.account}`);
  if (result.latestNonce !== result.pendingNonce) throw new Error(`${stage}: pending nonce exists: ${JSON.stringify(result)}`);
  return result;
}

async function sourceSchema(client, source) {
  return client.request({ method: "gen_getContractSchemaForCode", params: [source] });
}

function requireSchemaMethods(schema, expected, label) {
  const methods = Object.keys(schema?.methods ?? {}).sort();
  for (const name of expected) if (!methods.includes(name)) throw new Error(`${label} schema missing ${name}`);
  return methods;
}

function roundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded);
  const decodedArgs = decoded.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== args.length || !decodedArgs.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(`${method} calldata roundtrip failed`);
  }
  return { method, encodedHex: `0x${Buffer.from(encoded).toString("hex")}`, decodedArgs: safe(decodedArgs), exact: true };
}

function protectedStateValues(state) {
  const treasury = state.treasury ?? {};
  const counters = state.counters ?? {};
  return {
    owner: first(state, ["owner"]),
    authorizedSentinel: first(state, ["authorizedSentinel", "authorized"]),
    controllerConfigured: first(state, ["controllerConfigured", "configured"]),
    paused: first(state, ["paused"]),
    remediated: first(state, ["remediated"]) ?? first(treasury, ["remediated"]),
    treasuryBalance: first(treasury, ["treasury_balance", "treasuryBalance"]),
    totalOutflow: first(treasury, ["total_outflow", "totalOutflow"]),
    totalProcessed: first(state, ["totalProcessed"]),
    pauseCount: first(counters, ["pause_count", "pauseCount"]),
    unpauseCount: first(counters, ["unpause_count", "unpauseCount"]),
  };
}

async function protectedState(client, address) {
  return protectedStateValues({
    owner: await readContract(client, address, "get_owner"),
    authorized: await readContract(client, address, "get_authorized_sentinel"),
    configured: await readContract(client, address, "is_controller_configured"),
    paused: await readContract(client, address, "is_paused"),
    remediated: await readContract(client, address, "is_remediated"),
    totalProcessed: await readContract(client, address, "get_total_processed"),
    treasury: await readContract(client, address, "get_treasury_state"),
    counters: await readContract(client, address, "get_pause_counters"),
  });
}

function assertProtected(state, expectedSentinel, stage) {
  if (lower(state.owner) !== OWNER) throw new Error(`${stage}: owner mismatch`);
  if (lower(state.authorizedSentinel) !== lower(expectedSentinel)) throw new Error(`${stage}: authorized sentinel mismatch`);
  if (state.controllerConfigured !== (lower(expectedSentinel) !== ZERO)) throw new Error(`${stage}: controller configured mismatch`);
  if (state.paused !== false || state.remediated !== false) throw new Error(`${stage}: pause/remediation mismatch`);
  if (String(state.treasuryBalance) !== "1000" || String(state.totalOutflow) !== "0") throw new Error(`${stage}: treasury mismatch`);
  if (String(state.totalProcessed) !== "0" || String(state.pauseCount) !== "0" || String(state.unpauseCount) !== "0") throw new Error(`${stage}: counters mismatch`);
}

async function codeHash(client, address) {
  const encoded = await client.request({ method: "gen_getContractCode", params: [address] });
  const source = Buffer.from(encoded, "base64");
  return { sha256: createHash("sha256").update(source).digest("hex").toUpperCase(), bytes: source.length };
}

async function writeJournal(entries) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(JOURNAL_PATH, JSON.stringify(safe({ network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, entries }), null, 2) + "\n", "utf8");
}

async function waitSameHash(client, hash, label) {
  let last;
  try {
    last = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  } catch (error) {
    last = null;
    console.error(`${label}: receipt wait was ambiguous; reconciling the same hash only: ${String(error).slice(0, 300)}`);
  }
  if (!last) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const current = await client.getTransaction({ hash });
        const state = terminal(current);
        if (String(state.status).toUpperCase() === "FINALIZED") {
          last = current;
          break;
        }
      } catch {
        // The canonical node may not expose a just-submitted transaction immediately.
      }
      await sleep(5000);
    }
  }
  if (!last) throw new Error(`${label}: same-hash reconciliation timed out`);
  return last;
}

async function estimateFor(client, account, operation, address, functionName, args) {
  const base = { account, appealRounds: 1n, rotations: [0n, 0n] };
  if (address) return client.estimateTransactionFeesForWrite({ ...base, address, functionName, args });
  return client.estimateTransactionFees(base);
}

const entries = [];
await mkdir(EVIDENCE_DIR, { recursive: true });
const sentinelSource = await readFile(SENTINEL_SOURCE_PATH, "utf8");
const protectedSource = await readFile(PROTECTED_SOURCE_PATH, "utf8");
const sentinelSha = await sha256(SENTINEL_SOURCE_PATH);
const protectedSha = await sha256(PROTECTED_SOURCE_PATH);
if (sentinelSha !== EXPECTED_SENTINEL_SHA || protectedSha !== EXPECTED_PROTECTED_SHA) throw new Error("frozen source hash gate failed");

const account = await loadSigningAccount();
const chain = makeChain();
const client = createClient({ chain, account });
await client.initializeConsensusSmartContract();
const before = await rpcPreflight(client, account, "before deployment");
const [sentinelSchema, protectedSchema] = await Promise.all([sourceSchema(client, sentinelSource), sourceSchema(client, protectedSource)]);
requireSchemaMethods(sentinelSchema, ["register_protected_protocol", "lock_emergency_policy", "get_protocol", "bind_evidence"], "Sentinel");
requireSchemaMethods(protectedSchema, ["configure_sentinel", "get_owner", "get_authorized_sentinel", "is_controller_configured", "is_paused", "is_remediated", "get_treasury_state", "get_total_processed", "get_pause_counters"], "ProtectedDemo");
if (sentinelSchema.methods.bind_evidence.params.some((item) => item[0] === "observed_at")) throw new Error("bind_evidence still exposes caller-controlled observed_at");

const feePolicy = await client.getCurrentFeePolicy();
const protectedDeployEstimate = await estimateFor(client, account, "ProtectedDemo deployment", null, null, []);
const sentinelDeployEstimate = await estimateFor(client, account, "Sentinel deployment", null, null, []);
if (BigInt(protectedDeployEstimate.feeValue) <= 0n || BigInt(sentinelDeployEstimate.feeValue) <= 0n) throw new Error("deployment fee estimate is zero");
const feeProfile = {
  network: "Studio Next",
  rpc: RPC,
  chainId: CHAIN_ID,
  measuredAt: new Date().toISOString(),
  policy: safe(feePolicy),
  estimates: { protectedDemoDeployment: safe(protectedDeployEstimate), sentinelDeployment: safe(sentinelDeployEstimate) },
  headroom: { source: "current genlayer-js estimateTransactionFees policy path", manualFeeValues: false },
  finalFeeValues: { protectedDemoDeployment: safe(protectedDeployEstimate), sentinelDeployment: safe(sentinelDeployEstimate) },
};
await writeFile(FEE_PROFILE_PATH, JSON.stringify(feeProfile, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ phase: "read-only preflight", before, sourceHashes: { sentinelSha, protectedSha }, schemaMethods: { sentinel: Object.keys(sentinelSchema.methods).length, protectedDemo: Object.keys(protectedSchema.methods).length }, feeProfilePath: FEE_PROFILE_PATH }, null, 2));

async function deploy(label, source, args, expectedSha) {
  const pre = await rpcPreflight(client, account, `${label} before broadcast`);
  const estimate = await estimateFor(client, account, label, null, null, args);
  const tx = await client.deployContract({ account, code: source, args, fees: estimate });
  await writeJournal([...entries, { label, txHash: tx, nonce: pre.latestNonce, estimate: safe(estimate), broadcastCount: 1 }]);
  console.log(JSON.stringify({ broadcast: label, txHash: tx, nonce: pre.latestNonce }));
  const receipt = await waitSameHash(client, tx, label);
  const result = requireSuccessful(receipt, label);
  const address = result.contractAddress;
  if (!address) throw new Error(`${label}: finalized receipt did not expose contract address`);
  const deployedCode = await codeHash(client, address);
  if (deployedCode.sha256 !== expectedSha) throw new Error(`${label}: deployed source hash mismatch ${JSON.stringify(deployedCode)}`);
  entries.push({ label, txHash: tx, nonce: pre.latestNonce, estimate: safe(estimate), terminal: result, address, deployedCode, broadcastCount: 1 });
  await writeJournal(entries);
  return { tx, receipt, result, address, estimate, deployedCode };
}

const protectedDeployment = await deploy("ProtectedDemo deployment", protectedSource, [ZERO], EXPECTED_PROTECTED_SHA);
const protectedInitial = await protectedState(client, protectedDeployment.address);
assertProtected(protectedInitial, ZERO, "ProtectedDemo initial state");
console.log(JSON.stringify({ protectedDemo: protectedDeployment.address, initialState: protectedInitial }, null, 2));

const sentinelDeployment = await deploy("Sentinel deployment", sentinelSource, [], EXPECTED_SENTINEL_SHA);
entries.push({ label: "deployment addresses", protectedDemo: protectedDeployment.address, sentinel: sentinelDeployment.address });
await writeJournal(entries);
console.log(JSON.stringify({ sentinel: sentinelDeployment.address }, null, 2));

async function stateChangingWrite(label, address, functionName, args, beforeCheck, afterCheck) {
  const preState = await beforeCheck();
  const pre = await rpcPreflight(client, account, `${label} before broadcast`);
  const fees = await estimateFor(client, account, label, address, functionName, args);
  const simulation = await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const beforeBroadcast = await rpcPreflight(client, account, `${label} immediately before broadcast`);
  if (beforeBroadcast.latestNonce !== pre.latestNonce) throw new Error(`${label}: nonce changed between preflight and broadcast`);
  const tx = await client.writeContract({ account, address, functionName, args, fees });
  await writeJournal([...entries, { label, txHash: tx, nonce: beforeBroadcast.latestNonce, fees: safe(fees), simulation: safe(simulation), broadcastCount: 1 }]);
  console.log(JSON.stringify({ broadcast: label, txHash: tx, nonce: beforeBroadcast.latestNonce }));
  const receipt = await waitSameHash(client, tx, label);
  const result = requireSuccessful(receipt, label);
  const postState = await afterCheck();
  entries.push({ label, txHash: tx, nonce: beforeBroadcast.latestNonce, fees: safe(fees), simulation: safe(simulation), terminal: result, preState: safe(preState), postState: safe(postState), broadcastCount: 1 });
  await writeJournal(entries);
  return { tx, receipt, result, fees, simulation, preState, postState };
}

const configureArgs = [sentinelDeployment.address];
const configure = await stateChangingWrite(
  "configure_sentinel",
  protectedDeployment.address,
  "configure_sentinel",
  configureArgs,
  async () => {
    const state = await protectedState(client, protectedDeployment.address);
    if (lower(state.authorizedSentinel) !== ZERO || state.controllerConfigured !== false || state.paused !== false) throw new Error(`configure precondition mismatch: ${JSON.stringify(state)}`);
    return state;
  },
  async () => {
    const state = await protectedState(client, protectedDeployment.address);
    if (lower(state.authorizedSentinel) !== lower(sentinelDeployment.address) || state.controllerConfigured !== true || state.paused !== false) throw new Error(`configure readback mismatch: ${JSON.stringify(state)}`);
    return state;
  },
);
let secondConfigurationSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: protectedDeployment.address, functionName: "configure_sentinel", args: configureArgs, fees: configure.fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  secondConfigurationSimulation = "UNEXPECTED_SUCCESS";
} catch (error) {
  secondConfigurationSimulation = `REJECTED: ${String(error).slice(0, 300)}`;
}
if (secondConfigurationSimulation === "UNEXPECTED_SUCCESS") throw new Error("second configure simulation unexpectedly succeeded");

const registerArgs = [PROTOCOL_ID, protectedDeployment.address, FAILURE_CLASS, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n];
const registerRoundtrip = roundtrip("register_protected_protocol", registerArgs);
let protocolBeforeRegister;
try {
  protocolBeforeRegister = await readContract(client, sentinelDeployment.address, "get_protocol", [PROTOCOL_ID]);
  throw new Error(`sentinel-demo already registered: ${JSON.stringify(protocolBeforeRegister)}`);
} catch (error) {
  if (String(error).includes("already registered")) throw error;
  protocolBeforeRegister = "NOT_REGISTERED";
}
const register = await stateChangingWrite(
  "register_protected_protocol",
  sentinelDeployment.address,
  "register_protected_protocol",
  registerArgs,
  async () => protocolBeforeRegister,
  async () => readContract(client, sentinelDeployment.address, "get_protocol", [PROTOCOL_ID]),
);

const lockArgs = [PROTOCOL_ID];
const lockRoundtrip = roundtrip("lock_emergency_policy", lockArgs);
const policyBeforeLock = await readContract(client, sentinelDeployment.address, "get_protocol", [PROTOCOL_ID]);
if (policyBeforeLock.policy_locked !== false) throw new Error(`policy is not unlocked before lock: ${JSON.stringify(policyBeforeLock)}`);
const lock = await stateChangingWrite(
  "lock_emergency_policy",
  sentinelDeployment.address,
  "lock_emergency_policy",
  lockArgs,
  async () => policyBeforeLock,
  async () => readContract(client, sentinelDeployment.address, "get_protocol", [PROTOCOL_ID]),
);
const finalPolicy = await readContract(client, sentinelDeployment.address, "get_protocol", [PROTOCOL_ID]);
const expectedPolicy = {
  target_address: lower(protectedDeployment.address),
  critical_failure_class: FAILURE_CLASS,
  canonical_rpc_endpoint: RPC,
  allowed_source_prefixes: PREFIX,
  minimum_sources: "2",
  max_evidence_age_seconds: "3600",
  recovery_cooldown_seconds: "900",
  policy_locked: true,
};
for (const [key, value] of Object.entries(expectedPolicy)) {
  const actual = key === "target_address" ? lower(finalPolicy[key]) : String(finalPolicy[key]);
  if (actual !== String(value)) throw new Error(`final policy mismatch for ${key}: ${JSON.stringify(finalPolicy)}`);
}
let updateAfterLockSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: sentinelDeployment.address, functionName: "update_emergency_policy", args: [PROTOCOL_ID, FAILURE_CLASS, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n], fees: lock.fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  updateAfterLockSimulation = "UNEXPECTED_SUCCESS";
} catch (error) {
  updateAfterLockSimulation = `REJECTED: ${String(error).slice(0, 300)}`;
}
let secondLockSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: sentinelDeployment.address, functionName: "lock_emergency_policy", args: lockArgs, fees: lock.fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  secondLockSimulation = "UNEXPECTED_SUCCESS";
} catch (error) {
  secondLockSimulation = `REJECTED: ${String(error).slice(0, 300)}`;
}
if (updateAfterLockSimulation === "UNEXPECTED_SUCCESS" || secondLockSimulation === "UNEXPECTED_SUCCESS") throw new Error("policy lock fail-closed simulations did not reject");

const finalProtected = await protectedState(client, protectedDeployment.address);
assertProtected(finalProtected, sentinelDeployment.address, "final ProtectedDemo state");
const after = await rpcPreflight(client, account, "after deployment");
const finalRecord = {
  network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, owner: OWNER,
  sourceHashes: { sentinel: EXPECTED_SENTINEL_SHA, protectedDemo: EXPECTED_PROTECTED_SHA },
  addresses: { sentinel: sentinelDeployment.address, protectedDemo: protectedDeployment.address },
  deployments: { protectedDemo: safe(protectedDeployment), sentinel: safe(sentinelDeployment) },
  writes: entries,
  calldataRoundtrips: { register: registerRoundtrip, lock: lockRoundtrip },
  secondConfigurationSimulation,
  finalPolicy: safe(finalPolicy),
  updateAfterLockSimulation,
  secondLockSimulation,
  finalProtectedState: safe(finalProtected),
  preflightBefore: before,
  preflightAfter: after,
  totalWrites: entries.filter((item) => item.broadcastCount === 1).length,
};
await writeFile(`${EVIDENCE_DIR}/FINAL_STUDIO_NEXT_DEPLOYMENT_RAW.json`, JSON.stringify(safe(finalRecord), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ complete: true, finalRecord }, null, 2));
