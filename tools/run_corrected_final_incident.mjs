import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ACTOR = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const SENTINEL = "0x5a2a5288C7213d60EC9C92ffa504Ef8FA64fc723";
const DEMO = "0xFCeC042B2fcc1d793Bf92877665c9Bae16971AE1";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const ADVISORY_PREFIX = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const PROFILE_PATH = `${ROOT}/deploy/fee-profile.json`;
const STATE_PATH = `${ROOT}/deploy/evidence/final-v2/FINAL_INCIDENT_PROOF_STATE.json`;
const PROOF_PATH = `${ROOT}/deploy/evidence/final-v2/FINAL_INCIDENT_PROOF.txt`;
const SENTINEL_SHA = "7C1AAA1E2BAF4E30FDE3F9CB329F17FCBB5860AFE3A3F66BA4A6D6D58A2F53EE";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const ZERO = "0x0000000000000000000000000000000000000000";

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    return p + q + new URL(`file://${req.resolve(spec)}`).href + close;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) { return String(value).toLowerCase(); }

function first(value, names) {
  for (const name of names) if (value && value[name] !== undefined && value[name] !== null) return value[name];
  return null;
}

function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]),
  };
}

function requireSuccess(receipt, label) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) || String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") {
    throw new Error(`${label} terminal-success gate failed: ${JSON.stringify(result)}`);
  }
  return result;
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

function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(`${method} calldata roundtrip failed`);
  }
  return { method, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: decoded.map((value) => typeof value === "bigint" ? value.toString() : value) };
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_PATH, "utf8")); } catch { return {}; }
}

async function saveState(patch) {
  await mkdir(`${ROOT}/deploy/evidence/final-v2`, { recursive: true });
  const next = { ...(await loadState()), ...safe(patch) };
  await writeFile(STATE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

async function appendLog(lines) {
  await mkdir(`${ROOT}/deploy/evidence/final-v2`, { recursive: true });
  await appendFile(PROOF_PATH, lines.join("\n") + "\n", "utf8");
}

async function makeClient(accountName) {
  const { createClient2, studioDevnet, BaseAction } = await loadSdk();
  const action = new BaseAction();
  action.accountOverride = accountName;
  const account = await action.getAccount(false);
  const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
  await client.initializeConsensusSmartContract();
  return { account, client };
}

async function preflight(client, account, expected) {
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
  if (result.chainId !== CHAIN_ID || lower(result.account) !== lower(expected) || result.latestNonce !== result.pendingNonce) throw new Error(`preflight failed: ${JSON.stringify(result)}`);
  return result;
}

async function read(client, address, method, args = []) {
  return client.readContract({ address, functionName: method, args, jsonSafeReturn: true });
}

async function protectedState(client) {
  return {
    paused: await read(client, DEMO, "is_paused"),
    remediated: await read(client, DEMO, "is_remediated"),
    treasury: await read(client, DEMO, "get_treasury_state"),
    lastOutflow: await read(client, DEMO, "get_last_outflow"),
    totalProcessed: await read(client, DEMO, "get_total_processed"),
    counters: await read(client, DEMO, "get_pause_counters"),
  };
}

function assertHealthy(state, expectedTreasury = "1000", expectedOutflow = "0") {
  if (state.paused !== false || state.remediated !== false || String(state.treasury.treasury_balance) !== expectedTreasury || String(state.treasury.total_outflow) !== expectedOutflow) throw new Error(`ProtectedDemo state mismatch: ${JSON.stringify(state)}`);
}

async function checkPolicy(client) {
  const p = await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]);
  const expected = {
    target_address: DEMO.toLowerCase(),
    critical_failure_class: FAILURE,
    allowed_source_domains: "studio-dev.genlayer.com,raw.githubusercontent.com",
    allowed_source_prefixes: "studio-dev.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/",
    canonical_rpc_endpoint: RPC,
    minimum_sources: "2",
    max_evidence_age_seconds: "3600",
    recovery_cooldown_seconds: "900",
    policy_locked: true,
  };
  const actual = {
    target_address: lower(p.target_address),
    critical_failure_class: p.critical_failure_class,
    allowed_source_domains: p.allowed_source_domains,
    allowed_source_prefixes: p.allowed_source_prefixes,
    canonical_rpc_endpoint: p.canonical_rpc_endpoint,
    minimum_sources: String(p.minimum_sources),
    max_evidence_age_seconds: String(p.max_evidence_age_seconds),
    recovery_cooldown_seconds: String(p.recovery_cooldown_seconds),
    policy_locked: p.policy_locked,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`policy mismatch: ${JSON.stringify(actual)}`);
  return actual;
}

