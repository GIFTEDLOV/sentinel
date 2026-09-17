import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { abi, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const PLAYER2 = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const SENTINEL = "0x8e7B0387F1C527d0cd14cCA9E76420952B5B483c";
const DEMO = "0x7F3F78291C3bE65d924C3e18bc65F7500E93c590";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const ADVISORY_PREFIX = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const SENTINEL_SHA = "7780D346ECCC497AE54DC93268FC42FD87B2266DB73168EDF07ACEA1E393A1E5";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const PROFILE_PATH = `${ROOT}/deploy/evidence/final-v4/STUDIO_NEXT_FEE_PROFILE.json`;
const STATE_PATH = `${ROOT}/deploy/evidence/final-v4/FINAL_V4_END_TO_END_PROOF.json`;
const PROOF_PATH = `${ROOT}/deploy/evidence/final-v4/FINAL_V4_END_TO_END_PROOF.txt`;
const ZERO = "0x0000000000000000000000000000000000000000";

function safe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) { return String(value).toLowerCase(); }

function chain() {
  return {
    ...studioDevnet,
    id: CHAIN_ID,
    name: "GenLayer Studio Next",
    nativeCurrency: { ...studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
}

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL("file://" + bundlePath).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    const resolved = req.resolve(spec);
    return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

let sdkPromise;
async function makeClient(alias) {
  sdkPromise ??= loadSdk();
  const { BaseAction } = await sdkPromise;
  const action = new BaseAction();
  action.accountOverride = alias;
  const account = await action.getAccount(false);
  const client = createClient({ chain: chain(), endpoint: RPC, account });
  return { account, client };
}

async function readContract(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, jsonSafeReturn: true });
}

async function rpcPreflight(client, account, label) {
  const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = {
    label,
    rpc: RPC,
    chainId: Number.parseInt(chainIdHex, 16),
    account: account.address,
    balanceWei: BigInt(balanceHex).toString(),
    latestNonce: Number.parseInt(latestHex, 16),
    pendingNonce: Number.parseInt(pendingHex, 16),
  };
  if (result.rpc !== RPC || result.chainId !== CHAIN_ID || result.latestNonce !== result.pendingNonce) {
    throw new Error(`${label}: network or pending nonce gate failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function terminal(receipt) {
  return {
    status: receipt.statusName ?? receipt.status_name ?? receipt.status ?? null,
    consensus: receipt.resultName ?? receipt.result_name ?? receipt.consensusStatus ?? receipt.consensus_status ?? null,
    execution: receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? receipt.txExecutionResult ?? receipt.tx_execution_result_name ?? null,
    contractAddress: receipt.contractAddress ?? receipt.contract_address ?? null,
  };
}

function requireSuccess(receipt, label) {
  const result = terminal(receipt);
  const status = String(result.status).toUpperCase();
  const consensus = String(result.consensus).toUpperCase();
  const execution = String(result.execution).toUpperCase();
  if (status !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(consensus) || execution !== "FINISHED_WITH_RETURN") {
    throw new Error(`${label}: terminal-success gate failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(`${method}: calldata roundtrip failed`);
  }
  return { method, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: safe(decoded) };
}

async function waitSameHash(client, hash, label) {
  try {
    return await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  } catch (error) {
    console.error(`${label}: receipt wait ambiguous; reconciling the same hash only`);
    let lastError = error;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const current = await client.getTransaction({ hash });
        if (String(terminal(current).status).toUpperCase() === "FINALIZED") return current;
      } catch (reconcileError) {
        lastError = reconcileError;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`${label}: same-hash reconciliation timed out: ${String(lastError)}`);
  }
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_PATH, "utf8")); } catch {
    const incidentId = `incident-studio-next-v4-${Date.now().toString(36)}`;
    const initial = {
      network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, sentinel: SENTINEL, protectedDemo: DEMO,
      owner: OWNER, player2: PLAYER2, protocolId: PROTOCOL_ID, failureClass: FAILURE,
      sourceHashes: { sentinel: SENTINEL_SHA, protectedDemo: DEMO_SHA },
      policy: { target: lower(DEMO), canonicalRpc: RPC, advisoryPrefix: ADVISORY_PREFIX, minimumSources: 2, maxAge: 3600, recoveryCooldown: 900, locked: true },
      incidentId, createdAt: new Date().toISOString(), writes: [],
    };
    await saveState(initial);
    return initial;
  }
}

async function saveState(state) {
  await mkdir(`${ROOT}/deploy/evidence/final-v4`, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(safe(state), null, 2) + "\n", "utf8");
}

async function log(lines) {
  await mkdir(`${ROOT}/deploy/evidence/final-v4`, { recursive: true });
  await appendFile(PROOF_PATH, lines.join("\n") + "\n", "utf8");
}

async function sourceHashes() {
  const sentinel = createHash("sha256").update(await readFile(`${ROOT}/contracts/sentinel.py`)).digest("hex").toUpperCase();
  const protectedDemo = createHash("sha256").update(await readFile(`${ROOT}/contracts/protected_demo.py`)).digest("hex").toUpperCase();
  if (sentinel !== SENTINEL_SHA || protectedDemo !== DEMO_SHA) throw new Error(`frozen source hash gate failed: ${sentinel} ${protectedDemo}`);
  return { sentinel, protectedDemo };
}

