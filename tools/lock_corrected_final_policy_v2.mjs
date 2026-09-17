import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const ACCOUNT_ADDRESS = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const SENTINEL = "0x5a2a5288C7213d60EC9C92ffa504Ef8FA64fc723";
const PROTECTED = "0xFCeC042B2fcc1d793Bf92877665c9Bae16971AE1";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE_CLASS = "unauthorized-drain";
const DOMAINS = "studio-dev.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-dev.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const SENTINEL_SHA = "7C1AAA1E2BAF4E30FDE3F9CB329F17FCBB5860AFE3A3F66BA4A6D6D58A2F53EE";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const PROFILE = `${ROOT}/deploy/fee-profile.json`;
const EVIDENCE_DIR = `${ROOT}/deploy/evidence/final-v2`;

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    const resolved = req.resolve(spec);
    return p + q + new URL(`file://${resolved.replaceAll("\\", "/")}`).href + close;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function first(value, names) { for (const name of names) if (value && value[name] !== undefined && value[name] !== null) return value[name]; return null; }
function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]),
  };
}
function requireSuccess(receipt, label) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) || String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") throw new Error(`${label} terminal-success gate failed: ${JSON.stringify(result)}`);
  return result;
}
function feesFromProfile(profile) {
  const rounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return { leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation), validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation), appealRounds: rounds, executionBudgetPerRound: BigInt(profile.executionBudgetPerRound), totalMessageFees: BigInt(profile.totalMessageFees ?? 0), rotations: Array.from({ length: Number(rounds) + 1 }, () => rotation), maxPriceGenPerTimeUnit: 2n, storageFeeMaxGasPrice: 300000000n, receiptFeeMaxGasPrice: 300000000n, transactionHashVariant: "latest-nonfinal" };
}
function roundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, i) => String(value) === String(args[i]))) throw new Error(`${method} calldata mismatch`);
  return { method, encodedHex: "0x" + Buffer.from(encoded).toString("hex"), decodedArgs: decoded.map((value) => typeof value === "bigint" ? value.toString() : value), exact: true };
}
async function preflight(client, account) {
  const [chain, balance, latest, pending] = await Promise.all([
    client.request({ method: "eth_chainId" }), client.request({ method: "eth_getBalance", params: [account.address, "latest"] }), client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }), client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = { network: "studio-dev", rpc: RPC, chainId: Number.parseInt(chain, 16), account: account.address, balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || result.account.toLowerCase() !== ACCOUNT_ADDRESS || result.latestNonce !== result.pendingNonce) throw new Error(`preflight failed: ${JSON.stringify(result)}`);
  return result;
}
async function read(client, address, method, args = []) { return client.readContract({ address, functionName: method, args, jsonSafeReturn: true }); }
async function writeEvidence(name, lines) { await mkdir(EVIDENCE_DIR, { recursive: true }); await writeFile(`${EVIDENCE_DIR}/${name}`, lines.join("\n") + "\n", "utf8"); }
async function protectedState(client) {
  return { owner: await read(client, PROTECTED, "get_owner"), authorized: await read(client, PROTECTED, "get_authorized_sentinel"), configured: await read(client, PROTECTED, "is_controller_configured"), paused: await read(client, PROTECTED, "is_paused"), remediated: await read(client, PROTECTED, "is_remediated"), treasury: await read(client, PROTECTED, "get_treasury_state"), totalProcessed: await read(client, PROTECTED, "get_total_processed"), counters: await read(client, PROTECTED, "get_pause_counters") };
}
function checkProtected(state) {
  if (String(state.owner).toLowerCase() !== ACCOUNT_ADDRESS || String(state.authorized).toLowerCase() !== SENTINEL.toLowerCase() || state.configured !== true || state.paused !== false || state.remediated !== false || String(state.treasury.treasury_balance) !== "1000" || String(state.treasury.total_outflow) !== "0" || String(state.totalProcessed) !== "0" || String(state.counters.pause_count) !== "0" || String(state.counters.unpause_count) !== "0") throw new Error(`ProtectedDemo final state mismatch: ${JSON.stringify(state)}`);
}
function checkPolicy(policy, locked) {
  const actual = { target_address: String(policy.target_address).toLowerCase(), critical_failure_class: policy.critical_failure_class, allowed_source_domains: policy.allowed_source_domains, allowed_source_prefixes: policy.allowed_source_prefixes, canonical_rpc_endpoint: policy.canonical_rpc_endpoint, minimum_sources: String(policy.minimum_sources), max_evidence_age_seconds: String(policy.max_evidence_age_seconds), recovery_cooldown_seconds: String(policy.recovery_cooldown_seconds), policy_locked: policy.policy_locked };
  const expected = { target_address: PROTECTED.toLowerCase(), critical_failure_class: FAILURE_CLASS, allowed_source_domains: DOMAINS, allowed_source_prefixes: PREFIX, canonical_rpc_endpoint: RPC, minimum_sources: "2", max_evidence_age_seconds: "3600", recovery_cooldown_seconds: "900", policy_locked: locked };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`policy mismatch: ${JSON.stringify(actual)}`);
  return actual;
}