async function sourceHashes() {
  const sentinel = createHash("sha256").update(await readFile(`${ROOT}/contracts/sentinel.py`)).digest("hex").toUpperCase();
  const demo = createHash("sha256").update(await readFile(`${ROOT}/contracts/protected_demo.py`)).digest("hex").toUpperCase();
  if (sentinel !== SENTINEL_SHA || demo !== DEMO_SHA) throw new Error("frozen source hash gate failed");
  return { sentinel, demo };
}

async function performWrite({ label, accountName, expectedAccount, address, functionName, args }) {
  const { account, client } = await makeClient(accountName);
  const preflightResult = await preflight(client, account, expectedAccount);
  const calldata = calldataRoundtrip(functionName, args);
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  const feeOptions = feesFromProfile(profile.deploy);
  const fees = await client.estimateTransactionFeesForWrite({ account, address, functionName, args, ...feeOptions });
  if (BigInt(fees.feeValue) <= 0n || BigInt(preflightResult.balanceWei) < BigInt(fees.feeValue)) throw new Error(`${label} fee/balance gate failed`);
  await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  await saveState({ [`${label}_PREFLIGHT`]: preflightResult, [`${label}_CALLDATA`]: calldata, [`${label}_FEE_VALUE`]: String(fees.feeValue), [`${label}_SIMULATION`]: "PASS" });
  const tx = await client.writeContract({ account, address, functionName, args, fees });
  await saveState({ [`${label}_TX`]: tx, [`${label}_BROADCAST_COUNT`]: 1 });
  const receipt = await client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const result = requireSuccess(receipt, label);
  await saveState({ [`${label}_STATUS`]: result.status, [`${label}_CONSENSUS`]: result.consensus, [`${label}_EXECUTION`]: result.execution });
  return { account, client, tx, calldata, fees: safe(fees), terminal: result };
}

function canonicalFacts(result) {
  const returnedHash = first(result, ["hash", "id", "tx_id"]);
  const sender = first(result, ["sender", "from_address", "from"]);
  const origin = first(result, ["origin_address", "txOrigin"]) || sender;
  const target = first(result, ["recipient", "to_address", "to"]);
  const data = result.data;
  const input = first(result, ["input", "txCallData"]) || (data && first(data, ["calldata", "input"]));
  const status = first(result, ["status", "statusName", "status_name"]);
  const execution = first(result, ["txExecutionResultName", "execution_result_name"]);
  const consensus = first(result, ["result_name", "consensusResultName", "consensus_status"]);
  const timestampValue = result.created_timestamp ?? result.timestamp ?? result.created_at;
  if ([returnedHash, sender, origin, target, input, status, execution, consensus, timestampValue].some((value) => value === null || value === undefined)) throw new Error("canonical transaction response missing required facts");
  const timestamp = BigInt(String(timestampValue));
  const facts = {
    consensus: String(consensus).toUpperCase(),
    event_timestamp: Number(timestamp),
    execution: String(execution).toUpperCase(),
    hash: String(returnedHash).toLowerCase(),
    input: String(input),
    origin: String(origin).toLowerCase(),
    sender: String(sender).toLowerCase(),
    status: String(status).toUpperCase(),
    target: String(target).toLowerCase(),
  };
  const digest = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  return { facts, digest, input: String(input), timestamp: timestamp.toString(), rawKeys: Object.keys(result) };
}