async function policy(client) {
  const p = await readContract(client, SENTINEL, "get_protocol", [PROTOCOL_ID]);
  const actual = {
    target: lower(p.target_address),
    failureClass: p.critical_failure_class,
    domains: p.allowed_source_domains,
    prefixes: p.allowed_source_prefixes,
    canonicalRpc: p.canonical_rpc_endpoint,
    minimumSources: Number(p.minimum_sources),
    maxAge: Number(p.max_evidence_age_seconds),
    recoveryCooldown: Number(p.recovery_cooldown_seconds),
    locked: p.policy_locked,
  };
  const expected = { target: lower(DEMO), failureClass: FAILURE, domains: "studio-next.genlayer.com,raw.githubusercontent.com", prefixes: "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/", canonicalRpc: RPC, minimumSources: 2, maxAge: 3600, recoveryCooldown: 900, locked: true };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`locked policy mismatch: ${JSON.stringify(actual)}`);
  return actual;
}

async function demoState(client) {
  return {
    owner: await readContract(client, DEMO, "get_owner"),
    authorizedSentinel: await readContract(client, DEMO, "get_authorized_sentinel"),
    controllerConfigured: await readContract(client, DEMO, "is_controller_configured"),
    paused: await readContract(client, DEMO, "is_paused"),
    remediated: await readContract(client, DEMO, "is_remediated"),
    totalProcessed: await readContract(client, DEMO, "get_total_processed"),
    treasury: await readContract(client, DEMO, "get_treasury_state"),
    lastOutflow: await readContract(client, DEMO, "get_last_outflow"),
    counters: await readContract(client, DEMO, "get_pause_counters"),
  };
}

function assertInitial(state) {
  if (lower(state.owner) !== OWNER || lower(state.authorizedSentinel) !== lower(SENTINEL) || state.controllerConfigured !== true || state.paused !== false || state.remediated !== false || String(state.treasury.treasury_balance) !== "1000" || String(state.treasury.total_outflow) !== "0" || String(state.totalProcessed) !== "0" || String(state.counters.pause_count) !== "0" || String(state.counters.unpause_count) !== "0") {
    throw new Error(`initial ProtectedDemo state mismatch: ${JSON.stringify(safe(state))}`);
  }
}

function assertOutflow(state) {
  if (state.paused !== false || state.remediated !== false || String(state.treasury.treasury_balance) !== "900" || String(state.treasury.total_outflow) !== "100" || lower(state.lastOutflow.actor) !== PLAYER2 || String(state.lastOutflow.amount) !== "100" || lower(state.lastOutflow.recipient) !== PLAYER2) throw new Error(`outflow state mismatch: ${JSON.stringify(safe(state))}`);
}

function assertTerminal(receipt, label) { return requireSuccess(receipt, label); }

async function estimate(client, account, address, functionName, args) {
  const base = { account, appealRounds: 1n, rotations: [0n, 0n] };
  if (address) return client.estimateTransactionFeesForWrite({ ...base, address, functionName, args });
  return client.estimateTransactionFees(base);
}

async function writeOnce(state, { key, label, alias, address, functionName, args, before, after }) {
  if (state[key]) throw new Error(`${label}: transaction already recorded as ${state[key]}; refusing to rebroadcast`);
  const { account, client } = await makeClient(alias);
  const preflight = await rpcPreflight(client, account, `${label} preflight`);
  if (before) await before(client, account, state);
  const calldata = calldataRoundtrip(functionName, args);
  const fees = await estimate(client, account, address, functionName, args);
  if (BigInt(preflight.balanceWei) < BigInt(fees.feeValue)) throw new Error(`${label}: insufficient balance for live fee quote`);
  const simulation = await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const simTerminal = terminal(simulation.receipt ?? {});
  state.writes.push({ label, phase: "SIMULATION", account: account.address, calldata, fees: safe(fees), simulation: safe(simTerminal) });
  await saveState(state);
  console.log(JSON.stringify({ label, preflight, calldata, fees: safe(fees), simulation: safe(simTerminal) }, null, 2));
  const tx = await client.writeContract({ account, address, functionName, args, fees });
  state[key] = tx;
  state.writes.push({ label, phase: "BROADCAST", tx });
  await saveState(state);
  console.log(JSON.stringify({ label, broadcast: tx }));
  const receipt = await waitSameHash(client, tx, label);
  const terminalResult = assertTerminal(receipt, label);
  if (after) await after(client, account, state, receipt);
  state.writes.push({ label, phase: "FINALIZED", tx, terminal: terminalResult });
  await saveState(state);
  await log([`${label}_TX: ${tx}`, `${label}_TERMINAL: ${JSON.stringify(terminalResult)}`, `${label}_CALLDATA: ${JSON.stringify(calldata)}`, `${label}_FEES: ${JSON.stringify(safe(fees))}`]);
  console.log(JSON.stringify({ label, tx, terminal: terminalResult }, null, 2));
  return { tx, receipt, terminal: terminalResult, fees, calldata, client, account };
}

async function rawTransaction(client, hash) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }) });
  const envelope = await response.json();
  if (!response.ok || envelope?.error) throw new Error(`canonical RPC transaction lookup failed: ${JSON.stringify(envelope)}`);
  if (!envelope?.result || typeof envelope.result !== "object") throw new Error(`canonical RPC transaction response was not an object: ${JSON.stringify(envelope)}`);
  return envelope.result;
}

