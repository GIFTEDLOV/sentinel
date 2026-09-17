import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const SENTINEL = "0xCdd1e472AFD0EE301C1981a6abe1208f55B730f5";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const DIR = `${ROOT}/deploy/evidence/migration-smoke-regression-fix`;
const STATE_PATH = `${DIR}/FINAL_RUN_STATE.json`;
const JOURNAL_PATH = `${DIR}/FINAL_TRANSACTION_JOURNAL.json`;
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";

const safe = (value) => JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
const lower = (value) => String(value ?? "").toLowerCase();
const shaBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const first = (value, names) => { for (const name of names) if (value && value[name] !== undefined && value[name] !== null) return value[name]; return null; };

async function loadSdk() {
  const source = await readFile(BUNDLE, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${BUNDLE.replaceAll("\\", "/")}`).href;
  transformed = transformed
    .replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`)
    .replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction, isSuccessful, abi };")
    .replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};")
    .replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    return `${prefix}${quote}${builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const sdk = await loadSdk();
let state = JSON.parse(await readFile(STATE_PATH, "utf8"));
let journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8"));

async function persist() {
  await writeFile(JOURNAL_PATH, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
  await writeFile(STATE_PATH, JSON.stringify(safe(state), null, 2) + "\n", "utf8");
}

async function clientFor(alias) {
  const action = new sdk.BaseAction();
  action.accountOverride = alias;
  const account = await action.getAccount(false);
  const client = sdk.createClient2({
    chain: { ...sdk.studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } },
    endpoint: RPC,
    account,
  });
  await client.initializeConsensusSmartContract();
  return { account, client };
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args, jsonSafeReturn: true });
}

async function preflight(client, account) {
  const [chainId, latest, pending] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = { chainId: Number.parseInt(chainId, 16), account: account.address, latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== OWNER || result.latestNonce !== result.pendingNonce) throw new Error(`owner preflight failed ${JSON.stringify(result)}`);
  return result;
}

function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status", "consensus"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult", "execution"]),
  };
}

async function reconcile(client, hash, label) {
  const decision = await client.waitForDecision({ hash, interval: 5000, retries: 120, fullTransaction: true });
  const final = await client.waitForFinalization({ hash, interval: 5000, retries: 120, fullTransaction: true });
  const finalTerminal = terminal(final);
  if (!sdk.isSuccessful(final)) throw new Error(`${label} finalized unsuccessfully ${JSON.stringify(safe(finalTerminal))}`);
  return { decision: terminal(decision), final: finalTerminal, receipt: safe(final) };
}

async function bind({ label, evidenceId, evidenceType, sourceUrl, digest, txHash, txBlock, txInput }) {
  const { account, client } = await clientFor("beacon-final-deployer");
  const incident = await read(client, SENTINEL, "get_incident", [state.incidentId]);
  const protocol = await read(client, SENTINEL, "get_protocol", [incident.protocol_id]);
  if (incident.state !== "ASSESSING" || protocol.policy_locked !== true || Number(protocol.minimum_sources) !== 2 || Number(protocol.max_evidence_age_seconds) !== 3600) throw new Error(`${label} precondition mismatch ${JSON.stringify(safe({ incident, protocol }))}`);
  const existing = [...journal.entries].reverse().find((entry) => entry.label === label && entry.txHash && entry.phase === "FINALIZED_DECIDED_EXECUTION_VERIFIED_STATE_VERIFIED");
  if (existing) {
    const terminalResult = await reconcile(client, existing.txHash, `${label} same-hash reconciliation`);
    const evidence = await read(client, SENTINEL, "get_evidence", [evidenceId]);
    return { tx: existing.txHash, evidence, terminal: terminalResult };
  }
  const before = await preflight(client, account);
  const args = [state.incidentId, evidenceId, "EMERGENCY", evidenceType, sourceUrl, "unauthorized-drain", digest, txHash, BigInt(txBlock), txInput];
  const feeEnvelope = await client.estimateTransactionFeesForWrite({ account, address: SENTINEL, functionName: "bind_evidence", args, appealRounds: 1n, rotations: [0n, 0n] });
  const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees: feeEnvelope, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const beforeBroadcast = await preflight(client, account);
  if (beforeBroadcast.latestNonce !== before.latestNonce) throw new Error(`${label} nonce changed before broadcast`);
  let tx;
  try {
    tx = await client.writeContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees: feeEnvelope });
  } catch (error) {
    const possibleHash = String(error?.message ?? error).match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null;
    journal.entries.push(safe({ label, txHash: possibleHash, nonce: beforeBroadcast.latestNonce, args, fees: feeEnvelope, simulation, broadcastCount: 1, ambiguousHash: possibleHash, submissionError: String(error) }));
    await persist();
    throw new Error(`${label} submission failed; refusing retry`);
  }
  journal.entries.push(safe({ label, txHash: tx, nonce: beforeBroadcast.latestNonce, args, fees: feeEnvelope, feeMethod: "current genlayer-js estimateTransactionFeesForWrite", simulation, broadcastCount: 1, phase: "SUBMITTED" }));
  await persist();
  const terminalResult = await reconcile(client, tx, label);
  const evidence = await read(client, SENTINEL, "get_evidence", [evidenceId]);
  if (evidence.incident_id !== state.incidentId || evidence.phase !== "EMERGENCY" || evidence.evidence_type !== evidenceType || lower(evidence.source_domain) !== lower(new URL(sourceUrl).hostname) || String(evidence.transaction_hash).toLowerCase() !== txHash.toLowerCase()) throw new Error(`${label} readback mismatch ${JSON.stringify(safe(evidence))}`);
  journal.entries.push(safe({ label, txHash: tx, nonce: beforeBroadcast.latestNonce, terminal: terminalResult, postState: evidence, phase: "FINALIZED_DECIDED_EXECUTION_VERIFIED_STATE_VERIFIED" }));
  await persist();
  return { tx, evidence, terminal: terminalResult };
}

const { client: ownerClient } = await clientFor("beacon-final-deployer");
const incident = await read(ownerClient, SENTINEL, "get_incident", [state.incidentId]);
if (incident.state !== "ASSESSING") throw new Error(`current smoke is not awaiting emergency evidence: ${JSON.stringify(safe(incident))}`);
const chainEvidenceId = `chain-recent-${state.incidentId.slice("incident-".length)}`;
const advisoryEvidenceId = `advisory-recent-${state.incidentId.slice("incident-".length)}`;
const chain = await bind({ label: "BIND_RECENT_INCIDENT_CHAIN_EVIDENCE", evidenceId: chainEvidenceId, evidenceType: "CHAIN_TRANSACTION", sourceUrl: RPC, digest: state.outflowDigest, txHash: state.outflowTx, txBlock: 0, txInput: state.outflowInput });
state.recentChainEvidenceId = chainEvidenceId;
state.recentChainEvidenceTx = chain.tx;
state.recentChainEvidence = chain.evidence;
await persist();
const advisory = state.incidentAdvisory;
const raw = Buffer.from(await (await fetch(advisory.url, { cache: "no-store" })).arrayBuffer());
if (shaBytes(raw) !== advisory.digest) throw new Error("existing incident advisory raw digest mismatch; refusing bind");
const recentAdvisory = await bind({ label: "BIND_RECENT_INCIDENT_ADVISORY_EVIDENCE", evidenceId: advisoryEvidenceId, evidenceType: "SECURITY_ADVISORY", sourceUrl: advisory.url, digest: advisory.digest, txHash: state.outflowTx, txBlock: 1, txInput: "" });
state.recentAdvisoryEvidenceId = advisoryEvidenceId;
state.recentAdvisoryEvidenceTx = recentAdvisory.tx;
state.recentAdvisoryEvidence = recentAdvisory.evidence;
state.recentEvidenceBoundAt = new Date().toISOString();
await persist();
console.log(JSON.stringify(safe({ state, journal: JOURNAL_PATH }), null, 2));