async function canonicalTransaction(client, tx) {
  const envelope = await client.request({ method: "eth_getTransactionByHash", params: [tx] });
  if (envelope?.error) throw new Error(`canonical lookup failed: ${JSON.stringify(envelope)}`);
  const payload = envelope?.result && typeof envelope.result === "object" ? envelope.result : envelope;
  if (!payload || typeof payload !== "object") throw new Error(`canonical lookup returned no transaction object: ${JSON.stringify(envelope)}`);
  const normalized = canonicalFacts(payload);
  if (normalized.facts.hash !== tx.toLowerCase() || normalized.facts.target !== DEMO.toLowerCase() || normalized.facts.sender !== ACTOR.toLowerCase() || normalized.facts.status !== "FINALIZED" || normalized.facts.execution !== "FINISHED_WITH_RETURN" || !["MAJORITY_AGREE", "ACCEPTED"].includes(normalized.facts.consensus)) throw new Error(`canonical outflow facts failed: ${JSON.stringify(normalized.facts)}`);
  return normalized;
}

async function runReconcileOutflow() {
  const state = await loadState();
  if (!state.FINAL_OUTFLOW_TX || state.FINAL_INCIDENT_CREATE_TX) throw new Error("outflow missing or incident already attempted");
  const { client } = await makeClient("player2");
  const after = await protectedState(client);
  if (after.paused !== false || after.remediated !== false || String(after.treasury.treasury_balance) !== "900" || String(after.treasury.total_outflow) !== "100" || lower(after.lastOutflow.actor) !== ACTOR.toLowerCase() || String(after.lastOutflow.amount) !== "100") throw new Error(`outflow readback failed: ${JSON.stringify(after)}`);
  const rpcFacts = await canonicalTransaction(client, state.FINAL_OUTFLOW_TX);
  await saveState({ outflowAmount: "100", treasuryBeforeOutflow: state.initialProtectedState?.treasury ?? null, treasuryAfterOutflow: after.treasury, lastOutflow: after.lastOutflow, CANONICAL_RPC_FACTS: rpcFacts.facts, CANONICAL_RPC_DIGEST: rpcFacts.digest, CANONICAL_RPC_INPUT: rpcFacts.input, EXTERNAL_EVENT_TIMESTAMP: rpcFacts.timestamp, rpcAuthentication: "PASS", outflowReconciled: true });
  console.log(JSON.stringify({ stage: "RECONCILE_OUTFLOW", tx: state.FINAL_OUTFLOW_TX, after: safe(after), rpcFacts: safe(rpcFacts) }));
}

async function runPreflight() {
  const hashes = await sourceHashes();
  const owner = await makeClient("beacon-final-deployer");
  const actor = await makeClient("player2");
  const ownerPreflight = await preflight(owner.client, owner.account, OWNER);
  const actorPreflight = await preflight(actor.client, actor.account, ACTOR);
  const policy = await checkPolicy(owner.client);
  const state = await protectedState(owner.client);
  assertHealthy(state);
  if (String(state.totalProcessed) !== "0" || String(state.counters.pause_count) !== "0" || String(state.counters.unpause_count) !== "0") throw new Error("initial ProtectedDemo counters are not zero");
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  const outflowFees = await actor.client.estimateTransactionFeesForWrite({ account: actor.account, address: DEMO, functionName: "execute_outflow", args: [ACTOR, 100n], ...feesFromProfile(profile.deploy) });
  if (BigInt(actorPreflight.balanceWei) < BigInt(outflowFees.feeValue)) throw new Error("player2 cannot afford the controlled outflow");
  const result = await saveState({ hashes, ownerPreflight, actorPreflight, policy, initialProtectedState: state, player2BalanceBefore: actorPreflight.balanceWei, player2OutflowFeeEstimate: String(outflowFees.feeValue), preflight: "PASS" });
  console.log(JSON.stringify({ stage: "PREFLIGHT", state: result }));
}