const { createClient2, studioDevnet, BaseAction } = await loadSdk();
const action = new BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();
const sentinelSha = createHash("sha256").update(await readFile(`${ROOT}/contracts/sentinel.py`)).digest("hex").toUpperCase();
const demoSha = createHash("sha256").update(await readFile(`${ROOT}/contracts/protected_demo.py`)).digest("hex").toUpperCase();
if (sentinelSha !== SENTINEL_SHA || demoSha !== DEMO_SHA) throw new Error("source hash gate failed");
const profileDocument = JSON.parse(await readFile(PROFILE, "utf8"));
const feeOptions = feesFromProfile(profileDocument.deploy);
const before = await preflight(client, account);
const protectedBefore = await protectedState(client);
checkProtected(protectedBefore);
const policyBefore = checkPolicy(await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]), false);
await writeEvidence("CORRECTED_POLICY_REGISTRATION.txt", ["CORRECTED POLICY REGISTRATION", `SENTINEL_ADDRESS: ${SENTINEL}`, `PROTECTED_DEMO_ADDRESS: ${PROTECTED}`, `SENTINEL_SHA: ${sentinelSha}`, `PROTECTED_DEMO_SHA: ${demoSha}`, `NETWORK: studio-dev`, `RPC: ${RPC}`, `CHAIN_ID: ${CHAIN_ID}`, `ACCOUNT: ${account.address}`, `PREFLIGHT: ${JSON.stringify(before)}`, `REGISTERED_POLICY: ${JSON.stringify(policyBefore)}`, `POLICY_LOCKED_AFTER_REGISTER: false`, `REGISTER_TX: 0xe827c57dac9a958ab414f5f82f2e5e4f8d52b61ec3830e4b3bd266048a8b8c07`, `REGISTER_BROADCAST_COUNT: 1`]);

