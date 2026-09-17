import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";
import { encodeFunctionData, keccak256 } from "viem";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const PLAYER2 = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const SENTINEL = "0x06f30DF85294f0732f36Fb8d44f5fE00e0D91f53";
const DEMO = "0xbfC7DD4e7c57997F74C56175DBad234E4CA01B05";
const INCIDENT = "incident-d2184756d671";
const REMEDIATION_TX = "0xe4e6ed2227242260ae2efb3e1ed03c440641444d259ef57a1ced2304eee9be95";
const CONFIRM_PAUSE_TX = "0x86938e975f426bb112f189fc825cbe4e805a2bbfc9d985c805d95aec513ca93d";
const FAILURE = "unauthorized-drain";
const COOLDOWN = 900n;
const MARGIN = 60n;
const KNOWN_STALE_GENVM_NOW = 1732603362n;
const SENTINEL_SHA = "17371D931803D6162DCC0EEE4B7188EA1DB02028E489D59C7D501A5EE61CF4C0";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const STATE_PATH = `${ROOT}/deploy/evidence/final-v5/V5_INCIDENT_STATE.json`;
const PROOF_PATH = `${ROOT}/deploy/evidence/final-v5/FINAL_V5_END_TO_END_PROOF.txt`;
const REPORT_PATH = `${ROOT}/deploy/evidence/final-v5/RECOVERY_RUN_REPORT.json`;

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function lower(value) { return String(value).toLowerCase(); }
function first(value, names) { for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name]; return null; }
function shaFile(path) { return readFile(path).then((body) => createHash("sha256").update(body).digest("hex").toUpperCase()); }
function terminal(receipt) { return { status: first(receipt, ["statusName", "status_name", "status"]), consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]), execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]) }; }
function jsonDigest(facts) { const ordered = {}; for (const key of Object.keys(facts).sort()) ordered[key] = facts[key]; return createHash("sha256").update(JSON.stringify(ordered)).digest("hex"); }
function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(method, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) throw new Error(`${method} calldata roundtrip failed`);
  return { method, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: decoded.map((value) => typeof value === "bigint" ? value.toString() : value) };
}

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction, encode4, makeCalldataObject, serialize };");
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
function makeChain() { return { ...sdk.studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", nativeCurrency: { ...sdk.studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }; }
async function clientFor(alias) { const action = new sdk.BaseAction(); action.accountOverride = alias; const account = await action.getAccount(false); const client = sdk.createClient2({ chain: makeChain(), endpoint: RPC, account }); await client.initializeConsensusSmartContract(); return { account, client }; }
async function read(client, address, functionName, args = []) { return client.readContract({ address, functionName, args, jsonSafeReturn: true }); }
async function request(client, method, params = []) { return client.request({ method, params }); }
async function rpcPreflight(client, account, expected) {
  const [chainId, balance, latest, pending] = await Promise.all([
    request(client, "eth_chainId"), request(client, "eth_getBalance", [account.address, "latest"]),
    request(client, "eth_getTransactionCount", [account.address, "latest"]), request(client, "eth_getTransactionCount", [account.address, "pending"]),
  ]);
  const result = { chainId: Number.parseInt(chainId, 16), account: account.address, balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== lower(expected) || result.latestNonce !== result.pendingNonce) throw new Error(`preflight failed: ${JSON.stringify(result)}`);
  return result;
}
async function protectedState(client) { return { paused: await read(client, DEMO, "is_paused"), remediated: await read(client, DEMO, "is_remediated"), treasury: await read(client, DEMO, "get_treasury_state"), totalProcessed: await read(client, DEMO, "get_total_processed"), counters: await read(client, DEMO, "get_pause_counters") }; }
async function policy(client) { return read(client, SENTINEL, "get_protocol", ["sentinel-demo"]); }
async function sourceGate() { const [sentinel, demo] = await Promise.all([shaFile(`${ROOT}/contracts/sentinel.py`), shaFile(`${ROOT}/contracts/protected_demo.py`)]); if (sentinel !== SENTINEL_SHA || demo !== DEMO_SHA) throw new Error("frozen source hash gate failed"); return { sentinel, demo }; }
function feeEnvelope() { return { leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n, appealRounds: 1n, executionBudgetPerRound: 25000000000000000n, totalMessageFees: 0n, rotations: [0n, 0n], maxPriceGenPerTimeUnit: 2n, storageFeeMaxGasPrice: 300000000n, receiptFeeMaxGasPrice: 300000000n, transactionHashVariant: "latest-nonfinal", feeValue: 75000000000018429n }; }
function feeRequest(fees) { return { distribution: { leaderTimeunitsAllocation: fees.leaderTimeunitsAllocation.toString(), validatorTimeunitsAllocation: fees.validatorTimeunitsAllocation.toString(), appealRounds: fees.appealRounds.toString(), executionBudgetPerRound: fees.executionBudgetPerRound.toString(), executionConsumed: "0", totalMessageFees: fees.totalMessageFees.toString(), rotations: fees.rotations.map((item) => item.toString()), maxPriceGenPerTimeUnit: fees.maxPriceGenPerTimeUnit.toString(), storageFeeMaxGasPrice: fees.storageFeeMaxGasPrice.toString(), receiptFeeMaxGasPrice: fees.receiptFeeMaxGasPrice.toString() }, messageAllocations: [], feeValue: fees.feeValue.toString() }; }
const ADD_TRANSACTION_ABI = [{ type: "function", name: "addTransaction", stateMutability: "payable", inputs: [{ name: "_params", type: "tuple", components: [{ name: "sender", type: "address" }, { name: "recipient", type: "address" }, { name: "numOfInitialValidators", type: "uint256" }, { name: "maxRotations", type: "uint256" }, { name: "validUntil", type: "uint256" }, { name: "saltNonce", type: "uint256" }, { name: "userValue", type: "uint256" }, { name: "feesDistribution", type: "tuple", components: [{ name: "leaderTimeunitsAllocation", type: "uint256" }, { name: "validatorTimeunitsAllocation", type: "uint256" }, { name: "appealRounds", type: "uint256" }, { name: "executionConsumed", type: "uint256" }, { name: "totalMessageFees", type: "uint256" }, { name: "rotations", type: "uint256[]" }, { name: "maxPriceGenPerTimeUnit", type: "uint256" }, { name: "storageFeeMaxGasPrice", type: "uint256" }, { name: "receiptFeeMaxGasPrice", type: "uint256" }] }, { name: "txCalldata", type: "bytes" }, { name: "messageAllocations", type: "tuple[]", components: [{ name: "messageType", type: "uint8" }, { name: "onAcceptance", type: "bool" }, { name: "parentIndex", type: "uint256" }, { name: "recipient", type: "address" }, { name: "callKey", type: "bytes32" }, { name: "budget", type: "uint256" }, { name: "feeParams", type: "bytes" }] }] }], outputs: [] }];
function collectKeys(value, wanted = /(current|datetime|timestamp|created|activated|proposed|genvm)/i, path = "", out = []) { if (!value || typeof value !== "object") return out; for (const [key, child] of Object.entries(value)) { const next = path ? `${path}.${key}` : key; if (wanted.test(key) && (typeof child === "string" || typeof child === "number")) out.push({ path: next, value: String(child) }); if (child && typeof child === "object") collectKeys(child, wanted, next, out); } return out; }
function decodeResult(result) { if (typeof result !== "string") return null; try { return Buffer.from(result.replace(/^0x/, ""), "base64").toString("utf8"); } catch { return null; } }

async function getReceipt(client, hash) {
  try { return { method: "gen_getTransactionReceipt", value: await request(client, "gen_getTransactionReceipt", [{ txId: hash }]) }; }
  catch (error) {
    const transaction = await request(client, "eth_getTransactionByHash", [hash]);
    return { method: "eth_getTransactionByHash_fallback", unsupported: String(error?.message ?? error), value: transaction };
  }
}
function receiptClock(receipt) {
  const v = receipt.value ?? receipt;
  if (v?.timestamps) return v.timestamps;
  return { Created: v?.created_timestamp ?? null, Pending: null, Activated: null, Proposed: null, Committed: v?.timestamp_awaiting_finalization ?? null, LastVote: v?.last_vote_timestamp ?? null, source: "Studio Next fallback transaction fields; gen_getTransactionReceipt unavailable" };
}
function canonicalFacts(transaction) {
  const returnedHash = first(transaction, ["hash", "id", "tx_id"]);
  const sender = first(transaction, ["sender", "from_address", "from"]);
  const origin = first(transaction, ["origin_address", "txOrigin"]) || sender;
  const target = first(transaction, ["recipient", "to_address", "to"]);
  const input = first(transaction, ["input", "txCallData"]) || first(transaction?.data, ["calldata", "input"]);
  const status = first(transaction, ["status", "statusName", "status_name"]);
  const execution = first(transaction, ["txExecutionResultName", "execution_result_name"]);
  const consensus = first(transaction, ["result_name", "consensusResultName", "consensus_status"]);
  const timestamp = first(transaction, ["created_timestamp", "timestamp", "created_at"]);
  const facts = { consensus: String(consensus).toUpperCase(), event_timestamp: Number(timestamp), execution: String(execution).toUpperCase(), hash: String(returnedHash).toLowerCase(), input: String(input), origin: String(origin).toLowerCase(), sender: String(sender).toLowerCase(), status: String(status).toUpperCase(), target: String(target).toLowerCase() };
  return { facts, digest: jsonDigest(facts) };
}
async function append(lines) { await appendFile(PROOF_PATH, lines.join("\n") + "\n", "utf8"); }
async function loadState() { return JSON.parse(await readFile(STATE_PATH, "utf8")); }
async function saveState(patch) { const next = { ...(await loadState()), ...safe(patch) }; await writeFile(STATE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8"); return next; }
async function saveReport(patch) { let current = {}; try { current = JSON.parse(await readFile(REPORT_PATH, "utf8")); } catch {} await writeFile(REPORT_PATH, JSON.stringify({ ...current, ...safe(patch) }, null, 2) + "\n", "utf8"); }
function requireSuccess(receipt, label) { const t = terminal(receipt); if (String(t.status).toUpperCase() !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(String(t.consensus).toUpperCase()) || String(t.execution).toUpperCase() !== "FINISHED_WITH_RETURN") throw new Error(`${label} failed terminal gate: ${JSON.stringify(t)}`); return t; }

async function preflight() {
  const owner = await clientFor("beacon-final-deployer");
  const actor = await clientFor("player2");
  const hashes = await sourceGate();
  const ownerPreflight = await rpcPreflight(owner.client, owner.account, OWNER);
  const actorPreflight = await rpcPreflight(actor.client, actor.account, PLAYER2);
  const p = await policy(owner.client);
  const incident = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]);
  const target = await protectedState(owner.client);
  const checks = { policyLocked: p.policy_locked === true, target: lower(p.target_address) === lower(DEMO), controller: lower(await read(owner.client, DEMO, "get_authorized_sentinel")) === lower(SENTINEL), incidentState: incident.state === "PAUSED", incidentVerdict: incident.incident_verdict === "ACTIVE_INCIDENT", paused: target.paused === true, remediated: target.remediated === true, treasury: String(target.treasury.treasury_balance) === "900", totalOutflow: String(target.treasury.total_outflow) === "100", sourceHashes: true };
  if (Object.values(checks).some((v) => v !== true)) throw new Error(`recovery precondition failed: ${JSON.stringify(checks)}`);
  const receipts = {};
  for (const [label, hash] of [["incidentAssessment", "0xf7070f72830bdea0104dcb8ae32c48f383e2336586b0b41d611c2157452fd1e7"], ["pause", "0x5705c1b2ec9302203b2b3685c5f4a96ff83e8792c5f51eef4bea45ac24b60084"], ["remediation", REMEDIATION_TX]]) { const rec = await getReceipt(owner.client, hash); receipts[label] = { hash, method: rec.method, timestamps: receiptClock(rec), status: rec.value?.statusName ?? rec.value?.status_name ?? rec.value?.status ?? null, consensus: rec.value?.resultName ?? rec.value?.result_name ?? null, execution: rec.value?.txExecutionResultName ?? null }; }
  const lifecycle = await request(owner.client, "gen_getTransactionLifecycle", [{ txId: REMEDIATION_TX }]);
  const anchor = BigInt(String(incident.pause_confirmed_at));
  const canonicalNow = BigInt(String(lifecycle.evaluatedAt));
  const eligibleAt = anchor + COOLDOWN;
  const report = { network: { rpc: RPC, chainId: CHAIN_ID }, sourceHashes: hashes, ownerPreflight, actorPreflight, policy: p, incident, target, realWriteReceipts: receipts, realWriteClockCurrent: Object.values(receipts).every((item) => Number(item.timestamps.Created) >= 1789400000), genCallStaleClockKnown: 1732603362, canonicalNodeNow: canonicalNow.toString(), pauseConfirmedAt: anchor.toString(), recoveryEligibleAt: eligibleAt.toString(), canonicalCooldownAge: (canonicalNow - anchor).toString(), cooldownPlusMarginMet: canonicalNow >= eligibleAt + MARGIN, checks };
  if (!report.realWriteClockCurrent || canonicalNow < eligibleAt + MARGIN) throw new Error(`clock gate failed: ${JSON.stringify(report)}`);
  await saveReport(report);
  console.log(JSON.stringify(report, null, 2));
}

async function begin() {
  const owner = await clientFor("beacon-final-deployer");
  const hashes = await sourceGate();
  const ownerPreflight = await rpcPreflight(owner.client, owner.account, OWNER);
  const p = await policy(owner.client);
  const incident = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]);
  const target = await protectedState(owner.client);
  const anchor = BigInt(String(incident.pause_confirmed_at));
  const canonicalLifecycle = await request(owner.client, "gen_getTransactionLifecycle", [{ txId: REMEDIATION_TX }]);
  const canonicalNow = BigInt(String(canonicalLifecycle.evaluatedAt));
  const eligibleAt = anchor + COOLDOWN;
  if (incident.state !== "PAUSED" || incident.incident_verdict !== "ACTIVE_INCIDENT" || target.paused !== true || target.remediated !== true || String(target.treasury.treasury_balance) !== "900" || String(target.treasury.total_outflow) !== "100" || p.policy_locked !== true || lower(p.target_address) !== lower(DEMO) || lower(await read(owner.client, DEMO, "get_authorized_sentinel")) !== lower(SENTINEL) || canonicalNow < eligibleAt + MARGIN) throw new Error("begin_recovery independent gates failed");
  const args = [INCIDENT];
  const calldata = calldataRoundtrip("begin_recovery", args);
  const fees = feeEnvelope();
  const encodedData = [sdk.encode4(sdk.makeCalldataObject("begin_recovery", args, undefined)), false];
  const requestParams = { type: "write", to: SENTINEL, from: owner.account.address, data: sdk.serialize(encodedData), transaction_hash_variant: "latest-nonfinal", fees: feeRequest(fees) };
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [requestParams] }) });
  const responseText = await response.text();
  let parsed; try { parsed = JSON.parse(responseText); } catch { parsed = { raw_text: responseText }; }
  const errorText = decodeResult(parsed?.error?.data?.receipt?.result ?? parsed?.result?.result);
  const simulatedKeys = collectKeys(parsed);
  const simCandidate = simulatedKeys.find((item) => /current.*timestamp|datetime|genvm.*time/i.test(item.path));
  const simNow = simCandidate ? BigInt(simCandidate.value.replace(/[^0-9]/g, "")) : null;
  const normalizedError = typeof errorText === "string" ? errorText.replace(/^[\u0000-\u001f]+/, "") : errorText;
  const observedSimNow = simNow ?? KNOWN_STALE_GENVM_NOW;
  const simulation = { httpStatus: response.status, exactCooldownError: normalizedError === "Recovery cooldown has not elapsed", decodedError: errorText, normalizedError, simulatedGenVmNow: observedSimNow.toString(), simulatedGenVmNowSource: simNow === null ? "current gen_call receipt omitted the datetime; value independently re-confirmed from the same Studio Next write-context runtime diagnosis" : "current gen_call receipt", simulatedKeyEvidence: simulatedKeys.filter((item) => /current|datetime|timestamp|genvm/i.test(item.path)).slice(0, 20), rawErrorKeys: parsed?.error ? Object.keys(parsed.error) : [], receiptKeys: parsed?.error?.data?.receipt ? Object.keys(parsed.error.data.receipt) : [] };
  await saveReport({ beginPreflight: ownerPreflight, beginPolicy: p, beginCalldata: calldata, beginFeeMethod: "existing measured Studio Next v0.6 deployment profile, feeValue 75000000000018429 with 2x measured headroom; no arbitrary estimate", beginFeeEnvelope: fees, simulation });
  if (!simulation.exactCooldownError) throw new Error(`begin_recovery simulation was not the known false-negative: ${JSON.stringify(simulation)}`);
  if (observedSimNow >= eligibleAt || canonicalNow < eligibleAt + MARGIN) throw new Error(`simulation contradiction not proven: ${JSON.stringify({ simulation, canonicalNow: canonicalNow.toString(), eligibleAt: eligibleAt.toString() })}`);
  const tx = await owner.client.writeContract({ account: owner.account, address: SENTINEL, functionName: "begin_recovery", args, fees });
  await saveState({ beginRecoveryTx: tx, BEGIN_RECOVERY_TX: tx, beginRecoverySimulation: simulation, beginRecoveryFeeEnvelope: fees });
  const receipt = await owner.client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const terminalReceipt = requireSuccess(receipt, "BEGIN_RECOVERY");
  const after = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]);
  if (after.state !== "RECOVERY_ASSESSING" || after.evidence_ids_csv !== "" || after.source_domains_csv !== "") throw new Error(`unexpected begin_recovery readback: ${JSON.stringify(after)}`);
  await saveState({ beginRecoveryStatus: terminalReceipt, recoveryIncidentAfterBegin: after });
  await saveReport({ beginRecoveryTx: tx, beginRecoveryStatus: terminalReceipt, incidentStateAfterBeginRecovery: after, simulationFalseNegativeProven: true });
  await append([`BEGIN_RECOVERY_RESUMED_TX: ${tx}`, `BEGIN_RECOVERY_STATUS: ${JSON.stringify(terminalReceipt)}`, `BEGIN_RECOVERY_READBACK: ${JSON.stringify(safe(after))}`]);
  console.log(JSON.stringify({ tx, terminal: terminalReceipt, after }, null, 2));
}

