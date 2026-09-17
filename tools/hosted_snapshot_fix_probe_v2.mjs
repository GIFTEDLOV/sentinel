import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { executionResultNumberToName, transactionsStatusNumberToName } from "genlayer-js/types";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const TARGET = "0x5Fb5C741d565dC79DaD9b01053aAb09d293bbaE4";
const PROTOCOL_ID = "sentinel-demo";
// This incident ID and its evidence already exist on the old smoke pair. The
// disposable contract is isolated, so this reuses public bytes without
// creating another production incident, outflow, or advisory.
const INCIDENT = "incident-9f85596208f3";
const FAILURE = "unauthorized-drain";
const DOMAINS = "studio-next.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const ADVISORY_URL = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-incident-9f85596208f3.json";
const OUTFLOW_TX = "0x9f85596208f3d40ce0a521f82b5ae9f24999a06e3a2da2aa880b6d0a4eb963e7";
const OUTFLOW_DIGEST = "040f71bfc2e7ebacb753180f705412490b516f227b43a567b06b66ad13e08b4c";
const OUTFLOW_INPUT = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg==";
const ADVISORY_DIGEST = "3d5a18ed36d5358983c6c28e58721e772621c8b85e55f4749c7e5903c8a0a6a4";
const SOURCE_PATH = `${ROOT}/contracts/sentinel.py`;
const JOURNAL_PATH = `${ROOT}/deployments/snapshot-fix-probe-v4.json`;

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function lower(value) { return String(value ?? "").toLowerCase(); }

function first(value, names) {
  for (const name of names) if (value && value[name] !== undefined && value[name] !== null) return value[name];
  return null;
}

function terminal(receipt) {
  const status = first(receipt, ["statusName", "status_name", "status"]);
  const execution = first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult", "execution"]);
  return {
    status: typeof status === "number" ? transactionsStatusNumberToName[String(status)] ?? String(status) : status,
    execution: typeof execution === "number" ? executionResultNumberToName[String(execution)] ?? String(execution) : execution,
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status", "consensus"]),
    contractAddress: first(receipt?.data, ["contract_address", "contractAddress"]) ?? first(receipt, ["contractAddress", "contract_address"]),
  };
}

function requireFinalSuccess(receipt, label) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" || !isSuccessful(receipt)) {
    throw new Error(`${label} final-success gate failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function loadSigningAccount() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  if (end < 0) throw new Error("GenLayer CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  // Windows Studio workspaces may deny chmod on the existing user config
  // directory. Preserve the existing keystore/config read path and ignore
  // only this non-semantic permission maintenance in the transformed module.
  transformed = transformed.replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};");
  transformed = transformed.replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    const resolved = builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec)}`).href;
    return `${prefix}${quote}${resolved}${close}`;
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

async function preflight(client, account, label) {
  const [chainId, balance, latest, pending] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = { label, rpc: RPC, chainId: Number.parseInt(chainId, 16), account: account.address, balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== OWNER || result.latestNonce !== result.pendingNonce) throw new Error(`${label} preflight failed: ${JSON.stringify(result)}`);
  return result;
}

function roundtrip(functionName, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) throw new Error(`${functionName} calldata roundtrip failed`);
  return { functionName, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: safe(decoded) };
}

async function saveJournal(journal) {
  await mkdir(`${ROOT}/deployments`, { recursive: true });
  await writeFile(JOURNAL_PATH, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
}

async function waitForFinalization(client, hash, label, journal) {
  try {
    return await client.waitForFinalization({ hash, interval: 5000, retries: 120, fullTransaction: true });
  } catch (error) {
    journal.status = "BLOCKED_PENDING_RECONCILIATION";
    journal.blocker = `${label} finalization polling failed; same hash preserved`;
    await saveJournal(journal);
    throw error;
  }
}

async function readContract(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, jsonSafeReturn: true });
}

