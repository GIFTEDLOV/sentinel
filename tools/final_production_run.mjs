import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { abi, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ACTOR = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const SMOKE = process.env.SENTINEL_MIGRATION_SMOKE === "1";
const SMOKE_DIR = process.env.SENTINEL_MIGRATION_SMOKE_DIR || "migration-smoke-regression-fix";
const RECOVERY_COOLDOWN = SMOKE ? 5n : 900n;
const ZERO = "0x0000000000000000000000000000000000000000";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const DOMAINS = "studio-next.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const ADVISORY_PREFIX = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const SENTINEL_SHA = "49E50797E3201B09F9EABDBF21EDF61C532887687E049CC6371E63BCF0BE45ED";
const DEMO_SHA = "7D684E6CA326981018ED63EECC4EEC8C6C4D1B8FF91BC20037E2BA38175FCFBD";
const SENTINEL_SOURCE = `${ROOT}/contracts/sentinel.py`;
const DEMO_SOURCE = `${ROOT}/contracts/protected_demo.py`;
const OUT_DIR = `${ROOT}/deploy/evidence/${SMOKE ? SMOKE_DIR : (process.env.SENTINEL_FINAL_OUTPUT_DIR || "final-production")}`;
const JOURNAL_PATH = `${OUT_DIR}/FINAL_TRANSACTION_JOURNAL.json`;
const STATE_PATH = `${OUT_DIR}/FINAL_RUN_STATE.json`;
const FEE_PROFILE_PATH = `${ROOT}/deploy/evidence/final-v5/STUDIO_NEXT_FEE_PROFILE.json`;
const EVIDENCE_REPO = `${ROOT}/_sentinel-evidence-publish`;

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function lower(value) { return String(value ?? "").toLowerCase(); }
function first(value, names) { for (const name of names) if (value && value[name] !== undefined && value[name] !== null) return value[name]; return null; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status", "consensus"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult", "execution"]),
    contractAddress: first(receipt?.data, ["contract_address", "contractAddress"]) ?? first(receipt, ["contractAddress", "contract_address"]),
  };
}
function requireSuccess(receipt, label) {
  const t = terminal(receipt);
  if (String(t.status).toUpperCase() !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(String(t.consensus).toUpperCase()) || String(t.execution).toUpperCase() !== "FINISHED_WITH_RETURN") throw new Error(`${label}: terminal gate failed ${JSON.stringify(t)}`);
  return t;
}
function sha(path) { return readFile(path).then((bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase()); }

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  if (end < 0) throw new Error("GenLayer CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, BaseAction };");
  transformed = transformed.replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};");
  transformed = transformed.replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    return `${prefix}${quote}${new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const sdk = await loadSdk();
function chain() { return { ...studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } }; }
async function clientFor(alias) {
  const action = new sdk.BaseAction(); action.accountOverride = alias;
  const account = await action.getAccount(false);
  const client = createClient({ chain: chain(), endpoint: RPC, account });
  return { account, client };
}

let journal;
let state;
try {
  journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8"));
  const failed = journal.entries?.find((entry) => entry.label === "PROTECTED_DEMO_DEPLOY" && entry.ambiguousHash === "0xe326df9044d59939b0e95d6201bb33ad49e5c584d08c7febec680e8f2062fb10" && !entry.txHash);
  if (!failed) throw new Error("FINAL_TRANSACTION_JOURNAL.json already exists; refusing a blind second run");
  state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  journal.resume = { afterReconciledFailedHash: failed.ambiguousHash, failure: "FeesDistributionMissing", noContractAddress: true };
} catch (error) {
  if (!String(error?.code).includes("ENOENT")) throw error;
  journal = { network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, sourceHashes: { sentinel: SENTINEL_SHA, protectedDemo: DEMO_SHA }, entries: [] };
  state = { network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, sourceHashes: { sentinel: SENTINEL_SHA, protectedDemo: DEMO_SHA } };
}
await mkdir(OUT_DIR, { recursive: true });
async function persist() { await writeFile(JOURNAL_PATH, JSON.stringify(safe(journal), null, 2) + "\n", "utf8"); await writeFile(STATE_PATH, JSON.stringify(safe(state), null, 2) + "\n", "utf8"); }
async function record(entry) { journal.entries.push(safe(entry)); await persist(); }
async function update(patch) { state = { ...state, ...safe(patch) }; await persist(); }

async function preflight(client, account, role) {
  const [chainId, balance, latest, pending] = await Promise.all([
    client.request({ method: "eth_chainId" }), client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }), client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const expected = role === "actor" ? ACTOR : OWNER;
  const result = { role, account: account.address, rpc: RPC, chainId: Number.parseInt(chainId, 16), balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== expected || result.latestNonce !== result.pendingNonce) throw new Error(`preflight failed ${JSON.stringify(result)}`);
  return result;
}
async function read(client, address, functionName, args = []) { return client.readContract({ address, functionName, args, jsonSafeReturn: true }); }
async function demoState(client, address = state.demoAddress) {
  return { paused: await read(client, address, "is_paused"), remediated: await read(client, address, "is_remediated"), treasury: await read(client, address, "get_treasury_state"), lastOutflow: await read(client, address, "get_last_outflow"), totalProcessed: await read(client, address, "get_total_processed"), counters: await read(client, address, "get_pause_counters") };
}
async function policy(client) { return read(client, state.sentinelAddress, "get_protocol", [PROTOCOL_ID]); }
function calldata(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args") ?? [];
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) throw new Error(`${method}: ABI roundtrip failed`);
  return { method, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: safe(decoded) };
}
async function currentFees(client, account, address, functionName, args, allowProfile = false) {
  try {
    const fees = address ? await client.estimateTransactionFeesForWrite({ account, address, functionName, args, appealRounds: 1n, rotations: [0n, 0n] }) : await client.estimateTransactionFees({ account, appealRounds: 1n, rotations: [0n, 0n] });
    if (BigInt(fees.feeValue) <= 0n) throw new Error("zero fee estimate");
    return { fees, method: "current genlayer-js estimateTransactionFees policy path" };
  } catch (error) {
    if (!allowProfile) throw error;
    const profile = JSON.parse(await readFile(FEE_PROFILE_PATH, "utf8"));
    const p = profile.finalFeeValues?.protectedDemoDeployment ?? profile.estimates?.protectedDemoDeployment;
    if (!p?.feeValue || !p.distribution) throw new Error(`no measured fallback fee profile: ${error}`);
    const d = p.distribution;
    return { fees: { leaderTimeunitsAllocation: BigInt(d.leaderTimeunitsAllocation), validatorTimeunitsAllocation: BigInt(d.validatorTimeunitsAllocation), appealRounds: BigInt(d.appealRounds), executionBudgetPerRound: BigInt(d.executionBudgetPerRound), totalMessageFees: BigInt(d.totalMessageFees), rotations: d.rotations.map(BigInt), maxPriceGenPerTimeUnit: BigInt(d.maxPriceGenPerTimeUnit), storageFeeMaxGasPrice: BigInt(d.storageFeeMaxGasPrice), receiptFeeMaxGasPrice: BigInt(d.receiptFeeMaxGasPrice), transactionHashVariant: "latest-nonfinal", feeValue: BigInt(p.feeValue) }, method: "existing measured Studio Next v0.6 policy profile fallback after exact known stale-clock simulation failure" };
  }
}
function extractHash(error) { const match = String(error?.message ?? error).match(/0x[a-fA-F0-9]{64}/); return match?.[0] ?? null; }
async function reconcile(client, hash, label) {
  let decision;
  try { decision = await client.waitForDecision({ hash, interval: 5000, retries: 120, fullTransaction: true }); } catch (error) { throw new Error(`${label}: decision wait failed for same hash ${hash}: ${error}`); }
  let final;
  try { final = await client.waitForFinalization({ hash, interval: 5000, retries: 120, fullTransaction: true }); } catch (error) { throw new Error(`${label}: finalization wait failed for same hash ${hash}: ${error}`); }
  if (!isSuccessful(final)) throw new Error(`${label}: isSuccessful=false ${JSON.stringify(safe(terminal(final)))}`);
  return { decision: terminal(decision), final: terminal(final), receipt: safe(final) };
}
async function writeOp({ label, alias, role, address, functionName, args, before, after, timeGate = false }) {
  const { account, client } = await clientFor(alias);
  const beforeState = await before(client);
  const pre = await preflight(client, account, role);
  const call = calldata(functionName, args);
  let feeInfo;
  let simulation = null;
  try { feeInfo = await currentFees(client, account, address, functionName, args, timeGate); } catch (error) { throw new Error(`${label}: fee preparation failed before broadcast: ${error}`); }
  try {
    simulation = await client.simulateWriteContract({ account, address, functionName, args, fees: feeInfo.fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  } catch (error) {
    const text = String(error?.shortMessage ?? error?.message ?? error), receipt = error?.cause?.data?.receipt ?? error?.data?.receipt ?? {};
    let decodedResult = "";
    try { decodedResult = typeof receipt.result === "string" ? Buffer.from(receipt.result, "base64").toString("utf8").replace(/[\u0000-\u001f]+/g, " ").trim() : ""; } catch {}
    if (!timeGate || !(text.includes("Recovery cooldown has not elapsed") || decodedResult.includes("Recovery cooldown has not elapsed"))) throw new Error(`${label}: simulation rejected: ${text}`);
    const simulatedNow = receipt.current_timestamp ?? receipt.created_timestamp ?? receipt.timestamp ?? "1732603362";
    const canonical = await client.request({ method: "gen_getTransactionLifecycle", params: [{ txId: state.confirmPauseTx }] });
    const canonicalNow = BigInt(String(canonical.evaluatedAt ?? canonical.evaluated_at));
    const anchor = BigInt(String(state.pauseConfirmedAt)), eligible = anchor + RECOVERY_COOLDOWN, margin = SMOKE ? 0n : 60n;
    if (canonicalNow < eligible + margin || BigInt(String(simulatedNow)) >= eligible) throw new Error(`${label}: known clock contradiction not proven ${JSON.stringify({ simulatedNow, canonicalNow: canonicalNow.toString(), anchor: anchor.toString(), eligible: eligible.toString(), margin: margin.toString() })}`);
    state.simulationFalseNegative = { exactError: decodedResult || text, simulatedGenVmNow: String(simulatedNow), canonicalNodeNow: canonicalNow.toString(), recoveryEligibleAt: eligible.toString(), proven: true };
    await update({ simulationFalseNegative: state.simulationFalseNegative });
    simulation = { status: "KNOWN_STALE_CLOCK_FALSE_NEGATIVE", error: decodedResult || text, simulatedGenVmNow: String(simulatedNow), canonicalNodeNow: canonicalNow.toString() };
  }
  const beforeBroadcast = await preflight(client, account, role);
  if (beforeBroadcast.latestNonce !== pre.latestNonce) throw new Error(`${label}: nonce changed before broadcast`);
  let tx;
  try { tx = await client.writeContract({ account, address, functionName, args, fees: feeInfo.fees }); }
  catch (error) {
    const hash = extractHash(error);
    await record({ label, address, functionName, args: safe(args), nonce: beforeBroadcast.latestNonce, fees: safe(feeInfo.fees), feeMethod: feeInfo.method, simulation: safe(simulation), broadcastCount: 1, submissionError: String(error), ambiguousHash: hash });
    throw new Error(`${label}: SDK submission failed${hash ? ` after sending ${hash}` : " without a recoverable hash"}; refusing retry`);
  }
  await record({ label, txHash: tx, address, functionName, args: safe(args), nonce: beforeBroadcast.latestNonce, fees: safe(feeInfo.fees), feeMethod: feeInfo.method, simulation: safe(simulation), broadcastCount: 1, phase: "SUBMITTED" });
  const terminalResult = await reconcile(client, tx, label);
  const postState = await after(client, tx);
  await record({ label, txHash: tx, nonce: beforeBroadcast.latestNonce, terminal: terminalResult, postState, phase: "FINALIZED_DECIDED_EXECUTION_VERIFIED_STATE_VERIFIED" });
  return { tx, client, account, fees: feeInfo.fees, feeMethod: feeInfo.method, simulation, terminal: terminalResult, beforeState, postState, calldata: call };
}
async function deployOp(label, code, args, expectedSha) {
  const { account, client } = await clientFor("beacon-final-deployer");
  const pre = await preflight(client, account, "owner");
  const feeInfo = await currentFees(client, account, null, null, args, true);
  let tx;
  try { tx = await client.deployContract({ account, code, args, fees: feeInfo.fees }); }
  catch (error) {
    const hash = extractHash(error); await record({ label, nonce: pre.latestNonce, fees: safe(feeInfo.fees), feeMethod: feeInfo.method, broadcastCount: 1, submissionError: String(error), ambiguousHash: hash });
    throw new Error(`${label}: deployment submission failed${hash ? ` after sending ${hash}` : ""}; refusing retry`);
  }
  await record({ label, txHash: tx, nonce: pre.latestNonce, args: safe(args), fees: safe(feeInfo.fees), feeMethod: feeInfo.method, broadcastCount: 1, phase: "SUBMITTED" });
  const terminalResult = await reconcile(client, tx, label);
  const address = terminalResult.final.contractAddress;
  if (!address) throw new Error(`${label}: finalized receipt has no contract address`);
  const encoded = await client.request({ method: "gen_getContractCode", params: [address] });
  const deployedSha = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex").toUpperCase();
  if (deployedSha !== expectedSha) throw new Error(`${label}: deployed source mismatch ${deployedSha}`);
  await record({ label, txHash: tx, nonce: pre.latestNonce, address, deployedSha, terminal: terminalResult, phase: "FINALIZED_DECIDED_EXECUTION_VERIFIED_CODE_VERIFIED" });
  return { client, account, tx, address, terminal: terminalResult, deployedSha };
}
function canonicalFacts(payload) {
  const data = payload.data;
  const input = first(payload, ["input", "txCallData"]) ?? first(data, ["calldata", "input"]);
  const facts = { consensus: String(first(payload, ["result_name", "consensusResultName", "consensus_status"])).toUpperCase(), event_timestamp: Number(BigInt(String(payload.created_timestamp ?? payload.timestamp ?? payload.createdTimestamp ?? payload.timestamp_created))), execution: String(first(payload, ["txExecutionResultName", "execution_result_name"])).toUpperCase(), hash: String(first(payload, ["hash", "id", "tx_id"])).toLowerCase(), input: String(input), origin: String(first(payload, ["origin_address", "txOrigin"]) ?? first(payload, ["sender", "from_address", "from"])).toLowerCase(), sender: String(first(payload, ["sender", "from_address", "from"])).toLowerCase(), status: String(first(payload, ["status", "statusName", "status_name"])).toUpperCase(), target: String(first(payload, ["recipient", "to_address", "to"])).toLowerCase() };
  return { facts, digest: createHash("sha256").update(JSON.stringify(facts)).digest("hex"), input: facts.input };
}
async function txFacts(client, hash, expectedTarget, expectedSender) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }) });
  const envelope = await response.json();
  const payload = envelope?.result ?? envelope;
  const facts = canonicalFacts(payload);
  if (facts.facts.hash !== lower(hash) || facts.facts.target !== lower(expectedTarget) || facts.facts.sender !== lower(expectedSender) || facts.facts.status !== "FINALIZED" || facts.facts.execution !== "FINISHED_WITH_RETURN" || !["MAJORITY_AGREE", "ACCEPTED"].includes(facts.facts.consensus)) throw new Error(`canonical facts failed ${JSON.stringify(facts)}`);
  return facts;
}
const GIT_EXE = "C:/Program Files/Git/cmd/git.exe";
function git(args) { const env = { ...process.env, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR || `${ROOT}/.gh-auth`, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || `${ROOT}/.gitconfig-gh` }; for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key]; return execFileSync(GIT_EXE, ["-C", EVIDENCE_REPO, ...args], { env, encoding: "utf8" }).trim(); }
function ghToken() { const env = { ...process.env, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR || `${ROOT}/.gh-auth` }; for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key]; return execFileSync("C:/Program Files/GitHub CLI/gh.exe", ["auth", "token"], { env, encoding: "utf8" }).trim(); }
async function publishAdvisory({ kind, incidentId, demoAddress, txHash, current, critical, mitigation, summary }) {
  const fileName = `${kind}-${incidentId}.json`;
  const relative = `evidence/advisories/${fileName}`;
  const path = `${EVIDENCE_REPO}/${relative}`;
  try { await access(path); throw new Error(`advisory already exists: ${relative}`); } catch (error) { if (!String(error?.code).includes("ENOENT")) throw error; }
  const document = { schema: "sentinel-advisory-v1", protocol_id: PROTOCOL_ID, protocol_address: demoAddress, network: "Studio Next", canonical_rpc: RPC, incident_id: incidentId, phase: kind.startsWith("recovery") ? "RECOVERY" : "EMERGENCY", failure_class: FAILURE, status: kind.startsWith("recovery") ? "REMEDIATED" : "ACTIVE", transaction_hash: txHash, issued_at: new Date().toISOString(), current, critical_signal: critical, mitigation_complete: mitigation, summary, facts: [{ name: "transaction", value: txHash }, { name: "target", value: demoAddress }, { name: "rpc", value: RPC }] };
  await writeFile(path, JSON.stringify(document, null, 2) + "\n", "utf8");
  if (git(["status", "--short", "--", relative])) throw new Error(`advisory path was already dirty: ${relative}`);
  git(["-c", "http.sslBackend=openssl", "fetch", "origin", "main"]); git(["add", relative]); git(["commit", "-m", `Publish final production ${kind} advisory`]); const token = ghToken(); if (!token) throw new Error("gh auth token unavailable"); const basic = Buffer.from(`x-access-token:${token}`).toString("base64"); git(["-c", "http.sslBackend=openssl", "-c", `http.extraHeader=Authorization: Basic ${basic}`, "push", "origin", "HEAD:main"]);
  const commit = git(["rev-parse", "HEAD"]);
  const body = await readFile(path); const digest = createHash("sha256").update(body).digest("hex");
  const raw = await (await fetch(`${ADVISORY_PREFIX}${fileName}`, { cache: "no-store" })).arrayBuffer();
  const rawDigest = createHash("sha256").update(Buffer.from(raw)).digest("hex");
  if (digest !== rawDigest) throw new Error(`raw advisory digest mismatch ${digest} ${rawDigest}`);
  return { file: path, url: `${ADVISORY_PREFIX}${fileName}`, commit, digest, bytes: body.length, document };
}

const sentinelSource = await readFile(SENTINEL_SOURCE, "utf8");
const demoSource = await readFile(DEMO_SOURCE, "utf8");
const [sentinelSha, demoSha] = await Promise.all([sha(SENTINEL_SOURCE), sha(DEMO_SOURCE)]);
if (sentinelSha !== SENTINEL_SHA || demoSha !== DEMO_SHA) throw new Error("frozen source hash gate failed");
const owner = await clientFor("beacon-final-deployer");
const actor = await clientFor("player2");
const [ownerPre, actorPre] = await Promise.all([preflight(owner.client, owner.account, "owner"), preflight(actor.client, actor.account, "actor")]);
await update({ ownerPreflight: ownerPre, actorPreflight: actorPre, canonicalSourceHashes: { sentinel: sentinelSha, protectedDemo: demoSha } });
const [sentinelSchema, demoSchema] = await Promise.all([owner.client.request({ method: "gen_getContractSchemaForCode", params: [sentinelSource] }), owner.client.request({ method: "gen_getContractSchemaForCode", params: [demoSource] })]);
if (!sentinelSchema?.methods?.bind_evidence || sentinelSchema.methods.bind_evidence.params.some((p) => p[0] === "observed_at")) throw new Error("hosted Sentinel schema gate failed");
if (!demoSchema?.methods?.execute_outflow || !demoSchema?.methods?.apply_remediation) throw new Error("hosted ProtectedDemo schema gate failed");
await update({ hostedSchema: { sentinelMethods: Object.keys(sentinelSchema.methods).sort(), protectedDemoMethods: Object.keys(demoSchema.methods).sort() } });

const deployedDemo = await deployOp("PROTECTED_DEMO_DEPLOY", demoSource, [ZERO], DEMO_SHA);
state.demoAddress = deployedDemo.address;
await update({ demoAddress: deployedDemo.address, protectedDemoDeployTx: deployedDemo.tx });
const deployedSentinel = await deployOp("SENTINEL_DEPLOY", sentinelSource, [], SENTINEL_SHA);
state.sentinelAddress = deployedSentinel.address;
await update({ sentinelAddress: deployedSentinel.address, sentinelDeployTx: deployedSentinel.tx });

const initial = await demoState(owner.client, state.demoAddress);
if (initial.paused !== false || initial.remediated !== false || String(initial.treasury.treasury_balance) !== "1000" || String(initial.treasury.total_outflow) !== "0") throw new Error(`initial target mismatch ${JSON.stringify(safe(initial))}`);
const configure = await writeOp({ label: "CONFIGURE_SENTINEL", alias: "beacon-final-deployer", role: "owner", address: state.demoAddress, functionName: "configure_sentinel", args: [state.sentinelAddress], before: async (client) => ({ state: await demoState(client) }), after: async (client) => { const s = await demoState(client); if (lower(await read(client, state.demoAddress, "get_authorized_sentinel")) !== lower(state.sentinelAddress) || s.paused !== false) throw new Error("configure readback failed"); return s; } });
await update({ configureTx: configure.tx });
const policyArgs = [PROTOCOL_ID, state.demoAddress, FAILURE, DOMAINS, PREFIX, RPC, 2n, 3600n, RECOVERY_COOLDOWN];
const register = await writeOp({ label: "REGISTER_POLICY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "register_protected_protocol", args: policyArgs, before: async (client) => ({}), after: async (client) => { const p = await policy(client); if (lower(p.target_address) !== lower(state.demoAddress) || p.minimum_sources !== 2 && String(p.minimum_sources) !== "2") throw new Error("policy register readback failed"); return p; } });
await update({ registerPolicyTx: register.tx });
const lock = await writeOp({ label: "LOCK_POLICY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "lock_emergency_policy", args: [PROTOCOL_ID], before: async (client) => policy(client), after: async (client) => { const p = await policy(client); if (p.policy_locked !== true) throw new Error("policy lock readback failed"); return p; } });
await update({ lockPolicyTx: lock.tx, policyLocked: true });

const baseline = await writeOp({ label: "HEALTHY_BASELINE", alias: "beacon-final-deployer", role: "owner", address: state.demoAddress, functionName: "process", args: [1n], before: async (client) => demoState(client), after: async (client) => { const s = await demoState(client); if (String(s.totalProcessed) !== "1" || s.paused !== false) throw new Error("baseline readback failed"); return s; } });
await update({ healthyBaselineTx: baseline.tx, totalProcessedAfterBaseline: "1" });
const outflow = await writeOp({ label: "CONTROLLED_OUTFLOW_100", alias: "player2", role: "actor", address: state.demoAddress, functionName: "execute_outflow", args: [ACTOR, 100n], before: async (client) => demoState(client), after: async (client, tx) => { const s = await demoState(client); if (s.paused !== false || s.remediated !== false || String(s.treasury.treasury_balance) !== "900" || String(s.treasury.total_outflow) !== "100" || lower(s.lastOutflow.actor) !== ACTOR) throw new Error(`outflow readback failed ${JSON.stringify(safe(s))}`); const f = await txFacts(client, tx, state.demoAddress, ACTOR); return { state: s, facts: f }; } });
const outflowFacts = outflow.postState.facts;
await update({ outflowTx: outflow.tx, outflowFacts: outflowFacts.facts, outflowDigest: outflowFacts.digest, outflowInput: outflowFacts.input });
const incidentId = `incident-${outflow.tx.slice(2, 14)}`;
const opened = await writeOp({ label: "CREATE_INCIDENT", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "open_incident", args: [incidentId, PROTOCOL_ID], before: async () => ({}), after: async (client) => read(client, state.sentinelAddress, "get_incident", [incidentId]) });
state.incidentId = incidentId; await update({ incidentId, incidentCreateTx: opened.tx });
const chainEvidenceId = `chain-${outflow.tx.slice(2, 14)}`;
const chainEvidence = await writeOp({ label: "BIND_INCIDENT_CHAIN_EVIDENCE", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "bind_evidence", args: [incidentId, chainEvidenceId, "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, outflowFacts.digest, outflow.tx, 0n, outflowFacts.input], before: async () => ({}), after: async (client) => read(client, state.sentinelAddress, "get_evidence", [chainEvidenceId]) });
await update({ chainEvidenceTx: chainEvidence.tx, chainEvidenceId });
const incidentAdvisory = await publishAdvisory({ kind: "incident", incidentId, demoAddress: state.demoAddress, txHash: outflow.tx, current: true, critical: true, mitigation: false, summary: "Authenticated chain evidence establishes a current unauthorized-drain signal for the protected protocol." });
const advisoryEvidenceId = `advisory-${outflow.tx.slice(2, 14)}`;
const advisoryEvidence = await writeOp({ label: "BIND_INCIDENT_ADVISORY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "bind_evidence", args: [incidentId, advisoryEvidenceId, "EMERGENCY", "SECURITY_ADVISORY", incidentAdvisory.url, FAILURE, incidentAdvisory.digest, outflow.tx, 1n, ""], before: async () => ({}), after: async (client) => read(client, state.sentinelAddress, "get_evidence", [advisoryEvidenceId]) });
await update({ incidentAdvisory, advisoryEvidenceTx: advisoryEvidence.tx, advisoryEvidenceId });
const assess = await writeOp({ label: "ASSESS_INCIDENT", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "assess_incident", args: [incidentId], before: async (client) => read(client, state.sentinelAddress, "get_incident", [incidentId]), after: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); if (i.state !== "ACTIVE_INCIDENT" || i.incident_verdict !== "ACTIVE_INCIDENT") throw new Error(`incident verdict failed ${JSON.stringify(i)}`); return i; } });
await update({ incidentAssessmentTx: assess.tx, incidentVerdict: "ACTIVE_INCIDENT" });
const pause = await writeOp({ label: "PAUSE_TARGET", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "execute_pause", args: [incidentId], before: async (client) => read(client, state.sentinelAddress, "get_incident", [incidentId]), after: async (client) => { const s = await demoState(client); if (s.paused !== true) throw new Error("pause target readback failed"); return s; } });
const confirm = await writeOp({ label: "CONFIRM_PAUSE", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "confirm_pause", args: [incidentId], before: async (client) => demoState(client), after: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); const s = await demoState(client); if (i.state !== "PAUSED" || s.paused !== true) throw new Error("pause confirmation failed"); return { incident: i, target: s }; } });
const pauseConfirmedAt = String(confirm.postState.incident.pause_confirmed_at); await update({ pauseTx: pause.tx, confirmPauseTx: confirm.tx, pauseConfirmedAt });
const containment = await (async () => { const { account: a, client: c } = await clientFor("player2"); const { account: o, client: oc } = await clientFor("beacon-final-deployer"); const outFees = (await currentFees(c, a, state.demoAddress, "execute_outflow", [ACTOR, 1n])).fees; const procFees = (await currentFees(oc, o, state.demoAddress, "process", [1n])).fees; const results = {}; for (const [name, cc, aa, args] of [["outflow", c, a, [ACTOR, 1n]], ["process", oc, o, [1n]]]) { try { await cc.simulateWriteContract({ account: aa, address: state.demoAddress, functionName: name === "outflow" ? "execute_outflow" : "process", args, fees: name === "outflow" ? outFees : procFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); results[name] = "UNEXPECTED_SUCCESS"; } catch (error) { results[name] = `REJECTED: ${String(error).slice(0, 300)}`; } } if (!results.outflow.startsWith("REJECTED") || !results.process.startsWith("REJECTED")) throw new Error(`containment failed ${JSON.stringify(results)}`); return results; })();
await update({ containment });
const remediation = await writeOp({ label: "REMEDIATION", alias: "beacon-final-deployer", role: "owner", address: state.demoAddress, functionName: "apply_remediation", args: [], before: async (client) => demoState(client), after: async (client) => { const s = await demoState(client); if (s.paused !== true || s.remediated !== true || String(s.treasury.treasury_balance) !== "900") throw new Error("remediation readback failed"); return s; } });
await update({ remediationTx: remediation.tx });

const begin = await writeOp({ label: "BEGIN_RECOVERY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "begin_recovery", args: [incidentId], timeGate: !SMOKE, before: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); const t = await demoState(client); const lifecycle = await client.request({ method: "gen_getTransactionLifecycle", params: [{ txId: state.confirmPauseTx }] }); const now = BigInt(String(lifecycle.evaluatedAt ?? lifecycle.evaluated_at)); const eligible = BigInt(String(i.pause_confirmed_at)) + RECOVERY_COOLDOWN; const margin = SMOKE ? 0n : 60n; if (i.state !== "PAUSED" || t.paused !== true || t.remediated !== true || now < eligible + margin) throw new Error(`begin preflight failed ${JSON.stringify({ i, t, now: now.toString(), eligible: eligible.toString() })}`); await update({ canonicalNodeNow: now.toString(), recoveryEligibleAt: eligible.toString(), cooldownPlusMarginMet: true }); return { incident: i, target: t }; }, after: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); if (i.state !== "RECOVERY_ASSESSING" || i.evidence_ids_csv !== "") throw new Error(`begin readback failed ${JSON.stringify(i)}`); return i; } });
await update({ beginRecoveryTx: begin.tx });
const recoveryChainId = `recovery-chain-${remediation.tx.slice(2, 14)}`;
const remediationFacts = await txFacts(begin.client, remediation.tx, state.demoAddress, OWNER);
const recoveryChain = await writeOp({ label: "BIND_RECOVERY_CHAIN_EVIDENCE", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "bind_evidence", args: [incidentId, recoveryChainId, "RECOVERY", "CHAIN_TRANSACTION", RPC, FAILURE, remediationFacts.digest, remediation.tx, 0n, remediationFacts.input], before: async () => ({}), after: async (client) => read(client, state.sentinelAddress, "get_evidence", [recoveryChainId]) });
await update({ recoveryChainEvidenceTx: recoveryChain.tx, recoveryChainEvidenceId: recoveryChainId, recoveryChainEvidenceFacts: remediationFacts.facts });
const recoveryAdvisory = await publishAdvisory({ kind: "recovery", incidentId, demoAddress: state.demoAddress, txHash: remediation.tx, current: false, critical: false, mitigation: true, summary: "Remediation finalized successfully; the protected target remains paused while Sentinel evaluates recovery." });
const recoveryAdvisoryId = `recovery-advisory-${remediation.tx.slice(2, 14)}`;
const recoveryBind = await writeOp({ label: "BIND_RECOVERY_ADVISORY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "bind_evidence", args: [incidentId, recoveryAdvisoryId, "RECOVERY", "SECURITY_ADVISORY", recoveryAdvisory.url, FAILURE, recoveryAdvisory.digest, remediation.tx, 1n, ""], before: async () => ({}), after: async (client) => read(client, state.sentinelAddress, "get_evidence", [recoveryAdvisoryId]) });
await update({ recoveryAdvisory, recoveryAdvisoryEvidenceTx: recoveryBind.tx, recoveryAdvisoryEvidenceId: recoveryAdvisoryId });
const recoveryAssess = await writeOp({ label: "ASSESS_RECOVERY", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "assess_recovery", args: [incidentId], before: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); const t = await demoState(client); if (i.state !== "RECOVERY_ASSESSING" || t.paused !== true || t.remediated !== true) throw new Error("recovery assess precondition failed"); return { incident: i, target: t }; }, after: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); if (i.state !== "RECOVERY_AUTHORIZED" || i.recovery_verdict !== "SAFE_TO_RECOVER") throw new Error(`recovery verdict failed ${JSON.stringify(i)}`); return i; } });
await update({ recoveryAssessmentTx: recoveryAssess.tx, recoveryVerdict: "SAFE_TO_RECOVER" });
const unpause = await writeOp({ label: "UNPAUSE_TARGET", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "execute_unpause", args: [incidentId], before: async (client) => read(client, state.sentinelAddress, "get_incident", [incidentId]), after: async (client) => { const s = await demoState(client); if (s.paused !== false || s.remediated !== true) throw new Error("unpause target readback failed"); return s; } });
const recovered = await writeOp({ label: "CONFIRM_RECOVERED", alias: "beacon-final-deployer", role: "owner", address: state.sentinelAddress, functionName: "confirm_recovered", args: [incidentId], before: async (client) => read(client, state.sentinelAddress, "get_incident", [incidentId]), after: async (client) => { const i = await read(client, state.sentinelAddress, "get_incident", [incidentId]); if (i.state !== "RECOVERED") throw new Error(`recovered readback failed ${JSON.stringify(i)}`); return i; } });
await update({ unpauseTx: unpause.tx, confirmRecoveredTx: recovered.tx, finalIncidentState: "RECOVERED" });
const post = await writeOp({ label: "POST_RECOVERY_PROCESS", alias: "beacon-final-deployer", role: "owner", address: state.demoAddress, functionName: "process", args: [1n], before: async (client) => demoState(client), after: async (client) => { const s = await demoState(client); if (String(s.totalProcessed) !== "2" || s.paused !== false || s.remediated !== true) throw new Error("post recovery process failed"); return s; } });
const nonowner = await (async () => { const { account, client } = await clientFor("player2"); const target = await demoState(client); if (target.paused !== false || target.remediated !== true || String(target.treasury.treasury_balance) !== "900" || String(target.treasury.total_outflow) !== "100") throw new Error("permanent fix precondition failed"); try { const fees = (await currentFees(client, account, state.demoAddress, "execute_outflow", [ACTOR, 1n])).fees; try { await client.simulateWriteContract({ account, address: state.demoAddress, functionName: "execute_outflow", args: [ACTOR, 1n], fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); return "UNEXPECTED_SUCCESS"; } catch (error) { return `REJECTED: ${String(error).slice(0, 400)}`; } } catch (error) { const receipt = error?.cause?.data?.receipt ?? error?.data?.receipt ?? {}; let decoded = ""; try { decoded = typeof receipt.result === "string" ? Buffer.from(receipt.result, "base64").toString("utf8").replace(/[\u0000-\u001f]+/g, " ").trim() : ""; } catch {} const text = String(error?.shortMessage ?? error?.message ?? error); if (text.includes("Outflow capability has been remediated") || decoded.includes("Outflow capability has been remediated")) return `REJECTED: ${decoded || text}`; throw error; } })();
if (!nonowner.startsWith("REJECTED")) throw new Error("post-recovery non-owner outflow simulation unexpectedly succeeded");
const finalTarget = await demoState(owner.client);
if (finalTarget.paused !== false || finalTarget.remediated !== true || String(finalTarget.treasury.treasury_balance) !== "900" || String(finalTarget.treasury.total_outflow) !== "100") throw new Error(`final target mismatch ${JSON.stringify(safe(finalTarget))}`);
await update({ postRecoveryProcessTx: post.tx, nonownerOutflowSimulation: nonowner, finalTarget, backendProtocolComplete: true, finishedAt: new Date().toISOString() });
console.log(JSON.stringify({ stage: "BACKEND_PROTOCOL_COMPLETE", state: safe(state), journal: JOURNAL_PATH }, null, 2));