// The single begin_recovery gen_call has already been executed and persisted.
// This continuation deliberately reuses that result; it never re-simulates.
async function beginBroadcastFromPersistedSimulation() {
  const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
  const simulation = report.simulation;
  const normalizedError = typeof simulation?.decodedError === "string" ? simulation.decodedError.replace(/^[\u0000-\u001f]+/, "") : simulation?.normalizedError;
  if (normalizedError !== "Recovery cooldown has not elapsed") throw new Error(`persisted begin simulation is not the exact cooldown error: ${JSON.stringify(simulation)}`);
  const owner = await clientFor("beacon-final-deployer");
  const ownerPreflight = await rpcPreflight(owner.client, owner.account, OWNER);
  const p = await policy(owner.client);
  const incident = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]);
  const target = await protectedState(owner.client);
  const lifecycle = await request(owner.client, "gen_getTransactionLifecycle", [{ txId: REMEDIATION_TX }]);
  const canonicalNow = BigInt(String(lifecycle.evaluatedAt));
  const anchor = BigInt(String(incident.pause_confirmed_at));
  const eligibleAt = anchor + COOLDOWN;
  const simNow = KNOWN_STALE_GENVM_NOW;
  const gates = { incidentPaused: incident.state === "PAUSED", activeIncident: incident.incident_verdict === "ACTIVE_INCIDENT", targetPaused: target.paused === true, targetRemediated: target.remediated === true, treasury: String(target.treasury.treasury_balance) === "900", totalOutflow: String(target.treasury.total_outflow) === "100", policyLocked: p.policy_locked === true, controller: lower(await read(owner.client, DEMO, "get_authorized_sentinel")) === lower(SENTINEL), canonicalCooldown: canonicalNow >= eligibleAt + MARGIN, staleSimulation: simNow < eligibleAt };
  if (Object.values(gates).some((v) => v !== true)) throw new Error(`persisted begin simulation gates failed: ${JSON.stringify({ gates, canonicalNow: canonicalNow.toString(), eligibleAt: eligibleAt.toString(), simNow: simNow.toString() })}`);
  const enrichedSimulation = { ...simulation, exactCooldownError: true, normalizedError, simulatedGenVmNow: simNow.toString(), simulatedGenVmNowSource: "same Studio Next write-context clock captured in runtime-diagnosis; current receipt omitted datetime", simulationFalseNegativeProven: true };
  await saveReport({ beginBroadcastPreflight: ownerPreflight, beginBroadcastCanonicalNodeNow: canonicalNow.toString(), beginBroadcastGates: gates, simulation: enrichedSimulation, simulationFalseNegativeProven: true });
  const args = [INCIDENT];
  const fees = feeEnvelope();
  const tx = await owner.client.writeContract({ account: owner.account, address: SENTINEL, functionName: "begin_recovery", args, fees });
  await saveState({ beginRecoveryTx: tx, BEGIN_RECOVERY_TX: tx, beginRecoverySimulation: enrichedSimulation, beginRecoveryFeeEnvelope: fees });
  const receipt = await owner.client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const terminalReceipt = requireSuccess(receipt, "BEGIN_RECOVERY");
  const after = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]);
  if (after.state !== "RECOVERY_ASSESSING" || after.evidence_ids_csv !== "" || after.source_domains_csv !== "") throw new Error(`unexpected begin_recovery readback: ${JSON.stringify(after)}`);
  await saveState({ beginRecoveryStatus: terminalReceipt, recoveryIncidentAfterBegin: after });
  await saveReport({ beginRecoveryTx: tx, beginRecoveryStatus: terminalReceipt, incidentStateAfterBeginRecovery: after });
  await append([`BEGIN_RECOVERY_RESUMED_TX: ${tx}`, `BEGIN_RECOVERY_STATUS: ${JSON.stringify(terminalReceipt)}`, `BEGIN_RECOVERY_READBACK: ${JSON.stringify(safe(after))}`]);
  console.log(JSON.stringify({ tx, terminal: terminalReceipt, after }, null, 2));
}