async function writeOnce({ client, account, journal, label, address, functionName, args, readback }) {
  const before = await preflight(client, account, `${label} preflight`);
  const fees = await client.estimateTransactionFeesForWrite({ account, address, functionName, args, appealRounds: 1n, rotations: [0n, 0n] });
  if (BigInt(fees.feeValue) <= 0n) throw new Error(`${label} fee quote is zero`);
  const simulation = await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const immediate = await preflight(client, account, `${label} immediate preflight`);
  if (immediate.latestNonce !== before.latestNonce) throw new Error(`${label} nonce changed before broadcast`);
  let tx;
  try {
    tx = await client.writeContract({ account, address, functionName, args, fees });
  } catch (error) {
    const possibleHash = String(error?.message ?? error).match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null;
    journal.status = possibleHash ? "BLOCKED_PENDING_RECONCILIATION" : "PREPARED";
    journal.entries.push({ label, possibleHash, nonce: immediate.latestNonce, fees: safe(fees), error: String(error) });
    await saveJournal(journal);
    throw error;
  }
  journal.status = "BROADCAST";
  journal.entries.push({ label, txHash: tx, nonce: immediate.latestNonce, fees: safe(fees), simulation: safe(simulation), calldata: roundtrip(functionName, args), broadcastCount: 1 });
  await saveJournal(journal);
  console.log(JSON.stringify({ broadcast: label, txHash: tx, nonce: immediate.latestNonce }));
  const receipt = await waitForFinalization(client, tx, label, journal);
  const final = requireFinalSuccess(receipt, label);
  const state = readback ? await readback() : null;
  journal.status = "FINALIZED_SUCCESS";
  journal.entries[journal.entries.length - 1].terminal = final;
  journal.entries[journal.entries.length - 1].postState = safe(state);
  await saveJournal(journal);
  return { tx, receipt, final, fees, simulation, state };
}

const source = await readFile(SOURCE_PATH, "utf8");
const sourceSha = createHash("sha256").update(source).digest("hex").toUpperCase();
const account = await loadSigningAccount();
const client = createClient({ chain: makeChain(), endpoint: RPC, account });
const journal = { status: "PREPARED", network: "GenLayer Studio Next", rpc: RPC, chainId: CHAIN_ID, sourceSha256: sourceSha, account: account.address, incident: INCIDENT, target: TARGET, reusedEvidence: true, newOutflow: false, newAdvisory: false, txHash: null, contractAddress: null, entries: [], createdAt: new Date().toISOString() };
await saveJournal(journal);

const before = await preflight(client, account, "snapshot probe deployment");
const sourceSchema = await client.request({ method: "gen_getContractSchemaForCode", params: [source] });
const expected = ["register_protected_protocol", "lock_emergency_policy", "open_incident", "bind_evidence", "assess_incident", "get_protocol", "get_incident", "get_evidence", "get_state"];
for (const name of expected) if (!sourceSchema?.methods?.[name]) throw new Error(`hosted schema missing ${name}`);
const deployFees = await client.estimateTransactionFees({ account, appealRounds: 1n, rotations: [0n, 0n] });
if (BigInt(deployFees.feeValue) <= 0n) throw new Error("deployment fee quote is zero");
journal.preflight = before;
journal.feeMethod = "current genlayer-js network-default estimateTransactionFees";
journal.deploymentFeeQuote = safe(deployFees);
journal.sourceSchemaMethods = Object.keys(sourceSchema.methods).sort();
await saveJournal(journal);

const deploymentTx = await client.deployContract({ account, code: source, args: [], fees: deployFees });
journal.status = "BROADCAST";
journal.txHash = deploymentTx;
journal.entries.push({ label: "snapshot fix disposable deployment", txHash: deploymentTx, nonce: before.latestNonce, fees: safe(deployFees), broadcastCount: 1 });
await saveJournal(journal);
console.log(JSON.stringify({ broadcast: "snapshot fix disposable deployment", txHash: deploymentTx, nonce: before.latestNonce }));
const deploymentReceipt = await waitForFinalization(client, deploymentTx, "snapshot fix disposable deployment", journal);
const deploymentFinal = requireFinalSuccess(deploymentReceipt, "snapshot fix disposable deployment");
const probeAddress = first(deploymentReceipt?.data, ["contract_address", "contractAddress"]) ?? first(deploymentReceipt, ["contractAddress", "contract_address"]);
if (!probeAddress) throw new Error("finalized deployment did not expose a contract address");
journal.contractAddress = probeAddress;
journal.deployment = { txHash: deploymentTx, terminal: deploymentFinal };
const deployedCodeBase64 = await client.request({ method: "gen_getContractCode", params: [probeAddress] });
const deployedCode = Buffer.from(deployedCodeBase64, "base64");
journal.materialization = { bytes: deployedCode.length, sha256: createHash("sha256").update(deployedCode).digest("hex").toUpperCase(), exactSourceMatch: deployedCode.toString("utf8") === source };
if (!journal.materialization.exactSourceMatch || journal.materialization.sha256 !== sourceSha) throw new Error(`deployed source mismatch: ${JSON.stringify(journal.materialization)}`);
journal.deployedSchemaMethods = Object.keys((await client.request({ method: "gen_getContractSchema", params: [probeAddress] })).methods ?? {}).sort();
await saveJournal(journal);