function canonicalFacts(result, expectedHash, expectedSender, expectedTarget, expectedInput) {
  const first = (names) => names.map((name) => result?.[name]).find((value) => typeof value === "string" && value !== "");
  const returnedHash = first(["hash", "id", "tx_id"]);
  const sender = first(["sender", "from_address", "from"]);
  const origin = first(["origin_address", "txOrigin"]) ?? sender;
  const target = first(["recipient", "to_address", "to"]);
  const input = first(["input", "txCallData"]);
  const inputFallback = input ?? (result?.data && (result.data.calldata ?? result.data.input));
  const status = first(["status", "statusName", "status_name"]);
  const execution = first(["txExecutionResultName", "execution_result_name", "txExecutionResult"]);
  const consensus = first(["result_name", "consensusResultName", "consensus_status"]);
  const timestamp = result?.created_timestamp ?? result?.timestamp ?? result?.created_at;
  if (!returnedHash || !sender || !target || !inputFallback || !status || !execution || !consensus || timestamp === undefined) throw new Error(`canonical transaction fields missing: ${JSON.stringify(safe(result))}`);
  const facts = { hash: lower(returnedHash), sender: lower(sender), origin: lower(origin), target: lower(target), input: inputFallback, status: String(status).toUpperCase(), execution: String(execution).toUpperCase(), consensus: String(consensus).toUpperCase(), event_timestamp: Number(timestamp) };
  if (facts.hash !== lower(expectedHash) || facts.sender !== lower(expectedSender) || facts.target !== lower(expectedTarget) || (expectedInput !== undefined && facts.input !== expectedInput) || facts.status !== "FINALIZED" || facts.execution !== "FINISHED_WITH_RETURN" || !["MAJORITY_AGREE", "ACCEPTED"].includes(facts.consensus)) throw new Error(`canonical transaction authentication failed: ${JSON.stringify(facts)}`);
  const ordered = { consensus: facts.consensus, event_timestamp: facts.event_timestamp, execution: facts.execution, hash: facts.hash, input: facts.input, origin: facts.origin, sender: facts.sender, status: facts.status, target: facts.target };
  const digest = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  return { facts, digest, raw: result };
}

async function preflight() {
  const state = await loadState();
  const hashes = await sourceHashes();
  const { account: owner, client } = await makeClient("beacon-final-deployer");
  const { account: player2, client: actorClient } = await makeClient("player2");
  const [ownerPreflight, player2Preflight, lockedPolicy, target, schemaSentinel, schemaDemo, feePolicy, outflowFees] = await Promise.all([
    rpcPreflight(client, owner, "owner preflight"),
    rpcPreflight(actorClient, player2, "player2 preflight"),
    policy(client),
    demoState(client),
    client.request({ method: "gen_getContractSchemaForCode", params: [await readFile(`${ROOT}/contracts/sentinel.py`, "utf8")] }),
    client.request({ method: "gen_getContractSchemaForCode", params: [await readFile(`${ROOT}/contracts/protected_demo.py`, "utf8")] }),
    client.getCurrentFeePolicy(),
    estimate(actorClient, player2, DEMO, "execute_outflow", [PLAYER2, 100n]),
  ]);
  if (lower(owner.address) !== OWNER || lower(player2.address) !== PLAYER2) throw new Error("account identity mismatch");
  assertInitial(target);
  if ((schemaSentinel.methods?.bind_evidence?.params ?? []).some((item) => item[0] === "observed_at")) throw new Error("deployed schema exposes observed_at");
  const requiredSentinel = ["open_incident", "bind_evidence", "assess_incident", "execute_pause", "confirm_pause", "begin_recovery", "assess_recovery", "execute_unpause", "confirm_recovered", "get_incident", "get_evidence"];
  const requiredDemo = ["process", "execute_outflow", "apply_remediation", "emergency_pause", "emergency_unpause", "get_treasury_state", "get_last_outflow"];
  for (const method of requiredSentinel) if (!schemaSentinel.methods?.[method]) throw new Error(`hosted Sentinel schema missing ${method}`);
  for (const method of requiredDemo) if (!schemaDemo.methods?.[method]) throw new Error(`hosted ProtectedDemo schema missing ${method}`);
  state.preflight = { hashes, owner: ownerPreflight, player2: player2Preflight, policy: lockedPolicy, initialState: target, sentinelMethods: Object.keys(schemaSentinel.methods ?? {}).sort(), protectedDemoMethods: Object.keys(schemaDemo.methods ?? {}).sort(), feePolicy: safe(feePolicy), player2OutflowEstimate: safe(outflowFees), recoveryCooldownAnchor: "pause_confirmed_at", recoveryCooldownSeconds: 900, player2FundingRequired: BigInt(player2Preflight.balanceWei) < BigInt(outflowFees.feeValue) };
  await saveState(state);
  await log(["PREFLIGHT: PASS", `SOURCE_HASHES: ${JSON.stringify(hashes)}`, `OWNER_PREFLIGHT: ${JSON.stringify(ownerPreflight)}`, `PLAYER2_PREFLIGHT: ${JSON.stringify(player2Preflight)}`, `INITIAL_STATE: ${JSON.stringify(safe(target))}`, `POLICY: ${JSON.stringify(lockedPolicy)}`, `RECOVERY_COOLDOWN_ANCHOR: pause_confirmed_at`, `SCHEMAS: ${JSON.stringify({ sentinel: Object.keys(schemaSentinel.methods ?? {}).sort(), protectedDemo: Object.keys(schemaDemo.methods ?? {}).sort() })}`]);
  console.log(JSON.stringify({ stage: "PREFLIGHT", state: safe(state.preflight) }, null, 2));
}

async function baseline() {
  const state = await loadState();
  if (state.healthyBaselineTx) throw new Error("baseline already recorded; refusing repeat");
  const result = await writeOnce(state, { key: "healthyBaselineTx", label: "HEALTHY_BASELINE", alias: "beacon-final-deployer", address: DEMO, functionName: "process", args: [1n], before: async (client) => { const current = await demoState(client); assertInitial(current); } });
  const after = await demoState(result.client);
  if (after.paused !== false || after.remediated !== false || String(after.treasury.treasury_balance) !== "1000" || String(after.treasury.total_outflow) !== "0" || String(after.totalProcessed) !== "1") throw new Error(`healthy baseline readback failed: ${JSON.stringify(safe(after))}`);
  state.totalProcessedAfterBaseline = String(after.totalProcessed); state.healthyBaselineStatus = result.terminal; state.baselineState = after; await saveState(state); await log([`HEALTHY_BASELINE_STATE: ${JSON.stringify(safe(after))}`]);
}