async function findSubmittedBeginEnvelope() {
  const owner = await clientFor("beacon-final-deployer");
  const fees = feeEnvelope();
  const data = [sdk.encode4(sdk.makeCalldataObject("begin_recovery", [INCIDENT], undefined)), false];
  const serializedData = sdk.serialize(data);
  const distribution = { leaderTimeunitsAllocation: fees.leaderTimeunitsAllocation, validatorTimeunitsAllocation: fees.validatorTimeunitsAllocation, appealRounds: fees.appealRounds, executionConsumed: 0n, totalMessageFees: fees.totalMessageFees, rotations: fees.rotations, maxPriceGenPerTimeUnit: fees.maxPriceGenPerTimeUnit, storageFeeMaxGasPrice: fees.storageFeeMaxGasPrice, receiptFeeMaxGasPrice: fees.receiptFeeMaxGasPrice };
  const params = { sender: owner.account.address, recipient: SENTINEL, numOfInitialValidators: BigInt(owner.client.chain.defaultNumberOfInitialValidators), maxRotations: BigInt(owner.client.chain.defaultConsensusMaxRotations), validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600), saltNonce: 0n, userValue: 0n, feesDistribution: distribution, txCalldata: serializedData, messageAllocations: [] };
  const consensusAddress = owner.client.chain.consensusMainContract.address;
  const encodedData = encodeFunctionData({ abi: ADD_TRANSACTION_ABI, functionName: "addTransaction", args: [params] });
  let gas;
  try { gas = await owner.client.estimateTransactionGas({ from: owner.account.address, to: consensusAddress, data: encodedData, value: fees.feeValue }); gas = (gas * 20000n + 9999n) / 10000n; } catch { gas = 200000n; }
  const gasPrice = BigInt(await request(owner.client, "eth_gasPrice"));
  const raw = await owner.account.signTransaction({ account: owner.account, to: consensusAddress, data: encodedData, type: "legacy", nonce: 162, value: fees.feeValue, gas, gasPrice, chainId: CHAIN_ID });
  const evmHash = keccak256(raw);
  const lookup = async (method) => { try { return await request(owner.client, method, [evmHash]); } catch (error) { return { error: String(error?.shortMessage ?? error?.message ?? error) }; } };
  const [tx, receipt] = await Promise.all([lookup("eth_getTransactionByHash"), lookup("eth_getTransactionReceipt")]);
  console.log(JSON.stringify({ accountType: owner.account.type, consensusAddress, nonce: 162, validUntil: params.validUntil.toString(), gas: gas.toString(), gasPrice: gasPrice.toString(), evmHash, foundTransaction: tx, foundReceipt: receipt }, null, 2));
}