async function runBaseline() {
  const state = await loadState();
  if (state.BASELINE_TX) throw new Error("baseline already attempted");
  const { client } = await makeClient("beacon-final-deployer");
  const before = await protectedState(client);
  assertHealthy(before);
  const result = await performWrite({ label: "BASELINE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: DEMO, functionName: "process", args: [1n] });
  const after = await protectedState(result.client);
  if (String(after.totalProcessed) !== "1" || after.paused !== false || String(after.treasury.treasury_balance) !== "1000") throw new Error(`baseline readback failed: ${JSON.stringify(after)}`);
  await saveState({ healthyBaselineTx: result.tx, totalProcessedAfterBaseline: String(after.totalProcessed), baselineProtectedState: after });
  console.log(JSON.stringify({ stage: "BASELINE", tx: result.tx, terminal: result.terminal, after: safe(after) }));
}

async function runOutflow() {
  const state = await loadState();
  if (!state.BASELINE_TX || state.FINAL_OUTFLOW_TX) throw new Error("baseline missing or outflow already attempted");
  const { client } = await makeClient("player2");
  const before = await protectedState(client);
  assertHealthy(before);
  if (String(before.treasury.treasury_balance) !== "1000" || String(before.treasury.total_outflow) !== "0") throw new Error("outflow precondition treasury mismatch");
  const result = await performWrite({ label: "FINAL_OUTFLOW", accountName: "player2", expectedAccount: ACTOR, address: DEMO, functionName: "execute_outflow", args: [ACTOR, 100n] });
  const after = await protectedState(result.client);
  if (after.paused !== false || after.remediated !== false || String(after.treasury.treasury_balance) !== "900" || String(after.treasury.total_outflow) !== "100" || lower(after.lastOutflow.actor) !== ACTOR.toLowerCase() || String(after.lastOutflow.amount) !== "100") throw new Error(`outflow readback failed: ${JSON.stringify(after)}`);
  const rpcFacts = await canonicalTransaction(result.client, result.tx);
  await saveState({ FINAL_OUTFLOW_TX: result.tx, outflowAmount: "100", treasuryBeforeOutflow: before.treasury, treasuryAfterOutflow: after.treasury, lastOutflow: after.lastOutflow, CANONICAL_RPC_FACTS: rpcFacts.facts, CANONICAL_RPC_DIGEST: rpcFacts.digest, CANONICAL_RPC_INPUT: rpcFacts.input, EXTERNAL_EVENT_TIMESTAMP: rpcFacts.timestamp, rpcAuthentication: "PASS" });
  console.log(JSON.stringify({ stage: "OUTFLOW", tx: result.tx, terminal: result.terminal, after: safe(after), rpcFacts: safe(rpcFacts) }));
}

async function runOpen() {
  const state = await loadState();
  if (!state.FINAL_OUTFLOW_TX || state.FINAL_INCIDENT_CREATE_TX) throw new Error("outflow missing or incident already attempted");
  const incidentId = `incident-${state.FINAL_OUTFLOW_TX.slice(2, 14)}`;
  const result = await performWrite({ label: "FINAL_INCIDENT_CREATE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "open_incident", args: [incidentId, PROTOCOL_ID] });
  const incident = await read(result.client, SENTINEL, "get_incident", [incidentId]);
  if (incident.state !== "ASSESSING") throw new Error(`incident state after create: ${JSON.stringify(incident)}`);
  await saveState({ FINAL_INCIDENT_ID: incidentId, incidentStateAfterCreate: incident.state, incidentAfterCreate: incident });
  console.log(JSON.stringify({ stage: "OPEN_INCIDENT", tx: result.tx, incidentId, incident }));
}

async function runReconcileOpen() {
  const state = await loadState();
  if (!state.FINAL_INCIDENT_CREATE_TX || state.FINAL_INCIDENT_ID) throw new Error("incident create is missing or already reconciled");
  const { client } = await makeClient("beacon-final-deployer");
  const envelope = await client.request({ method: "eth_getTransactionByHash", params: [state.FINAL_INCIDENT_CREATE_TX] });
  if (envelope?.error) throw new Error(`incident-create lookup failed: ${JSON.stringify(envelope)}`);
  const tx = envelope?.result && typeof envelope.result === "object" ? envelope.result : envelope;
  const status = String(first(tx, ["status", "statusName", "status_name"])).toUpperCase();
  const consensus = String(first(tx, ["result_name", "consensusResultName", "consensus_status"])).toUpperCase();
  const execution = String(first(tx, ["txExecutionResultName", "execution_result_name"])).toUpperCase();
  if (status !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(consensus) || execution !== "FINISHED_WITH_RETURN") throw new Error(`incident-create reconciliation failed: ${JSON.stringify({ status, consensus, execution })}`);
  const incidentId = `incident-${state.FINAL_OUTFLOW_TX.slice(2, 14)}`;
  const incident = await read(client, SENTINEL, "get_incident", [incidentId]);
  if (incident.state !== "ASSESSING") throw new Error(`incident state after reconciliation: ${JSON.stringify(incident)}`);
  await saveState({ FINAL_INCIDENT_ID: incidentId, incidentStateAfterCreate: incident.state, incidentAfterCreate: incident, FINAL_INCIDENT_CREATE_STATUS: status, FINAL_INCIDENT_CREATE_CONSENSUS: consensus, FINAL_INCIDENT_CREATE_EXECUTION: execution });
  console.log(JSON.stringify({ stage: "RECONCILE_OPEN_INCIDENT", tx: state.FINAL_INCIDENT_CREATE_TX, terminal: { status, consensus, execution }, incidentId, incident }));
}

async function runChainBind() {
  const state = await loadState();
  if (!state.FINAL_INCIDENT_CREATE_TX || state.FINAL_CHAIN_EVIDENCE_TX) throw new Error("incident missing or chain evidence already attempted");
  const evidenceId = `chain-${state.FINAL_OUTFLOW_TX.slice(2, 14)}`;
  const args = [state.FINAL_INCIDENT_ID, evidenceId, "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, state.CANONICAL_RPC_DIGEST, state.FINAL_OUTFLOW_TX, 0n, state.CANONICAL_RPC_INPUT];
  const result = await performWrite({ label: "FINAL_CHAIN_EVIDENCE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "bind_evidence", args });
  const evidence = await read(result.client, SENTINEL, "get_evidence", [evidenceId]);
  if (evidence.evidence_type !== "CHAIN_TRANSACTION" || evidence.transaction_hash !== state.FINAL_OUTFLOW_TX.toLowerCase() || String(evidence.event_timestamp) !== String(state.EXTERNAL_EVENT_TIMESTAMP) || !evidence.observed_at) throw new Error(`chain evidence readback failed: ${JSON.stringify(evidence)}`);
  await saveState({ CHAIN_EVIDENCE_ID: evidenceId, chainEvidence: evidence, CHAIN_EVENT_TIMESTAMP: String(evidence.event_timestamp), CHAIN_INTERNAL_OBSERVED_AT: String(evidence.observed_at), CHAIN_EVIDENCE_BOUND: true });
  console.log(JSON.stringify({ stage: "CHAIN_BIND", tx: result.tx, evidence }));
}

async function readAdvisory(file) {
  const body = await readFile(file);
  const document = JSON.parse(body.toString("utf8"));
  const state = await loadState();
  const digest = createHash("sha256").update(body).digest("hex");
  if (document.protocol_id !== PROTOCOL_ID || document.protocol_address.toLowerCase() !== DEMO.toLowerCase() || document.incident_id !== state.FINAL_INCIDENT_ID || document.phase !== "EMERGENCY" || document.failure_class !== FAILURE || document.transaction_hash.toLowerCase() !== state.FINAL_OUTFLOW_TX.toLowerCase() || body.length >= 65536) throw new Error("advisory content/linkage validation failed");
  return { body, document, digest, bytes: body.length };
}

async function runAdvisoryBind(file, url, commit) {
  const state = await loadState();
  if (!state.FINAL_CHAIN_EVIDENCE_TX || state.FINAL_ADVISORY_EVIDENCE_TX) throw new Error("chain evidence missing or advisory evidence already attempted");
  if (!url.startsWith(ADVISORY_PREFIX)) throw new Error("advisory URL is outside locked prefix");
  const advisory = await readAdvisory(file);
  const evidenceId = `advisory-${state.FINAL_OUTFLOW_TX.slice(2, 14)}`;
  const args = [state.FINAL_INCIDENT_ID, evidenceId, "EMERGENCY", "SECURITY_ADVISORY", url, FAILURE, advisory.digest, state.FINAL_OUTFLOW_TX, 1n, ""];
  const result = await performWrite({ label: "FINAL_ADVISORY_EVIDENCE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "bind_evidence", args });
  const evidence = await read(result.client, SENTINEL, "get_evidence", [evidenceId]);
  if (evidence.evidence_type !== "SECURITY_ADVISORY" || evidence.transaction_hash !== state.FINAL_OUTFLOW_TX.toLowerCase() || !evidence.observed_at) throw new Error(`advisory evidence readback failed: ${JSON.stringify(evidence)}`);
  await saveState({ advisoryFile: file, advisoryUrl: url, advisoryCommit: commit, advisoryEvidenceId: evidenceId, advisoryDigest: advisory.digest, advisoryBytes: advisory.bytes, advisoryDocument: advisory.document, advisoryEvidence: evidence, ADVISORY_INTERNAL_OBSERVED_AT: String(evidence.observed_at), ADVISORY_EVIDENCE_BOUND: true });
  console.log(JSON.stringify({ stage: "ADVISORY_BIND", tx: result.tx, evidence, digest: advisory.digest, bytes: advisory.bytes, commit }));
}

async function runAssess() {
  const state = await loadState();
  if (!state.CHAIN_EVIDENCE_BOUND || !state.ADVISORY_EVIDENCE_BOUND || state.FINAL_ASSESSMENT_TX) throw new Error("evidence precondition failed or assessment already attempted");
  const { client } = await makeClient("beacon-final-deployer");
  const incident = await read(client, SENTINEL, "get_incident", [state.FINAL_INCIDENT_ID]);
  if (incident.state !== "ASSESSING") throw new Error(`assessment state precondition failed: ${JSON.stringify(incident)}`);
  const result = await performWrite({ label: "FINAL_ASSESSMENT", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "assess_incident", args: [state.FINAL_INCIDENT_ID] });
  const after = await read(result.client, SENTINEL, "get_incident", [state.FINAL_INCIDENT_ID]);
  if (after.state !== "ACTIVE_INCIDENT" || after.incident_verdict !== "ACTIVE_INCIDENT") throw new Error(`incident verdict was not ACTIVE_INCIDENT: ${JSON.stringify(after)}`);
  await saveState({ assessmentIncident: after, incidentVerdict: after.incident_verdict });
  console.log(JSON.stringify({ stage: "ASSESS", tx: result.tx, terminal: result.terminal, incident: after }));
}

async function runPause() {
  const state = await loadState();
  if (state.incidentVerdict !== "ACTIVE_INCIDENT" || state.FINAL_PAUSE_TX) throw new Error("pause authorization missing or pause already attempted");
  const { client } = await makeClient("beacon-final-deployer");
  const before = await protectedState(client);
  if (before.paused !== false) throw new Error("target was already paused");
  const result = await performWrite({ label: "FINAL_PAUSE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "execute_pause", args: [state.FINAL_INCIDENT_ID] });
  const after = await protectedState(result.client);
  if (after.paused !== true) throw new Error(`target pause readback failed: ${JSON.stringify(after)}`);
  await saveState({ pauseTargetState: after });
  console.log(JSON.stringify({ stage: "PAUSE", tx: result.tx, terminal: result.terminal, target: safe(after) }));
}

async function runConfirm() {
  const state = await loadState();
  if (!state.FINAL_PAUSE_TX || state.FINAL_CONFIRM_PAUSE_TX) throw new Error("pause missing or confirmation already attempted");
  const { client } = await makeClient("beacon-final-deployer");
  const target = await protectedState(client);
  if (target.paused !== true) throw new Error("target is not paused before confirmation");
  const result = await performWrite({ label: "FINAL_CONFIRM_PAUSE", accountName: "beacon-final-deployer", expectedAccount: OWNER, address: SENTINEL, functionName: "confirm_pause", args: [state.FINAL_INCIDENT_ID] });
  const incident = await read(result.client, SENTINEL, "get_incident", [state.FINAL_INCIDENT_ID]);
  if (incident.state !== "PAUSED") throw new Error(`incident was not PAUSED after confirmation: ${JSON.stringify(incident)}`);
  await saveState({ finalIncidentState: incident.state, finalIncidentReadback: incident, targetPausedReadback: target });
  console.log(JSON.stringify({ stage: "CONFIRM_PAUSE", tx: result.tx, terminal: result.terminal, incident, target: safe(target) }));
}

async function runContainment() {
  const state = await loadState();
  if (state.finalIncidentState !== "PAUSED") throw new Error("incident is not confirmed PAUSED");
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  const options = feesFromProfile(profile.deploy);
  const actor = await makeClient("player2");
  const owner = await makeClient("beacon-final-deployer");
  const outcomes = {};
  for (const [name, client, account, address, functionName, args] of [
    ["outflow", actor.client, actor.account, DEMO, "execute_outflow", [ACTOR, 1n]],
    ["process", owner.client, owner.account, DEMO, "process", [1n]],
  ]) {
    const fees = await client.estimateTransactionFeesForWrite({ account, address, functionName, args, ...options });
    try {
      await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
      outcomes[name] = "UNEXPECTED_SUCCESS";
    } catch (error) {
      outcomes[name] = `REJECTED: ${String(error?.shortMessage || error?.message || error).slice(0, 240)}`;
    }
  }
  if (outcomes.outflow.startsWith("UNEXPECTED") || outcomes.process.startsWith("UNEXPECTED")) throw new Error(`containment simulation failed: ${JSON.stringify(outcomes)}`);
  const finalClient = await makeClient("beacon-final-deployer");
  const finalTarget = await protectedState(finalClient.client);
  if (finalTarget.paused !== true || finalTarget.remediated !== false || String(finalTarget.treasury.treasury_balance) !== "900" || String(finalTarget.treasury.total_outflow) !== "100" || String(finalTarget.counters.pause_count) !== "1") throw new Error(`containment state mismatch: ${JSON.stringify(finalTarget)}`);
  await saveState({ postPauseOutflowSimulation: outcomes.outflow, postPauseProcessSimulation: outcomes.process, finalProtectedState: finalTarget, protocolRemainsPaused: true });
  console.log(JSON.stringify({ stage: "CONTAINMENT", simulations: outcomes, target: safe(finalTarget) }));
}

async function runFinalize() {
  const state = await loadState();
  if (!state.protocolRemainsPaused) throw new Error("containment proof is incomplete");
  const lines = [
    "FINAL CORRECTED INCIDENT PROOF",
    `NETWORK: studio-dev`, `CHAIN_ID: ${CHAIN_ID}`, `RPC: ${RPC}`,
    `SENTINEL_ADDRESS: ${SENTINEL}`, `PROTECTED_DEMO_ADDRESS: ${DEMO}`,
    `SENTINEL_SHA: ${SENTINEL_SHA}`, `PROTECTED_DEMO_SHA: ${DEMO_SHA}`,
    `PLAYER2_ADDRESS: ${ACTOR}`, `PLAYER2_BALANCE_BEFORE: ${state.player2BalanceBefore}`,
    `HEALTHY_BASELINE_TX: ${state.HEALTHY_BASELINE_TX}`, `HEALTHY_BASELINE_STATUS: ${state.BASELINE_STATUS}`, `HEALTHY_BASELINE_EXECUTION: ${state.BASELINE_EXECUTION}`, `TOTAL_PROCESSED_AFTER_BASELINE: ${state.totalProcessedAfterBaseline}`,
    `FINAL_OUTFLOW_TX: ${state.FINAL_OUTFLOW_TX}`, `FINAL_OUTFLOW_AMOUNT: ${state.outflowAmount}`, `FINAL_OUTFLOW_STATUS: ${state.FINAL_OUTFLOW_STATUS}`, `FINAL_OUTFLOW_CONSENSUS: ${state.FINAL_OUTFLOW_CONSENSUS}`, `FINAL_OUTFLOW_EXECUTION: ${state.FINAL_OUTFLOW_EXECUTION}`,
    `TREASURY_AFTER_OUTFLOW: ${JSON.stringify(state.treasuryAfterOutflow)}`, `LAST_OUTFLOW: ${JSON.stringify(state.lastOutflow)}`,
    `CANONICAL_RPC_FACTS: ${JSON.stringify(state.canonicalRpcFacts)}`, `CANONICAL_RPC_DIGEST: ${state.canonicalRpcDigest}`,
    `FINAL_INCIDENT_CREATE_TX: ${state.FINAL_INCIDENT_CREATE_TX}`, `FINAL_INCIDENT_ID: ${state.FINAL_INCIDENT_ID}`, `INCIDENT_STATE_AFTER_CREATE: ${state.incidentStateAfterCreate}`,
    `FINAL_CHAIN_EVIDENCE_TX: ${state.FINAL_CHAIN_EVIDENCE_TX}`, `CHAIN_EVIDENCE_BOUND: ${state.CHAIN_EVIDENCE_BOUND}`, `CHAIN_EVENT_TIMESTAMP: ${state.CHAIN_EVENT_TIMESTAMP}`, `CHAIN_INTERNAL_OBSERVED_AT: ${state.CHAIN_INTERNAL_OBSERVED_AT}`,
    `FINAL_INCIDENT_ADVISORY_FILE: ${state.advisoryFile}`, `FINAL_INCIDENT_ADVISORY_URL: ${state.advisoryUrl}`, `FINAL_INCIDENT_ADVISORY_SHA256: ${state.advisoryDigest}`, `FINAL_INCIDENT_ADVISORY_BYTES: ${state.advisoryBytes}`, `FINAL_EVIDENCE_REPO_COMMIT: ${state.advisoryCommit}`,
    `FINAL_ADVISORY_EVIDENCE_TX: ${state.FINAL_ADVISORY_EVIDENCE_TX}`, `ADVISORY_EVIDENCE_BOUND: ${state.ADVISORY_EVIDENCE_BOUND}`, `ADVISORY_INTERNAL_OBSERVED_AT: ${state.ADVISORY_INTERNAL_OBSERVED_AT}`,
    `DISTINCT_APPROVED_SOURCES: studio-dev.genlayer.com,raw.githubusercontent.com`, `SOURCE_THRESHOLD_MET: YES`,
    `FINAL_ASSESSMENT_TX: ${state.FINAL_ASSESSMENT_TX}`, `ASSESSMENT_STATUS: ${state.FINAL_ASSESSMENT_STATUS}`, `ASSESSMENT_CONSENSUS: ${state.FINAL_ASSESSMENT_CONSENSUS}`, `INCIDENT_VERDICT: ${state.incidentVerdict}`,
    `FINAL_PAUSE_TX: ${state.FINAL_PAUSE_TX}`, `PAUSE_STATUS: ${state.FINAL_PAUSE_STATUS}`, `PAUSE_EXECUTION: ${state.FINAL_PAUSE_EXECUTION}`,
    `FINAL_CONFIRM_PAUSE_TX: ${state.FINAL_CONFIRM_PAUSE_TX}`, `TARGET_PAUSED_READBACK: true`, `PAUSE_COUNT: ${state.finalProtectedState.counters.pause_count}`, `FINAL_INCIDENT_STATE: ${state.finalIncidentState}`,
    `POST_PAUSE_OUTFLOW_SIMULATION: ${state.postPauseOutflowSimulation}`, `POST_PAUSE_PROCESS_SIMULATION: ${state.postPauseProcessSimulation}`,
    `FINAL_TREASURY_BALANCE: ${state.finalProtectedState.treasury.treasury_balance}`, `FINAL_TOTAL_OUTFLOW: ${state.finalProtectedState.treasury.total_outflow}`, `FINAL_REMEDIATED: ${state.finalProtectedState.remediated}`, `PROTOCOL_REMAINS_PAUSED: ${state.protocolRemainsPaused}`,
    "REMEDIATION_EXECUTED: NO", "RECOVERY_STARTED: NO", "RECOVERY_ADVISORY_PUBLISHED: NO", "UNPAUSE_EXECUTED: NO",
  ];
  await writeFile(PROOF_PATH, lines.join("\n") + "\n", "utf8");
  console.log(JSON.stringify({ stage: "FINALIZED", proof: PROOF_PATH, state }));
}

const action = process.argv[2];
if (action === "preflight") await runPreflight();
else if (action === "baseline") await runBaseline();
else if (action === "outflow") await runOutflow();
else if (action === "reconcile-outflow") await runReconcileOutflow();
else if (action === "open") await runOpen();
else if (action === "reconcile-open") await runReconcileOpen();
else if (action === "chain") await runChainBind();
else if (action === "advisory-bind") await runAdvisoryBind(process.argv[3], process.argv[4], process.argv[5]);
else if (action === "assess") await runAssess();
else if (action === "pause") await runPause();
else if (action === "confirm") await runConfirm();
else if (action === "containment") await runContainment();
else if (action === "finalize") await runFinalize();
else throw new Error("usage: preflight|baseline|outflow|reconcile-outflow|open|reconcile-open|chain|advisory-bind|assess|pause|confirm|containment|finalize");