const registerArgs = [PROTOCOL_ID, TARGET, FAILURE, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n];
await writeOnce({ client, account, journal, label: "probe register policy", address: probeAddress, functionName: "register_protected_protocol", args: registerArgs, readback: () => readContract(client, probeAddress, "get_protocol", [PROTOCOL_ID]) });
await writeOnce({ client, account, journal, label: "probe lock policy", address: probeAddress, functionName: "lock_emergency_policy", args: [PROTOCOL_ID], readback: () => readContract(client, probeAddress, "get_protocol", [PROTOCOL_ID]) });
await writeOnce({ client, account, journal, label: "probe open isolated incident", address: probeAddress, functionName: "open_incident", args: [INCIDENT, PROTOCOL_ID], readback: () => readContract(client, probeAddress, "get_incident", [INCIDENT]) });
const chainId = `chain-${OUTFLOW_TX.slice(2, 14)}`;
const advisoryId = `advisory-${OUTFLOW_TX.slice(2, 14)}`;
await writeOnce({ client, account, journal, label: "probe bind reused chain evidence", address: probeAddress, functionName: "bind_evidence", args: [INCIDENT, chainId, "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, OUTFLOW_DIGEST, OUTFLOW_TX, 0n, OUTFLOW_INPUT], readback: () => readContract(client, probeAddress, "get_evidence", [chainId]) });
await writeOnce({ client, account, journal, label: "probe bind reused advisory evidence", address: probeAddress, functionName: "bind_evidence", args: [INCIDENT, advisoryId, "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, ADVISORY_DIGEST, OUTFLOW_TX, 1n, ""], readback: () => readContract(client, probeAddress, "get_evidence", [advisoryId]) });

const incident = await readContract(client, probeAddress, "get_incident", [INCIDENT]);
const protocol = await readContract(client, probeAddress, "get_protocol", [PROTOCOL_ID]);
const evidence = await Promise.all([chainId, advisoryId].map((id) => readContract(client, probeAddress, "get_evidence", [id])));
const authenticated = evidence.filter((item) => item.authenticated_status === "VALID");
const observationNow = Math.max(...evidence.map((item) => Number(item.observed_at)));
const fresh = authenticated.filter((item) => observationNow - Number(item.observed_at) <= Number(protocol.max_evidence_age_seconds));
const distinct = [...new Set(fresh.map((item) => item.source_domain))];
journal.snapshotCounts = { bound: evidence.length, authenticated: authenticated.length, fresh: fresh.length, distinct: distinct.length };
journal.snapshotReadback = { incident, protocol, evidence, observationNow, distinctSources: distinct };
if (journal.snapshotCounts.bound !== 2 || journal.snapshotCounts.authenticated !== 2 || journal.snapshotCounts.fresh !== 2 || journal.snapshotCounts.distinct !== 2) throw new Error(`snapshot count gate failed: ${JSON.stringify(journal.snapshotCounts)}`);

const assessmentFees = await client.estimateTransactionFeesForWrite({ account, address: probeAddress, functionName: "assess_incident", args: [INCIDENT], appealRounds: 1n, rotations: [0n, 0n] });
const assessmentSimulation = await client.simulateWriteContract({ account, address: probeAddress, functionName: "assess_incident", args: [INCIDENT], fees: assessmentFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
journal.assessmentSimulation = { fees: safe(assessmentFees), receipt: safe(assessmentSimulation), nondeterministicTrace: safe(assessmentSimulation?.receipt ?? assessmentSimulation) };
await saveJournal(journal);
console.log(JSON.stringify({ snapshotCounts: journal.snapshotCounts, assessmentSimulation: journal.assessmentSimulation }, null, 2));

const assessment = await writeOnce({ client, account, journal, label: "probe assess incident", address: probeAddress, functionName: "assess_incident", args: [INCIDENT], readback: () => readContract(client, probeAddress, "get_incident", [INCIDENT]) });
if (assessment.state?.state !== "ACTIVE_INCIDENT" || assessment.state?.incident_verdict !== "ACTIVE_INCIDENT") throw new Error(`hosted verdict gate failed: ${JSON.stringify(assessment.state)}`);
journal.status = "PROBE_VERIFIED";
journal.hostedVerdict = assessment.state;
journal.broadcastSummary = { deployments: 1, incidents: 0, outflows: 0, advisories: 0, assessmentBroadcasts: 1 };
await saveJournal(journal);
console.log(JSON.stringify({ status: journal.status, probeAddress, deploymentTx, assessmentTx: assessment.tx, snapshotCounts: journal.snapshotCounts, hostedVerdict: assessment.state }, null, 2));