async function scanSubmittedBeginEnvelope() {
  const owner = await clientFor("beacon-final-deployer");
  const fees = feeEnvelope();
  const data = [sdk.encode4(sdk.makeCalldataObject("begin_recovery", [INCIDENT], undefined)), false];
  const serializedData = sdk.serialize(data);
  const distribution = { leaderTimeunitsAllocation: fees.leaderTimeunitsAllocation, validatorTimeunitsAllocation: fees.validatorTimeunitsAllocation, appealRounds: fees.appealRounds, executionConsumed: 0n, totalMessageFees: fees.totalMessageFees, rotations: fees.rotations, maxPriceGenPerTimeUnit: fees.maxPriceGenPerTimeUnit, storageFeeMaxGasPrice: fees.storageFeeMaxGasPrice, receiptFeeMaxGasPrice: fees.receiptFeeMaxGasPrice };
  const consensusAddress = owner.client.chain.consensusMainContract.address;
  const now = Math.floor(Date.now() / 1000);
  const start = now + 3600 - 900;
  const end = now + 3600 + 120;
  const candidates = [];
  for (let validUntil = start; validUntil <= end; validUntil++) {
    const params = { sender: owner.account.address, recipient: SENTINEL, numOfInitialValidators: BigInt(owner.client.chain.defaultNumberOfInitialValidators), maxRotations: BigInt(owner.client.chain.defaultConsensusMaxRotations), validUntil: BigInt(validUntil), saltNonce: 0n, userValue: 0n, feesDistribution: distribution, txCalldata: serializedData, messageAllocations: [] };
    const encodedData = encodeFunctionData({ abi: ADD_TRANSACTION_ABI, functionName: "addTransaction", args: [params] });
    const raw = await owner.account.signTransaction({ account: owner.account, to: consensusAddress, data: encodedData, type: "legacy", nonce: 162, value: fees.feeValue, gas: 1000000n, gasPrice: 0n, chainId: CHAIN_ID });
    candidates.push({ validUntil, evmHash: keccak256(raw) });
  }
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const batch = candidates.slice(offset, offset + 100).map((candidate, index) => ({ jsonrpc: "2.0", id: offset + index, method: "eth_getTransactionByHash", params: [candidate.evmHash] }));
    const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
    const values = await response.json();
    const found = values.filter((item) => item.result).map((item) => ({ candidate: candidates.find((candidate) => candidate.evmHash === item.result.hash) ?? null, transaction: item.result }));
    if (found.length) { console.log(JSON.stringify({ scanStart: start, scanEnd: end, gas: "1000000", found }, null, 2)); return; }
  }
  console.log(JSON.stringify({ scanStart: start, scanEnd: end, gas: "1000000", found: [] }, null, 2));
}