async function reconcileBaseline() {
  const state = await loadState();
  if (!state.healthyBaselineTx) throw new Error("no recorded baseline hash to reconcile");
  const { client } = await makeClient("beacon-final-deployer");
  const receipt = await client.getTransaction({ hash: state.healthyBaselineTx });
  const terminalResult = assertTerminal(receipt, "HEALTHY_BASELINE_RECONCILE");
  const after = await demoState(client);
  if (after.paused !== false || after.remediated !== false || String(after.treasury.treasury_balance) !== "1000" || String(after.treasury.total_outflow) !== "0" || String(after.totalProcessed) !== "1") throw new Error(`healthy baseline reconciliation readback failed: ${JSON.stringify(safe(after))}`);
  state.healthyBaselineStatus = terminalResult; state.totalProcessedAfterBaseline = String(after.totalProcessed); state.baselineState = after; await saveState(state); await log([`HEALTHY_BASELINE_RECONCILED_TX: ${state.healthyBaselineTx}`, `HEALTHY_BASELINE_STATE: ${JSON.stringify(safe(after))}`]); console.log(JSON.stringify({ tx: state.healthyBaselineTx, terminal: terminalResult, state: safe(after) }, null, 2));
}

async function outflow() {
  const state = await loadState();
  if (state.outflowTx) throw new Error("outflow already recorded; refusing repeat");
  const { client } = await makeClient("beacon-final-deployer");
  const before = await demoState(client);
  if (before.paused !== false || before.remediated !== false || String(before.treasury.treasury_balance) !== "1000" || String(before.treasury.total_outflow) !== "0") throw new Error(`outflow precondition failed: ${JSON.stringify(safe(before))}`);
  const result = await writeOnce(state, { key: "outflowTx", label: "FINAL_OUTFLOW", alias: "player2", address: DEMO, functionName: "execute_outflow", args: [PLAYER2, 100n] });
  const after = await demoState(result.client);
  assertOutflow(after);
  const rpc = canonicalFacts(await rawTransaction(result.client, result.tx), result.tx, PLAYER2, DEMO, undefined);
  state.outflowStatus = result.terminal; state.outflowConsensus = result.terminal.consensus; state.outflowExecution = result.terminal.execution; state.outflowState = after; state.outflowRpc = rpc; state.outflowDigest = rpc.digest; state.outflowInput = rpc.facts.input; state.outflowEventTimestamp = rpc.facts.event_timestamp; await saveState(state); await log([`OUTFLOW_STATE: ${JSON.stringify(safe(after))}`, `OUTFLOW_RPC_FACTS: ${JSON.stringify(safe(rpc.facts))}`, `OUTFLOW_DIGEST: ${rpc.digest}`]);
}

async function reconcileOutflow() {
  const state = await loadState();
  if (!state.outflowTx) throw new Error("no recorded outflow hash to reconcile");
  const { client } = await makeClient("player2");
  const raw = await rawTransaction(client, state.outflowTx);
  const rpc = canonicalFacts(raw, state.outflowTx, PLAYER2, DEMO, undefined);
  const after = await demoState(client);
  assertOutflow(after);
  state.outflowStatus = state.writes.find((item) => item.label === "FINAL_OUTFLOW" && item.phase === "FINALIZED")?.terminal ?? state.outflowStatus;
  state.outflowConsensus = state.outflowStatus?.consensus ?? "MAJORITY_AGREE";
  state.outflowExecution = state.outflowStatus?.execution ?? "FINISHED_WITH_RETURN";
  state.outflowState = after; state.outflowRpc = rpc; state.outflowDigest = rpc.digest; state.outflowInput = rpc.facts.input; state.outflowEventTimestamp = rpc.facts.event_timestamp; await saveState(state); await log([`OUTFLOW_RECONCILED_TX: ${state.outflowTx}`, `OUTFLOW_STATE: ${JSON.stringify(safe(after))}`, `OUTFLOW_RPC_FACTS: ${JSON.stringify(safe(rpc.facts))}`, `OUTFLOW_DIGEST: ${rpc.digest}`]); console.log(JSON.stringify({ tx: state.outflowTx, terminal: state.outflowStatus, state: safe(after), rpcFacts: safe(rpc.facts), digest: rpc.digest }, null, 2));
}

async function openIncident() {
  const state = await loadState();
  if (state.incidentCreateTx) throw new Error("incident already recorded; refusing repeat");
  const { client } = await makeClient("beacon-final-deployer");
  const result = await writeOnce(state, { key: "incidentCreateTx", label: "FINAL_INCIDENT_CREATE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "open_incident", args: [state.incidentId, PROTOCOL_ID], before: async () => { await policy(client); } });
  const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]);
  if (incident.state !== "ASSESSING") throw new Error(`incident initial state mismatch: ${JSON.stringify(safe(incident))}`);
  state.incident = incident; state.incidentCreateStatus = result.terminal; await saveState(state); await log([`INCIDENT_ID: ${state.incidentId}`, `INCIDENT_STATE_AFTER_CREATE: ${JSON.stringify(safe(incident))}`]);
}