const lockArgs = [PROTOCOL_ID];
const lockCalldata = roundtrip("lock_emergency_policy", lockArgs);
const lockFees = await client.estimateTransactionFeesForWrite({ account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, ...feeOptions });
if (BigInt(lockFees.feeValue) <= 0n || BigInt(before.balanceWei) < BigInt(lockFees.feeValue)) throw new Error("invalid lock fee/balance");
const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
const beforeBroadcast = await preflight(client, account);
const lockTx = await client.writeContract({ account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees });
await writeEvidence("CORRECTED_POLICY_LOCK.txt", ["CORRECTED POLICY LOCK", `SENTINEL_ADDRESS: ${SENTINEL}`, `PROTECTED_DEMO_ADDRESS: ${PROTECTED}`, `TRANSACTION_HASH: ${lockTx}`, `BROADCAST_COUNT: 1`, `PREFLIGHT: ${JSON.stringify(beforeBroadcast)}`, `CALLDATA: ${JSON.stringify(lockCalldata)}`, `SIMULATION: ${JSON.stringify(safe(simulation))}`, `FEE_ESTIMATE: ${JSON.stringify(safe(lockFees))}`]);
const receipt = await client.waitForTransactionReceipt({ hash: lockTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
const terminalResult = requireSuccess(receipt, "policy lock");
const finalPolicy = checkPolicy(await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]), true);
let updateSimulation = "REJECTED";
try { await client.simulateWriteContract({ account, address: SENTINEL, functionName: "update_emergency_policy", args: [PROTOCOL_ID, FAILURE_CLASS, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n], fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); updateSimulation = "UNEXPECTED_SUCCESS"; } catch {}
let secondLockSimulation = "REJECTED";
try { await client.simulateWriteContract({ account, address: SENTINEL, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); secondLockSimulation = "UNEXPECTED_SUCCESS"; } catch {}
if (updateSimulation !== "REJECTED" || secondLockSimulation !== "REJECTED") throw new Error("immutability simulation failed");
const finalProtected = await protectedState(client);
checkProtected(finalProtected);
const after = await preflight(client, account);
const oldAddress = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584".toLowerCase();
const advisoryFiles = ["tools/build_advisory.py", "evidence/advisories/incident-template.json", "evidence/advisories/recovery-template.json", "docs/FINAL_ADVISORY_SOURCE.md"];
const advisoryMatches = {};
for (const file of advisoryFiles) advisoryMatches[file] = (await readFile(`${ROOT}/${file}`, "utf8")).toLowerCase().includes(oldAddress);
const advisoryToolHardcodesOldTarget = advisoryMatches[advisoryFiles[0]];
const advisoryTemplatesReferenceOldTarget = advisoryMatches[advisoryFiles[1]] || advisoryMatches[advisoryFiles[2]];
await writeEvidence("CORRECTED_POLICY_LOCK.txt", ["CORRECTED POLICY LOCK", `SENTINEL_ADDRESS: ${SENTINEL}`, `PROTECTED_DEMO_ADDRESS: ${PROTECTED}`, `TRANSACTION_HASH: ${lockTx}`, `BROADCAST_COUNT: 1`, `FINAL_STATUS: ${terminalResult.status}`, `CONSENSUS: ${terminalResult.consensus}`, `EXECUTION: ${terminalResult.execution}`, `FINAL_POLICY_LOCKED: ${finalPolicy.policy_locked}`, `FINAL_POLICY: ${JSON.stringify(finalPolicy)}`, `UPDATE_AFTER_LOCK_SIMULATION: ${updateSimulation}`, `SECOND_LOCK_SIMULATION: ${secondLockSimulation}`, `FINAL_PROTECTED_STATE: ${JSON.stringify(safe(finalProtected))}`, `BALANCE_AFTER_WEI: ${after.balanceWei}`, `LATEST_NONCE_AFTER: ${after.latestNonce}`, `PENDING_NONCE_AFTER: ${after.pendingNonce}`, `INCIDENT_CREATED: NO`, `EVIDENCE_BOUND: NO`, `ADVISORY_TOOL_HARDCODES_OLD_TARGET: ${advisoryToolHardcodesOldTarget ? "YES" : "NO"}`, `ADVISORY_TEMPLATES_REFERENCE_OLD_TARGET: ${advisoryTemplatesReferenceOldTarget ? "YES" : "NO"}`]);
console.log(JSON.stringify({ event: "CORRECTED_POLICY_LOCKED", sentinel: SENTINEL, protectedDemo: PROTECTED, lockTx, terminal: terminalResult, policy: finalPolicy, updateSimulation, secondLockSimulation, protected: safe(finalProtected), before, after, advisoryToolHardcodesOldTarget, advisoryTemplatesReferenceOldTarget }, (_, value) => typeof value === "bigint" ? value.toString() : value));