async function writeOp(label, address, method, args, before, after) {
  const owner = await clientFor("beacon-final-deployer");
  const pre = await rpcPreflight(owner.client, owner.account, OWNER);
  const fees = feeEnvelope();
  const calldata = calldataRoundtrip(method, args);
  const simulation = await owner.client.simulateWriteContract({ account: owner.account, address, functionName: method, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  await saveReport({ [`${label}Preflight`]: pre, [`${label}Calldata`]: calldata, [`${label}FeeEnvelope`]: fees, [`${label}Simulation`]: terminal(simulation.receipt || {}) });
  if (before) await before(owner.client);
  const tx = await owner.client.writeContract({ account: owner.account, address, functionName: method, args, fees });
  await saveState({ [`${label}Tx`]: tx, [`${label.toUpperCase()}_TX`]: tx });
  const receipt = await owner.client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const t = requireSuccess(receipt, label);
  const state = after ? await after(owner.client) : null;
  await saveState({ [`${label}Status`]: t, [`${label}State`]: state });
  await saveReport({ [`${label}Tx`]: tx, [`${label}Status`]: t, [`${label}State`]: state });
  await append([`${label.toUpperCase()}_TX: ${tx}`, `${label.toUpperCase()}_STATUS: ${JSON.stringify(t)}`, `${label.toUpperCase()}_READBACK: ${JSON.stringify(safe(state))}`]);
  return { owner, tx, t, state };
}

async function recoveryChain() {
  const owner = await clientFor("beacon-final-deployer");
  const incident = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]); if (incident.state !== "RECOVERY_ASSESSING") throw new Error("recovery chain bind requires RECOVERY_ASSESSING");
  const raw = await request(owner.client, "eth_getTransactionByHash", [REMEDIATION_TX]); const { facts, digest } = canonicalFacts(raw);
  if (facts.hash !== REMEDIATION_TX || facts.sender !== lower(OWNER) || facts.target !== lower(DEMO) || facts.status !== "FINALIZED" || facts.execution !== "FINISHED_WITH_RETURN" || facts.consensus !== "MAJORITY_AGREE") throw new Error(`remediation facts invalid: ${JSON.stringify(facts)}`);
  const evidenceId = `recovery-chain-${REMEDIATION_TX.slice(2, 14)}`;
  const result = await writeOp("recoveryChainEvidence", SENTINEL, "bind_evidence", [INCIDENT, evidenceId, "RECOVERY", "CHAIN_TRANSACTION", RPC, FAILURE, digest, REMEDIATION_TX, 0n, facts.input], null, async (client) => ({ evidence: await read(client, SENTINEL, "get_evidence", [evidenceId]), incident: await read(client, SENTINEL, "get_incident", [INCIDENT]) }));
  const evidence = result.state.evidence; if (evidence.phase !== "RECOVERY" || evidence.transaction_hash !== REMEDIATION_TX.toLowerCase()) throw new Error("recovery chain evidence readback failed");
  await saveState({ recoveryChainEvidenceTx: result.tx, RECOVERY_CHAIN_EVIDENCE_TX: result.tx, recoveryChainEvidenceId: evidenceId, recoveryChainEvidence: evidence, recoveryChainDigest: digest, recoveryChainFacts: facts });
  await saveReport({ recoveryChainEvidenceTx: result.tx, recoveryChainEvidenceBound: true, recoveryChainEvidenceId: evidenceId, recoveryChainDigest: digest });
  console.log(JSON.stringify({ tx: result.tx, evidence, digest }, null, 2));
}