async function bindChain() {
  const state = await loadState();
  if (state.chainEvidenceTx) throw new Error("chain evidence already recorded; refusing repeat");
  if (!state.incidentCreateTx || !state.outflowTx) throw new Error("chain bind prerequisites missing");
  const { client } = await makeClient("beacon-final-deployer");
  const evidenceId = `chain-${state.outflowTx.slice(2, 14)}`;
  const args = [state.incidentId, evidenceId, "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, state.outflowDigest, state.outflowTx, 0n, state.outflowInput];
  const result = await writeOnce(state, { key: "chainEvidenceTx", label: "INCIDENT_CHAIN_EVIDENCE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "bind_evidence", args, before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "ASSESSING") throw new Error("incident is not ASSESSING"); } });
  const evidence = await readContract(result.client, SENTINEL, "get_evidence", [evidenceId]);
  if (evidence.evidence_type !== "CHAIN_TRANSACTION" || evidence.transaction_hash !== lower(state.outflowTx) || evidence.source_url !== RPC || String(evidence.observed_at) === "0" || String(evidence.event_timestamp) !== String(state.outflowEventTimestamp)) throw new Error(`chain evidence readback failed: ${JSON.stringify(safe(evidence))}`);
  state.chainEvidenceId = evidenceId; state.chainEvidence = evidence; state.chainEvidenceStatus = result.terminal; state.chainEvidenceBound = true; await saveState(state); await log([`CHAIN_EVIDENCE_ID: ${evidenceId}`, `CHAIN_EVIDENCE: ${JSON.stringify(safe(evidence))}`]);
}

async function bindAdvisory(kind, file, url, digest, bytes, txHash, evidenceId, phase) {
  const state = await loadState();
  const key = kind === "incident" ? "incidentAdvisoryEvidenceTx" : "recoveryAdvisoryEvidenceTx";
  if (state[key]) throw new Error(`${kind} advisory evidence already recorded; refusing repeat`);
  if (!url.startsWith(ADVISORY_PREFIX)) throw new Error("advisory URL outside locked prefix");
  const body = await readFile(file);
  if (createHash("sha256").update(body).digest("hex") !== digest || body.length !== Number(bytes)) throw new Error("advisory digest/bytes mismatch");
  const { client } = await makeClient("beacon-final-deployer");
  const args = [state.incidentId, evidenceId, phase, "SECURITY_ADVISORY", url, FAILURE, digest, txHash, 1n, ""];
  const result = await writeOnce(state, { key, label: kind === "incident" ? "INCIDENT_ADVISORY_EVIDENCE" : "RECOVERY_ADVISORY_EVIDENCE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "bind_evidence", args, before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); const expectedState = phase === "EMERGENCY" ? "ASSESSING" : "RECOVERY_ASSESSING"; if (incident.state !== expectedState) throw new Error(`incident state ${incident.state} does not permit ${phase} advisory`); } });
  const evidence = await readContract(result.client, SENTINEL, "get_evidence", [evidenceId]);
  if (evidence.evidence_type !== "SECURITY_ADVISORY" || evidence.transaction_hash !== lower(txHash) || evidence.content_digest !== digest || String(evidence.observed_at) === "0") throw new Error(`advisory evidence readback failed: ${JSON.stringify(safe(evidence))}`);
  state[`${kind}AdvisoryEvidenceId`] = evidenceId; state[`${kind}AdvisoryEvidence`] = evidence; state[`${kind}AdvisoryBound`] = true; await saveState(state); await log([`${kind.toUpperCase()}_ADVISORY_EVIDENCE: ${JSON.stringify(safe(evidence))}`]);
}

async function assessIncident() {
  const state = await loadState();
  if (state.incidentAssessmentTx) throw new Error("incident assessment already recorded; refusing repeat");
  if (!state.chainEvidenceBound || !state.incidentAdvisoryBound) throw new Error("incident evidence quorum missing");
  const { client } = await makeClient("beacon-final-deployer");
  const result = await writeOnce(state, { key: "incidentAssessmentTx", label: "INCIDENT_ASSESSMENT", alias: "beacon-final-deployer", address: SENTINEL, functionName: "assess_incident", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "ASSESSING") throw new Error("incident not assessing"); } });
  const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]);
  if (incident.state !== "ACTIVE_INCIDENT" || incident.incident_verdict !== "ACTIVE_INCIDENT") throw new Error(`incident verdict was not ACTIVE_INCIDENT: ${JSON.stringify(safe(incident))}`);
  state.incidentAfterAssessment = incident; state.incidentVerdict = incident.incident_verdict; state.incidentAssessmentStatus = result.terminal; await saveState(state); await log([`INCIDENT_ASSESSMENT_RESULT: ${JSON.stringify(safe(incident))}`]);
}

async function simulateAssessment() {
  const state = await loadState();
  const { account, client } = await makeClient("beacon-final-deployer");
  const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]);
  if (incident.state !== "ASSESSING" || incident.evidence_ids_csv !== `${state.chainEvidenceId},${state.incidentAdvisoryEvidenceId}`) throw new Error(`incident evidence precondition failed: ${JSON.stringify(safe(incident))}`);
  const fees = await estimate(client, account, SENTINEL, "assess_incident", [state.incidentId]);
  try {
    const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "assess_incident", args: [state.incidentId], fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
    const result = { status: "ACCEPTED", receipt: terminal(simulation.receipt ?? {}), fees: safe(fees) }; console.log(JSON.stringify(result, null, 2)); return;
  } catch (error) {
    console.log(JSON.stringify({ status: "REJECTED", message: String(error?.message ?? error).slice(0, 1200), details: error?.cause?.data?.receipt ? { execution_result: error.cause.data.receipt.execution_result, result: error.cause.data.receipt.result } : null }, null, 2));
    throw error;
  }
}