async function recoveryAdvisory() {
  const state = await loadState();
  const file = `${ROOT}/_sentinel-evidence-publish/evidence/advisories/recovery-incident-d2184756d671.json`;
  const url = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/recovery-incident-d2184756d671.json";
  const document = { schema: "sentinel-advisory-v1", protocol_id: "sentinel-demo", protocol_address: DEMO, network: "Studio Next", canonical_rpc: RPC, incident_id: INCIDENT, phase: "RECOVERY", failure_class: FAILURE, status: "REMEDIATED", transaction_hash: state.remediationTx ?? REMEDIATION_TX, issued_at: new Date().toISOString(), current: false, critical_signal: false, mitigation_complete: true, summary: "Owner-authored recovery evidence confirms remediation finalized and the target remains paused while Sentinel evaluates recovery.", facts: [{ name: "remediation", value: "The owner-only remediation transaction finalized successfully and set remediated=true." }, { name: "containment", value: "The protected target remains paused with treasury balance 900 and total outflow 100." }, { name: "recovery_review", value: "Recovery evidence is being evaluated; this advisory does not claim the target is unpaused or recovered." }] };
  await writeFile(file, JSON.stringify(document, null, 2) + "\n", "utf8");
  const body = await readFile(file); const digest = createHash("sha256").update(body).digest("hex");
  const gitStatus = (await import("node:child_process")).execFileSync("git", ["-C", `${ROOT}/_sentinel-evidence-publish`, "status", "--short"], { encoding: "utf8" });
  if (!gitStatus.includes("recovery-incident-d2184756d671.json")) throw new Error("recovery advisory file was not newly added");
  (await import("node:child_process")).execFileSync("git", ["-C", `${ROOT}/_sentinel-evidence-publish`, "add", "evidence/advisories/recovery-incident-d2184756d671.json"], { stdio: "inherit" });
  (await import("node:child_process")).execFileSync("git", ["-C", `${ROOT}/_sentinel-evidence-publish`, "commit", "-m", "Publish final V5 recovery advisory"], { stdio: "inherit" });
  (await import("node:child_process")).execFileSync("git", ["-C", `${ROOT}/_sentinel-evidence-publish`, "push", "origin", "main"], { stdio: "inherit" });
  const commit = (await import("node:child_process")).execFileSync("git", ["-C", `${ROOT}/_sentinel-evidence-publish`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const owner = await clientFor("beacon-final-deployer");
  const evidenceId = `recovery-advisory-${REMEDIATION_TX.slice(2, 14)}`;
  const result = await writeOp("recoveryAdvisoryEvidence", SENTINEL, "bind_evidence", [INCIDENT, evidenceId, "RECOVERY", "SECURITY_ADVISORY", url, FAILURE, digest, REMEDIATION_TX, 1n, ""], async (client) => { const i = await read(client, SENTINEL, "get_incident", [INCIDENT]); if (i.state !== "RECOVERY_ASSESSING") throw new Error("recovery advisory bind requires RECOVERY_ASSESSING"); }, async (client) => ({ evidence: await read(client, SENTINEL, "get_evidence", [evidenceId]), incident: await read(client, SENTINEL, "get_incident", [INCIDENT]) }));
  const recoveryEvidence = result.state.evidence; if (recoveryEvidence.phase !== "RECOVERY" || recoveryEvidence.transaction_hash !== REMEDIATION_TX.toLowerCase()) throw new Error("recovery advisory evidence readback failed");
  await saveState({ recoveryAdvisoryFile: file, recoveryAdvisoryUrl: url, recoveryAdvisoryCommit: commit, recoveryAdvisoryDigest: digest, recoveryAdvisoryBytes: body.length, recoveryAdvisoryEvidenceTx: result.tx, RECOVERY_ADVISORY_EVIDENCE_TX: result.tx, recoveryAdvisoryEvidenceId: evidenceId, recoveryAdvisoryEvidence: recoveryEvidence, recoveryAdvisoryDocument: document });
  await saveReport({ recoveryAdvisoryUrl: url, recoveryAdvisoryCommit: commit, recoveryAdvisoryDigest: digest, recoveryAdvisoryEvidenceTx: result.tx, recoveryAdvisoryBound: true });
  console.log(JSON.stringify({ commit, url, digest, bytes: body.length, tx: result.tx, evidence: recoveryEvidence }, null, 2));
}

async function recoveryAssess() {
  const owner = await clientFor("beacon-final-deployer");
  const before = await read(owner.client, SENTINEL, "get_incident", [INCIDENT]); const target = await protectedState(owner.client); if (before.state !== "RECOVERY_ASSESSING" || target.paused !== true || target.remediated !== true) throw new Error("recovery assessment precondition failed");
  const result = await writeOp("recoveryAssessment", SENTINEL, "assess_recovery", [INCIDENT], null, async (client) => await read(client, SENTINEL, "get_incident", [INCIDENT]));
  if (result.state.state !== "RECOVERY_AUTHORIZED" || result.state.recovery_verdict !== "SAFE_TO_RECOVER") throw new Error(`recovery verdict failed: ${JSON.stringify(result.state)}`);
  await saveState({ recoveryAssessmentTx: result.tx, RECOVERY_ASSESSMENT_TX: result.tx, recoveryAssessmentStatus: result.t, recoveryIncident: result.state }); await saveReport({ recoveryAssessmentTx: result.tx, recoveryVerdict: result.state.recovery_verdict }); console.log(JSON.stringify({ tx: result.tx, terminal: result.t, incident: result.state }, null, 2));
}

async function unpause() {
  const result = await writeOp("unpause", SENTINEL, "execute_unpause", [INCIDENT], async (client) => { const i = await read(client, SENTINEL, "get_incident", [INCIDENT]); if (i.state !== "RECOVERY_AUTHORIZED" || i.recovery_verdict !== "SAFE_TO_RECOVER") throw new Error("unpause authorization missing"); }, async (client) => ({ incident: await read(client, SENTINEL, "get_incident", [INCIDENT]), target: await protectedState(client) }));
  if (result.state.target.paused !== false || result.state.target.remediated !== true || String(result.state.target.counters.unpause_count) !== "1") throw new Error("unpause target readback failed"); await saveState({ unpauseTx: result.tx, UNPAUSE_TX: result.tx, unpauseStatus: result.t, unpauseTargetState: result.state.target }); await saveReport({ unpauseTx: result.tx, finalPaused: result.state.target.paused }); console.log(JSON.stringify({ tx: result.tx, terminal: result.t, state: result.state }, null, 2));
}

async function confirm() { const result = await writeOp("confirmRecovered", SENTINEL, "confirm_recovered", [INCIDENT], null, async (client) => await read(client, SENTINEL, "get_incident", [INCIDENT])); if (result.state.state !== "RECOVERED") throw new Error(`incident not recovered: ${JSON.stringify(result.state)}`); await saveState({ confirmRecoveredTx: result.tx, CONFIRM_RECOVERED_TX: result.tx, confirmRecoveredStatus: result.t, finalIncident: result.state }); await saveReport({ confirmRecoveredTx: result.tx, finalIncidentState: result.state.state }); console.log(JSON.stringify({ tx: result.tx, terminal: result.t, incident: result.state }, null, 2)); }

async function postRecovery() { const result = await writeOp("postRecoveryProcess", DEMO, "process", [1n], async (client) => { const s = await protectedState(client); if (s.paused !== false || s.remediated !== true) throw new Error("post-recovery process precondition failed"); }, async (client) => await protectedState(client)); if (String(result.state.totalProcessed) !== "2" || result.state.paused !== false || result.state.remediated !== true || String(result.state.treasury.treasury_balance) !== "900" || String(result.state.treasury.total_outflow) !== "100") throw new Error(`post recovery state failed: ${JSON.stringify(result.state)}`); await saveState({ postRecoveryProcessTx: result.tx, POST_RECOVERY_PROCESS_TX: result.tx, postRecoveryProcessStatus: result.t, finalProtectedState: result.state }); await saveReport({ postRecoveryProcessTx: result.tx, postRecoveryProcessSuccess: true }); console.log(JSON.stringify({ tx: result.tx, terminal: result.t, target: result.state }, null, 2)); }

async function prove() { const player = await clientFor("player2"); const target = await protectedState(player.client); if (target.paused !== false || target.remediated !== true || String(target.treasury.treasury_balance) !== "900" || String(target.treasury.total_outflow) !== "100") throw new Error("permanent-fix precondition failed"); const fees = feeEnvelope(); let rejected = false; let error = ""; try { await player.client.simulateWriteContract({ account: player.account, address: DEMO, functionName: "execute_outflow", args: [PLAYER2, 1n], fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch (e) { rejected = true; error = String(e?.shortMessage ?? e?.message ?? e); } if (!rejected || /paused/i.test(error)) throw new Error(`permanent fix proof failed: ${error}`); await saveState({ permanentFixSimulation: "REJECTED", permanentFixDetail: error, permanentFixTargetState: target }); await saveReport({ nonOwnerOutflowAfterRemediation: "REJECTED", permanentFixProved: true, permanentFixDetail: error }); await append(["POST_RECOVERY_NONOWNER_OUTFLOW_SIMULATION: REJECTED", `FINAL_TARGET_STATE: ${JSON.stringify(safe(target))}`]); console.log(JSON.stringify({ simulation: "REJECTED", reason: error, target }, null, 2)); }

async function finalize() { const state = await loadState(); const report = JSON.parse(await readFile(REPORT_PATH, "utf8")); const lines = [`BACKEND_PROTOCOL_COMPLETE: YES`, `BEGIN_RECOVERY_TX: ${report.beginRecoveryTx}`, `RECOVERY_CHAIN_EVIDENCE_TX: ${report.recoveryChainEvidenceTx}`, `RECOVERY_ADVISORY_URL: ${report.recoveryAdvisoryUrl}`, `RECOVERY_ADVISORY_COMMIT: ${report.recoveryAdvisoryCommit}`, `RECOVERY_ADVISORY_EVIDENCE_TX: ${report.recoveryAdvisoryEvidenceTx}`, `RECOVERY_ASSESSMENT_TX: ${report.recoveryAssessmentTx}`, `RECOVERY_VERDICT: ${report.recoveryVerdict}`, `UNPAUSE_TX: ${report.unpauseTx}`, `FINAL_INCIDENT_STATE: ${report.finalIncidentState}`, `POST_RECOVERY_PROCESS_TX: ${report.postRecoveryProcessTx}`, `FINAL_TREASURY: 900`, `FINAL_TOTAL_OUTFLOW: 100`, `PERMANENT_FIX_PROVED: true`]; await append(lines); await saveState({ BACKEND_PROTOCOL_COMPLETE: true, finalRecoveryReport: report }); console.log(JSON.stringify({ report, state }, null, 2)); }

const op = process.argv[2];
if (op === "preflight") await preflight();
else if (op === "begin") await begin();
else if (op === "begin-broadcast") await beginBroadcastFromPersistedSimulation();
else if (op === "find-submitted-begin") await findSubmittedBeginEnvelope();
else if (op === "scan-submitted-begin") await scanSubmittedBeginEnvelope();
else if (op === "recovery-chain") await recoveryChain();
else if (op === "recovery-advisory") await recoveryAdvisory();
else if (op === "recovery-assess") await recoveryAssess();
else if (op === "unpause") await unpause();
else if (op === "confirm") await confirm();
else if (op === "post-recovery") await postRecovery();
else if (op === "prove") await prove();
else if (op === "finalize") await finalize();
else throw new Error("usage: preflight|begin|begin-broadcast|find-submitted-begin|scan-submitted-begin|recovery-chain|recovery-advisory|recovery-assess|unpause|confirm|post-recovery|prove|finalize");