async function simulateAssessmentGeneric() {
  const state = await loadState();
  const { account, client } = await makeClient("beacon-final-deployer");
  const fees = await estimate(client, account, null, null, []);
  const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "assess_incident", args: [state.incidentId], fees, includeReceipt: true, transactionHashVariant: "latest-final" });
  console.log(JSON.stringify({ status: "ACCEPTED", receipt: terminal(simulation.receipt ?? {}), fees: safe(fees) }, null, 2));
}

async function pause() {
  const state = await loadState();
  if (state.pauseTx) throw new Error("pause already recorded; refusing repeat");
  const { client } = await makeClient("beacon-final-deployer");
  const result = await writeOnce(state, { key: "pauseTx", label: "PAUSE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "execute_pause", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "ACTIVE_INCIDENT" || incident.incident_verdict !== "ACTIVE_INCIDENT") throw new Error("pause not authorized"); if (await readContract(client, DEMO, "is_paused")) throw new Error("target already paused"); } });
  const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); const paused = await readContract(result.client, DEMO, "is_paused");
  if (incident.state !== "ACTIVE_INCIDENT" || incident.pause_requested !== true || paused !== true) throw new Error(`pause readback failed: ${JSON.stringify(safe({ incident, paused }))}`);
  state.pauseStatus = result.terminal; state.targetPausedAfterPauseRequest = paused; state.incidentAfterPauseRequest = incident; await saveState(state); await log([`PAUSE_READBACK: ${JSON.stringify(safe({ incident, paused }))}`]);
}

async function confirmPause() {
  const state = await loadState();
  if (state.confirmPauseTx) throw new Error("pause confirmation already recorded; refusing repeat");
  const { client } = await makeClient("beacon-final-deployer");
  const result = await writeOnce(state, { key: "confirmPauseTx", label: "CONFIRM_PAUSE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "confirm_pause", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "ACTIVE_INCIDENT" || incident.pause_requested !== true || await readContract(client, DEMO, "is_paused") !== true) throw new Error("pause confirmation precondition failed"); } });
  const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); const paused = await readContract(result.client, DEMO, "is_paused"); const counters = await readContract(result.client, DEMO, "get_pause_counters");
  if (incident.state !== "PAUSED" || paused !== true || String(counters.pause_count) !== "1") throw new Error(`pause confirmation readback failed: ${JSON.stringify(safe({ incident, paused, counters }))}`);
  state.confirmPauseStatus = result.terminal; state.pauseConfirmedAt = String(incident.pause_confirmed_at); state.incidentAfterPause = incident; state.targetAfterPause = { paused, counters }; await saveState(state); await log([`RECOVERY_COOLDOWN_ANCHOR: pause_confirmed_at`, `RECOVERY_COOLDOWN_STARTED_AT: ${incident.pause_confirmed_at}`, `PAUSE_CONFIRMATION_READBACK: ${JSON.stringify(safe({ incident, paused, counters }))}`]);
}

async function containment() {
  const state = await loadState(); const { account: owner, client: ownerClient } = await makeClient("beacon-final-deployer"); const { account: actor, client: actorClient } = await makeClient("player2");
  const target = await demoState(ownerClient); if (target.paused !== true || target.remediated !== false || String(target.treasury.treasury_balance) !== "900" || String(target.treasury.total_outflow) !== "100") throw new Error(`containment state precondition failed: ${JSON.stringify(safe(target))}`);
  const outflowFees = await estimate(actorClient, actor, DEMO, "execute_outflow", [PLAYER2, 1n]); const processFees = await estimate(ownerClient, owner, DEMO, "process", [1n]); let outflowRejected = false; let processRejected = false;
  try { await actorClient.simulateWriteContract({ account: actor, address: DEMO, functionName: "execute_outflow", args: [PLAYER2, 1n], fees: outflowFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch { outflowRejected = true; }
  try { await ownerClient.simulateWriteContract({ account: owner, address: DEMO, functionName: "process", args: [1n], fees: processFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch { processRejected = true; }
  if (!outflowRejected || !processRejected) throw new Error(`containment simulations did not both reject: ${outflowRejected} ${processRejected}`);
  state.containment = { pausedOutflow: "REJECTED", pausedProcess: "REJECTED", target: target }; await saveState(state); await log([`CONTAINMENT: ${JSON.stringify(safe(state.containment))}`]); console.log(JSON.stringify({ stage: "CONTAINMENT", result: safe(state.containment) }, null, 2));
}

async function remediate() {
  const state = await loadState();
  if (state.remediationTx) throw new Error("remediation already recorded; refusing repeat");
  const { client } = await makeClient("beacon-final-deployer");
  const result = await writeOnce(state, { key: "remediationTx", label: "REMEDIATION", alias: "beacon-final-deployer", address: DEMO, functionName: "apply_remediation", args: [], before: async () => { const target = await demoState(client); if (target.paused !== true || target.remediated !== false) throw new Error(`remediation precondition failed: ${JSON.stringify(safe(target))}`); } });
  const target = await demoState(result.client); if (target.remediated !== true || target.paused !== true || String(target.treasury.treasury_balance) !== "900" || String(target.treasury.total_outflow) !== "100") throw new Error(`remediation readback failed: ${JSON.stringify(safe(target))}`);
  state.remediationStatus = result.terminal; state.targetAfterRemediation = target; await saveState(state); await log([`REMEDIATION_READBACK: ${JSON.stringify(safe(target))}`]);
}

async function beginRecovery() {
  const state = await loadState(); const { client } = await makeClient("beacon-final-deployer"); const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "PAUSED") throw new Error(`begin recovery requires PAUSED: ${JSON.stringify(safe(incident))}`);
  const anchor = BigInt(incident.pause_confirmed_at); const now = BigInt(Math.floor(Date.now() / 1000)); const elapsed = now - anchor; if (elapsed < 900n) { console.log(JSON.stringify({ stage: "COOLDOWN_WAIT", anchor: anchor.toString(), seconds: 900, elapsed: elapsed.toString(), remaining: (900n - elapsed).toString() })); return false; }
  if (state.beginRecoveryTx) throw new Error("begin recovery already recorded; refusing repeat");
  const result = await writeOnce(state, { key: "beginRecoveryTx", label: "BEGIN_RECOVERY", alias: "beacon-final-deployer", address: SENTINEL, functionName: "begin_recovery", args: [state.incidentId], before: async () => { const current = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (current.state !== "PAUSED") throw new Error("recovery state changed"); } });
  const after = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); if (after.state !== "RECOVERY_ASSESSING") throw new Error(`recovery did not enter RECOVERY_ASSESSING: ${JSON.stringify(safe(after))}`); state.recoveryStartedAt = String(after.pause_confirmed_at); state.beginRecoveryStatus = result.terminal; state.incidentAfterBeginRecovery = after; await saveState(state); await log([`RECOVERY_BEGIN_READBACK: ${JSON.stringify(safe(after))}`]); return true;
}

async function assessRecovery() {
  const state = await loadState(); if (state.recoveryAssessmentTx) throw new Error("recovery assessment already recorded; refusing repeat"); if (!state.recoveryChainEvidenceBound || !state.recoveryAdvisoryBound) throw new Error("recovery evidence quorum missing");
  const { client } = await makeClient("beacon-final-deployer"); const result = await writeOnce(state, { key: "recoveryAssessmentTx", label: "RECOVERY_ASSESSMENT", alias: "beacon-final-deployer", address: SENTINEL, functionName: "assess_recovery", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "RECOVERY_ASSESSING") throw new Error("recovery is not assessing"); if (await readContract(client, DEMO, "is_paused") !== true || await readContract(client, DEMO, "is_remediated") !== true) throw new Error("recovery target precondition failed"); } });
  const after = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); if (after.state !== "RECOVERY_AUTHORIZED" || after.recovery_verdict !== "SAFE_TO_RECOVER") throw new Error(`recovery verdict was not SAFE_TO_RECOVER: ${JSON.stringify(safe(after))}`); state.recoveryAssessmentStatus = result.terminal; state.recoveryVerdict = after.recovery_verdict; state.incidentAfterRecoveryAssessment = after; await saveState(state); await log([`RECOVERY_ASSESSMENT_RESULT: ${JSON.stringify(safe(after))}`]);
}

async function unpause() {
  const state = await loadState(); if (state.unpauseTx) throw new Error("unpause already recorded; refusing repeat"); const { client } = await makeClient("beacon-final-deployer"); const result = await writeOnce(state, { key: "unpauseTx", label: "UNPAUSE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "execute_unpause", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "RECOVERY_AUTHORIZED" || incident.recovery_verdict !== "SAFE_TO_RECOVER") throw new Error("unpause not authorized"); } }); const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); const paused = await readContract(result.client, DEMO, "is_paused"); if (incident.state !== "RECOVERY_AUTHORIZED" || incident.unpause_requested !== true || paused !== false) throw new Error(`unpause request readback failed: ${JSON.stringify(safe({ incident, paused }))}`); state.unpauseStatus = result.terminal; state.incidentAfterUnpauseRequest = incident; await saveState(state); await log([`UNPAUSE_REQUEST_READBACK: ${JSON.stringify(safe({ incident, paused }))}`]);
}

async function confirmRecovered() {
  const state = await loadState(); if (state.confirmRecoveredTx) throw new Error("recovery confirmation already recorded; refusing repeat"); const { client } = await makeClient("beacon-final-deployer"); const result = await writeOnce(state, { key: "confirmRecoveredTx", label: "CONFIRM_RECOVERED", alias: "beacon-final-deployer", address: SENTINEL, functionName: "confirm_recovered", args: [state.incidentId], before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "RECOVERY_AUTHORIZED" || incident.unpause_requested !== true || await readContract(client, DEMO, "is_paused") !== false) throw new Error("recovery confirmation precondition failed"); } }); const incident = await readContract(result.client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "RECOVERED") throw new Error(`incident not RECOVERED: ${JSON.stringify(safe(incident))}`); state.confirmRecoveredStatus = result.terminal; state.finalIncident = incident; await saveState(state); await log([`FINAL_INCIDENT_STATE: ${JSON.stringify(safe(incident))}`]);
}

async function postRecovery() {
  const state = await loadState(); const { client } = await makeClient("beacon-final-deployer"); const before = await demoState(client); if (before.paused !== false || before.remediated !== true) throw new Error(`post-recovery precondition failed: ${JSON.stringify(safe(before))}`);
  if (!state.postRecoveryProcessTx) { const result = await writeOnce(state, { key: "postRecoveryProcessTx", label: "POST_RECOVERY_PROCESS", alias: "beacon-final-deployer", address: DEMO, functionName: "process", args: [1n], before: async () => { const target = await demoState(client); if (target.paused !== false || target.remediated !== true) throw new Error("post-recovery process precondition failed"); } }); const after = await demoState(result.client); if (String(after.totalProcessed) !== String(BigInt(before.totalProcessed) + 1n)) throw new Error(`post-recovery process readback failed: ${JSON.stringify(safe(after))}`); state.postRecoveryProcessStatus = result.terminal; state.totalProcessedFinal = String(after.totalProcessed); state.postRecoveryState = after; await saveState(state); await log([`POST_RECOVERY_PROCESS_STATE: ${JSON.stringify(safe(after))}`]); }
  const { account: actor, client: actorClient } = await makeClient("player2"); const fees = await estimate(actorClient, actor, DEMO, "execute_outflow", [PLAYER2, 1n]); let rejected = false; try { await actorClient.simulateWriteContract({ account: actor, address: DEMO, functionName: "execute_outflow", args: [PLAYER2, 1n], fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch { rejected = true; } if (!rejected) throw new Error("post-recovery non-owner outflow simulation unexpectedly succeeded"); const finalTarget = await demoState(client); if (finalTarget.paused !== false || finalTarget.remediated !== true || String(finalTarget.treasury.treasury_balance) !== "900" || String(finalTarget.treasury.total_outflow) !== "100") throw new Error(`final target state mismatch: ${JSON.stringify(safe(finalTarget))}`); state.permanentRemediationSimulation = "REJECTED"; state.finalTarget = finalTarget; await saveState(state); await log([`POST_RECOVERY_NONOWNER_OUTFLOW_SIMULATION: REJECTED`, `FINAL_TARGET_STATE: ${JSON.stringify(safe(finalTarget))}`]); console.log(JSON.stringify({ stage: "FINAL", state: safe(state) }, null, 2));
}

async function bindRecoveryChain() {
  const state = await loadState(); if (state.recoveryChainEvidenceTx) throw new Error("recovery chain evidence already recorded; refusing repeat"); if (!state.beginRecoveryTx || !state.remediationTx) throw new Error("recovery chain prerequisites missing"); const { client } = await makeClient("beacon-final-deployer"); const rpc = canonicalFacts(await rawTransaction(client, state.remediationTx), state.remediationTx, OWNER, DEMO, undefined); state.remediationInput = rpc.facts.input; const evidenceId = `recovery-chain-${state.remediationTx.slice(2, 14)}`; const args = [state.incidentId, evidenceId, "RECOVERY", "CHAIN_TRANSACTION", RPC, FAILURE, rpc.digest, state.remediationTx, 0n, state.remediationInput]; const result = await writeOnce(state, { key: "recoveryChainEvidenceTx", label: "RECOVERY_CHAIN_EVIDENCE", alias: "beacon-final-deployer", address: SENTINEL, functionName: "bind_evidence", args, before: async () => { const incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); if (incident.state !== "RECOVERY_ASSESSING") throw new Error("recovery chain bind requires RECOVERY_ASSESSING"); } }); const evidence = await readContract(result.client, SENTINEL, "get_evidence", [evidenceId]); if (evidence.phase !== "RECOVERY" || evidence.transaction_hash !== lower(state.remediationTx) || String(evidence.observed_at) === "0") throw new Error(`recovery chain readback failed: ${JSON.stringify(safe(evidence))}`); state.recoveryChainEvidenceId = evidenceId; state.recoveryChainEvidenceBound = true; state.recoveryChainEvidence = evidence; state.recoveryChainDigest = rpc.digest; state.recoveryChainEventTimestamp = rpc.facts.event_timestamp; state.recoveryChainStatus = result.terminal; await saveState(state); await log([`RECOVERY_CHAIN_EVIDENCE: ${JSON.stringify(safe(evidence))}`]);
}

async function setRemediationInput() {
  const state = await loadState(); if (!state.remediationTx) throw new Error("remediation transaction missing"); const { client } = await makeClient("beacon-final-deployer"); const tx = await rawTransaction(client, state.remediationTx); const data = tx.input ?? tx.txCallData ?? tx.data?.calldata ?? tx.data?.input; if (!data) throw new Error("remediation calldata missing from RPC"); state.remediationInput = data; state.remediationRpc = canonicalFacts(tx, state.remediationTx, OWNER, DEMO, data); await saveState(state); console.log(JSON.stringify({ remediationInput: data, facts: safe(state.remediationRpc.facts), digest: state.remediationRpc.digest }, null, 2));
}

async function readState() { const state = await loadState(); const { client } = await makeClient("beacon-final-deployer"); const result = { state, policy: await policy(client), target: await demoState(client) }; if (state.incidentId) { try { result.incident = await readContract(client, SENTINEL, "get_incident", [state.incidentId]); } catch { result.incident = "NOT_CREATED"; } } console.log(JSON.stringify(safe(result), null, 2)); }

const op = process.argv[2];
if (op === "preflight") await preflight();
else if (op === "baseline") await baseline();
else if (op === "reconcile-baseline") await reconcileBaseline();
else if (op === "outflow") await outflow();
else if (op === "reconcile-outflow") await reconcileOutflow();
else if (op === "open") await openIncident();
else if (op === "chain") await bindChain();
else if (op === "advisory-bind") await bindAdvisory(process.argv[3], process.argv[4], process.argv[5], process.argv[6], process.argv[7], process.argv[8], process.argv[9], process.argv[10]);
else if (op === "assess-incident") await assessIncident();
else if (op === "simulate-assess") await simulateAssessment();
else if (op === "simulate-assess-generic") await simulateAssessmentGeneric();
else if (op === "pause") await pause();
else if (op === "confirm-pause") await confirmPause();
else if (op === "containment") await containment();
else if (op === "remediate") await remediate();
else if (op === "set-remediation-input") await setRemediationInput();
else if (op === "begin-recovery") await beginRecovery();
else if (op === "recovery-chain") await bindRecoveryChain();
else if (op === "assess-recovery") await assessRecovery();
else if (op === "unpause") await unpause();
else if (op === "confirm-recovered") await confirmRecovered();
else if (op === "post-recovery") await postRecovery();
else if (op === "read-state") await readState();
else throw new Error("usage: preflight|baseline|outflow|open|chain|advisory-bind|assess-incident|pause|confirm-pause|containment|remediate|set-remediation-input|begin-recovery|recovery-chain|assess-recovery|unpause|confirm-recovered|post-recovery|read-state");
