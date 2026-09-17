import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFile, readFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ACTOR = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const DEMO = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584";
const SENTINEL = "0x2dF0E12D4CE46f0312B7461972351F3cD074b3c9";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const FRESH_INCIDENT_ID = "incident-e25b16a662";
const FRESH_OUTFLOW_TX = "0xe25b16a6628d55e2b3325be4dcad6073c422f4227990e605146c9211e6d1325e";
const FRESH_CHAIN_DIGEST = "81783f615c01f9b4356d5a349cacd65602d7d268819ba671ce62d834a71561b1";
const FRESH_CHAIN_INPUT = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTiRAw==";
const FRESH_OUTFLOW_OBSERVED_AT = 1789325441n;
const FRESH_ADVISORY_ID = "advisory-e25b16a662";
const FRESH_ADVISORY_URL = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-e25b16a662.json";
const FRESH_ADVISORY_FILE = ROOT + "/evidence/advisories/incident-e25b16a662.json";
const FRESH_ADVISORY_DIGEST = "c7d3d0bf4b58a7531b8baa71e9099f97149bc5e97c25adbaffc2e0410781d0cf";
const OUTFLOW_TX = "0x254762469ce4095a74f4449691ccc2ea8af2beab41a35ef5d311a5fafc5f9202";
const INCIDENT_ID = "incident-254762469c";
const CHAIN_DIGEST = "b16be533da155338b201ebd944059ce8d5f40e89d6aa57f8cf08bfb8b6896132";
const CHAIN_INPUT = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg==";
const ADVISORY_URL = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-254762469c.json";
const ADVISORY_FILE = ROOT + "/evidence/advisories/incident-254762469c.json";
const EVIDENCE = ROOT + "/deploy/evidence/final/FINAL_INCIDENT_LIFECYCLE.txt";
const PROFILE = ROOT + "/deploy/fee-profile.json";
const SENTINEL_SHA = "17B170A8394EDD250536937898EFF1FFD30AE8E90258E7578B8DD00E5FE1BD7D";
const DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL("file://" + bundlePath).href;
  transformed = transformed.replaceAll("import.meta.url", "new URL(" + JSON.stringify(bundleUrl) + ").href");
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction, encode4, makeCalldataObject, serialize };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "module", "net", "os", "path", "process", "stream", "string_decoder", "tty", "url", "util", "zlib"]);
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

function terminal(receipt) {
  return {
    status: receipt.statusName ?? receipt.status_name ?? receipt.status ?? null,
    consensus: receipt.resultName ?? receipt.result_name ?? receipt.consensusStatus ?? receipt.consensus_status ?? null,
    execution: receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? receipt.txExecutionResult ?? null,
  };
}

function requireSuccess(receipt, label) {
  const result = terminal(receipt);
  const status = String(result.status).toUpperCase();
  const consensus = String(result.consensus).toUpperCase();
  const execution = String(result.execution).toUpperCase();
  if (status !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(consensus) || execution !== "FINISHED_WITH_RETURN") {
    throw new Error(label + " terminal-success gate failed: " + JSON.stringify(result));
  }
  return result;
}

function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(method + " calldata roundtrip failed");
  }
  return {
    method,
    encoded: "0x" + Buffer.from(encoded).toString("hex"),
    decoded: decoded.map((value) => typeof value === "bigint" ? value.toString() : value),
  };
}

async function append(lines) {
  await appendFile(EVIDENCE, lines.join("\n") + "\n", "utf8");
}

async function read(client, address, method, args = []) {
  return client.readContract({ address, functionName: method, args, jsonSafeReturn: true });
}

async function hashes() {
  const sentinel = createHash("sha256").update(await readFile(ROOT + "/contracts/sentinel.py")).digest("hex").toUpperCase();
  const demo = createHash("sha256").update(await readFile(ROOT + "/contracts/protected_demo.py")).digest("hex").toUpperCase();
  if (sentinel !== SENTINEL_SHA || demo !== DEMO_SHA) throw new Error("frozen source hash gate failed");
  return { sentinel, demo };
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
    unknownPendingTransactions: "eth_pendingTransactions unsupported; latest==pending is the available gate",
  };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== lower(expected) || result.latestNonce !== result.pendingNonce) {
    throw new Error("account/network/nonce preflight failed: " + JSON.stringify(result));
  }
  return result;
}

async function policy(client) {
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("locked policy mismatch");
  return actual;
}

async function runWrite({ label, method, args, beforeCheck, afterCheck }) {
  const sourceHashes = await hashes();
  const { account, client } = await makeClient("beacon-final-deployer");
  const lockedPolicy = await policy(client);
  const before = await beforeCheck({ client, account, policy: lockedPolicy });
  const pre = await preflight(client, account, OWNER);
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  if (profile.chainId !== CHAIN_ID || !profile.deploy) throw new Error("invalid current fee profile");
  const feeOptions = feesFromProfile(profile.deploy);
  const calldata = calldataRoundtrip(method, args);
  const fees = await client.estimateTransactionFeesForWrite({ account, address: SENTINEL, functionName: method, args, ...feeOptions });
  if (BigInt(fees.feeValue) <= 0n) throw new Error(label + " fee quote is zero");
  if (BigInt(pre.balanceWei) < BigInt(fees.feeValue)) throw new Error(label + " owner balance is below quoted fee");
  const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: method, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  console.log(JSON.stringify({ event: label.toUpperCase() + "_PREFLIGHT", sourceHashes, policy: lockedPolicy, before: safe(before), preflight: pre, calldata, fees: safe(fees), simulation: terminal(simulation.receipt || {}) }, null, 2));
  const beforeBroadcast = await preflight(client, account, OWNER);
  const tx = await client.writeContract({ account, address: SENTINEL, functionName: method, args, fees });
  console.log(JSON.stringify({ event: label.toUpperCase() + "_BROADCAST_RETURNED", tx }));
  await append([
    "STEP: " + label,
    "SOURCE_HASHES: " + JSON.stringify(sourceHashes),
    "ACCOUNT: " + account.address,
    "PREFLIGHT: " + JSON.stringify(beforeBroadcast),
    "CALLDATA: " + JSON.stringify(calldata),
    "FEES: " + JSON.stringify(safe(fees)),
    "SIMULATION: " + JSON.stringify(terminal(simulation.receipt || {})),
    "TX: " + tx,
    "BROADCAST_COUNT: 1",
  ]);
  const receipt = await client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const final = requireSuccess(receipt, label);
  const after = await afterCheck({ client, account, before, final, tx });
  await append([
    "FINAL_STATUS: " + final.status,
    "CONSENSUS: " + final.consensus,
    "EXECUTION: " + final.execution,
    "STATE_AFTER: " + JSON.stringify(safe(after)),
  ]);
  console.log(JSON.stringify({ event: label.toUpperCase() + "_FINALIZED", tx, final, after: safe(after) }, null, 2));
  return { tx, final, after, fees: safe(fees), calldata, pre: beforeBroadcast };
}

function expectedIncident(incident) {
  if (incident.protocol_id !== PROTOCOL_ID || incident.state !== "ASSESSING") throw new Error("incident is not in ASSESSING state: " + JSON.stringify(safe(incident)));
  return incident;
}

const op = process.argv[2];
if (!op) throw new Error("usage: node tools/run_incident_continuation.mjs <bind-chain|bind-fresh-chain|bind-fresh-advisory|bind-advisory|debug-advisory-sim|assess|pause|confirm|post-check|read-state>");

if (op === "bind-chain") {
  const result = await runWrite({
    label: "chain_evidence_bind",
    method: "bind_evidence",
    args: [INCIDENT_ID, "chain-254762469c", "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, CHAIN_DIGEST, OUTFLOW_TX, 0n, CHAIN_INPUT],
    beforeCheck: async ({ client }) => expectedIncident(await read(client, SENTINEL, "get_incident", [INCIDENT_ID])),
    afterCheck: async ({ client }) => {
      const evidence = await read(client, SENTINEL, "get_evidence", ["chain-254762469c"]);
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      if (evidence.phase !== "EMERGENCY" || evidence.evidence_type !== "CHAIN_TRANSACTION" || evidence.transaction_hash !== OUTFLOW_TX.toLowerCase() || incident.evidence_ids_csv !== "chain-254762469c") throw new Error("chain evidence readback mismatch: " + JSON.stringify(safe({ evidence, incident })));
      return { evidence, incident };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "bind-fresh-chain") {
  const result = await runWrite({
    label: "fresh_chain_evidence_bind",
    method: "bind_evidence",
    args: [FRESH_INCIDENT_ID, "chain-e25b16a662", "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, FRESH_CHAIN_DIGEST, FRESH_OUTFLOW_TX, 0n, FRESH_CHAIN_INPUT],
    beforeCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [FRESH_INCIDENT_ID]);
      if (incident.protocol_id !== PROTOCOL_ID || incident.state !== "ASSESSING" || incident.evidence_ids_csv !== "") throw new Error("fresh incident is not ready for chain evidence: " + JSON.stringify(safe(incident)));
      return incident;
    },
    afterCheck: async ({ client }) => {
      const evidence = await read(client, SENTINEL, "get_evidence", ["chain-e25b16a662"]);
      const incident = await read(client, SENTINEL, "get_incident", [FRESH_INCIDENT_ID]);
      if (evidence.phase !== "EMERGENCY" || evidence.evidence_type !== "CHAIN_TRANSACTION" || evidence.transaction_hash !== FRESH_OUTFLOW_TX.toLowerCase() || BigInt(evidence.observed_at) <= 0n || incident.evidence_ids_csv !== "chain-e25b16a662") throw new Error("fresh chain evidence readback mismatch: " + JSON.stringify(safe({ evidence, incident })));
      return { evidence, incident };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "bind-advisory") {
  const advisory = JSON.parse(await readFile(ADVISORY_FILE, "utf8"));
  const result = await runWrite({
    label: "advisory_evidence_bind",
    method: "bind_evidence",
    args: [INCIDENT_ID, "advisory-254762469c", "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, createHash("sha256").update(await readFile(ADVISORY_FILE)).digest("hex"), OUTFLOW_TX, 1n, ""],
    beforeCheck: async ({ client }) => expectedIncident(await read(client, SENTINEL, "get_incident", [INCIDENT_ID])),
    afterCheck: async ({ client }) => {
      const evidence = await read(client, SENTINEL, "get_evidence", ["advisory-254762469c"]);
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      if (evidence.phase !== "EMERGENCY" || evidence.evidence_type !== "SECURITY_ADVISORY" || evidence.transaction_hash !== OUTFLOW_TX.toLowerCase() || incident.source_domains_csv !== "studio-dev.genlayer.com,raw.githubusercontent.com") throw new Error("advisory evidence readback mismatch: " + JSON.stringify(safe({ evidence, incident })));
      return { evidence, incident };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "bind-fresh-advisory") {
  const result = await runWrite({
    label: "fresh_advisory_evidence_bind",
    method: "bind_evidence",
    args: [FRESH_INCIDENT_ID, FRESH_ADVISORY_ID, "EMERGENCY", "SECURITY_ADVISORY", FRESH_ADVISORY_URL, FAILURE, FRESH_ADVISORY_DIGEST, FRESH_OUTFLOW_TX, 1n, ""],
    beforeCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [FRESH_INCIDENT_ID]);
      if (incident.protocol_id !== PROTOCOL_ID || incident.state !== "ASSESSING" || incident.evidence_ids_csv !== "chain-e25b16a662" || incident.source_domains_csv !== "studio-dev.genlayer.com") throw new Error("fresh incident is not ready for advisory evidence: " + JSON.stringify(safe(incident)));
      return incident;
    },
    afterCheck: async ({ client }) => {
      const evidence = await read(client, SENTINEL, "get_evidence", [FRESH_ADVISORY_ID]);
      const incident = await read(client, SENTINEL, "get_incident", [FRESH_INCIDENT_ID]);
      if (evidence.phase !== "EMERGENCY" || evidence.evidence_type !== "SECURITY_ADVISORY" || evidence.transaction_hash !== FRESH_OUTFLOW_TX.toLowerCase() || evidence.content_digest !== FRESH_ADVISORY_DIGEST || BigInt(evidence.observed_at) <= 0n || incident.source_domains_csv !== "studio-dev.genlayer.com,raw.githubusercontent.com") throw new Error("fresh advisory evidence readback mismatch: " + JSON.stringify(safe({ evidence, incident })));
      return { evidence, incident };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "debug-fresh-advisory-sim") {
  const { account, client } = await makeClient("beacon-final-deployer");
  const args = [FRESH_INCIDENT_ID, FRESH_ADVISORY_ID, "EMERGENCY", "SECURITY_ADVISORY", FRESH_ADVISORY_URL, FAILURE, FRESH_ADVISORY_DIGEST, FRESH_OUTFLOW_TX, 1n, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  try {
    const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees: feesFromProfile(profile.deploy), includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
    console.log(JSON.stringify({ simulation: "ACCEPTED", receipt: terminal(simulation.receipt || {}) }));
  } catch (error) {
    console.log(JSON.stringify({ simulation: "REJECTED", name: error?.name, code: error?.code, shortMessage: error?.shortMessage, message: String(error?.message || error).slice(0, 500), details: typeof error?.details === "string" ? error.details.slice(0, 500) : error?.details }));
  }
} else if (op === "debug-fresh-advisory-sim-live") {
  const { account, client } = await makeClient("beacon-final-deployer");
  const args = [FRESH_INCIDENT_ID, FRESH_ADVISORY_ID, "EMERGENCY", "SECURITY_ADVISORY", FRESH_ADVISORY_URL, FAILURE, FRESH_ADVISORY_DIGEST, FRESH_OUTFLOW_TX, 1n, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  let quotedFeeValue = null;
  try {
    const fees = await client.estimateTransactionFeesForWrite({ account, address: SENTINEL, functionName: "bind_evidence", args, ...feesFromProfile(profile.deploy) });
    quotedFeeValue = String(fees.feeValue);
    const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
    console.log(JSON.stringify({ simulation: "ACCEPTED", feeValue: String(fees.feeValue), receipt: terminal(simulation.receipt || {}) }));
  } catch (error) {
    console.log(JSON.stringify({ simulation: "REJECTED", feeValue: quotedFeeValue, name: error?.name, code: error?.code, shortMessage: error?.shortMessage, message: String(error?.message || error).slice(0, 500), details: typeof error?.details === "string" ? error.details.slice(0, 500) : error?.details }));
  }
} else if (op === "assess") {
  const result = await runWrite({
    label: "incident_assessment",
    method: "assess_incident",
    args: [INCIDENT_ID],
    beforeCheck: async ({ client }) => expectedIncident(await read(client, SENTINEL, "get_incident", [INCIDENT_ID])),
    afterCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      if (incident.state !== "ACTIVE_INCIDENT" || incident.incident_verdict !== "ACTIVE_INCIDENT") throw new Error("incident assessment did not produce ACTIVE_INCIDENT: " + JSON.stringify(safe(incident)));
      return incident;
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "debug-advisory-sim") {
  const { account, client } = await makeClient("beacon-final-deployer");
  const advisory = JSON.parse(await readFile(ADVISORY_FILE, "utf8"));
  const txBlock = BigInt(process.argv[3] ?? "1");
  const args = [INCIDENT_ID, "advisory-254762469c", "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, createHash("sha256").update(await readFile(ADVISORY_FILE)).digest("hex"), OUTFLOW_TX, txBlock, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  try {
    const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees: feesFromProfile(profile.deploy), includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
    console.log(JSON.stringify({ simulation: terminal(simulation.receipt || {}) }));
  } catch (error) {
    console.log(JSON.stringify({ simulation: "REJECTED", name: error?.name, code: error?.code, shortMessage: error?.shortMessage, message: String(error?.message || error).slice(0, 500), details: typeof error?.details === "string" ? error.details.slice(0, 500) : error?.details }));
  }
} else if (op === "debug-advisory-sim-fee") {
  const { account, client } = await makeClient("beacon-final-deployer");
  const advisory = JSON.parse(await readFile(ADVISORY_FILE, "utf8"));
  const args = [INCIDENT_ID, "advisory-254762469c", "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, createHash("sha256").update(await readFile(ADVISORY_FILE)).digest("hex"), OUTFLOW_TX, 1n, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  const p = feesFromProfile(profile.deploy);
  const fees = { distribution: { leaderTimeunitsAllocation: p.leaderTimeunitsAllocation, validatorTimeunitsAllocation: p.validatorTimeunitsAllocation, appealRounds: p.appealRounds, executionBudgetPerRound: p.executionBudgetPerRound, executionConsumed: 0n, totalMessageFees: p.totalMessageFees, rotations: p.rotations, maxPriceGenPerTimeUnit: p.maxPriceGenPerTimeUnit, storageFeeMaxGasPrice: p.storageFeeMaxGasPrice, receiptFeeMaxGasPrice: p.receiptFeeMaxGasPrice }, messageAllocations: [], feeValue: BigInt(process.argv[3] ?? "1420101000126258") };
  try {
    const simulation = await client.simulateWriteContract({ account, address: SENTINEL, functionName: "bind_evidence", args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
    console.log(JSON.stringify({ simulation: "ACCEPTED", receipt: terminal(simulation.receipt || {}) }));
  } catch (error) {
    console.log(JSON.stringify({ simulation: "REJECTED", name: error?.name, code: error?.code, shortMessage: error?.shortMessage, message: String(error?.message || error).slice(0, 500), details: typeof error?.details === "string" ? error.details.slice(0, 500) : error?.details }));
  }
} else if (op === "debug-advisory-gencall") {
  const sdk = await loadSdk();
  const action = new sdk.BaseAction();
  action.accountOverride = "beacon-final-deployer";
  const account = await action.getAccount(false);
  const client = sdk.createClient2({ chain: sdk.studioDevnet, endpoint: RPC, account });
  const advisory = JSON.parse(await readFile(ADVISORY_FILE, "utf8"));
  const args = [INCIDENT_ID, "advisory-254762469c", "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, createHash("sha256").update(await readFile(ADVISORY_FILE)).digest("hex"), OUTFLOW_TX, 1n, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  const p = feesFromProfile(profile.deploy);
  const encodedData = [sdk.encode4(sdk.makeCalldataObject("bind_evidence", args, undefined)), false];
  const requestParams = { type: "write", to: SENTINEL, from: account.address, data: sdk.serialize(encodedData), transaction_hash_variant: "latest-nonfinal", fees: { distribution: { leaderTimeunitsAllocation: p.leaderTimeunitsAllocation.toString(), validatorTimeunitsAllocation: p.validatorTimeunitsAllocation.toString(), appealRounds: p.appealRounds.toString(), executionBudgetPerRound: p.executionBudgetPerRound.toString(), executionConsumed: "0", totalMessageFees: p.totalMessageFees.toString(), rotations: p.rotations.map((value) => value.toString()), maxPriceGenPerTimeUnit: p.maxPriceGenPerTimeUnit.toString(), storageFeeMaxGasPrice: p.storageFeeMaxGasPrice.toString(), receiptFeeMaxGasPrice: p.receiptFeeMaxGasPrice.toString() }, messageAllocations: [], feeValue: process.argv[3] ?? "1420101000126258" } };
  try {
    const raw = await client.request({ method: "gen_call", params: [requestParams] });
    const gr = raw?.genvm_result;
    console.log(JSON.stringify({ resultKeys: raw && typeof raw === "object" ? Object.keys(raw) : [], genvm_result: gr && typeof gr === "object" ? { stdout: gr.stdout, stderr: gr.stderr, error_code: gr.error_code, raw_error: gr.raw_error, error_description: gr.error_description } : null }));
  } catch (error) {
    console.log(JSON.stringify({ call: "REJECTED", name: error?.name, code: error?.code, shortMessage: error?.shortMessage, message: String(error?.message || error).slice(0, 500), details: typeof error?.details === "string" ? error.details.slice(0, 500) : error?.details }));
  }
} else if (op === "debug-advisory-raw-gencall") {
  const sdk = await loadSdk();
  const action = new sdk.BaseAction();
  action.accountOverride = "beacon-final-deployer";
  const account = await action.getAccount(false);
  const advisory = JSON.parse(await readFile(ADVISORY_FILE, "utf8"));
  const args = [INCIDENT_ID, "advisory-254762469c", "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, createHash("sha256").update(await readFile(ADVISORY_FILE)).digest("hex"), OUTFLOW_TX, 1n, ""];
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  const p = feesFromProfile(profile.deploy);
  const encodedData = [sdk.encode4(sdk.makeCalldataObject("bind_evidence", args, undefined)), false];
  const requestParams = { type: "write", to: SENTINEL, from: account.address, data: sdk.serialize(encodedData), transaction_hash_variant: "latest-nonfinal", fees: { distribution: { leaderTimeunitsAllocation: p.leaderTimeunitsAllocation.toString(), validatorTimeunitsAllocation: p.validatorTimeunitsAllocation.toString(), appealRounds: p.appealRounds.toString(), executionBudgetPerRound: p.executionBudgetPerRound.toString(), executionConsumed: "0", totalMessageFees: p.totalMessageFees.toString(), rotations: p.rotations.map((value) => value.toString()), maxPriceGenPerTimeUnit: p.maxPriceGenPerTimeUnit.toString(), storageFeeMaxGasPrice: p.storageFeeMaxGasPrice.toString(), receiptFeeMaxGasPrice: p.receiptFeeMaxGasPrice.toString() }, messageAllocations: [], feeValue: process.argv[3] ?? "1420101000126258" } };
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [requestParams] }) });
  const textBody = await response.text();
  let parsed;
  try { parsed = JSON.parse(textBody); } catch { parsed = null; }
  const result = parsed?.result;
  const diagnosticReceipt = parsed?.error?.data?.receipt;
  const gr = result?.genvm_result || diagnosticReceipt?.genvm_result;
  console.log(JSON.stringify({ http_status: response.status, top_keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [], rpc_error: parsed?.error ? { code: parsed.error.code, message: String(parsed.error.message || "").slice(0, 300), data_keys: parsed.error.data && typeof parsed.error.data === "object" ? Object.keys(parsed.error.data) : [], receipt_keys: diagnosticReceipt && typeof diagnosticReceipt === "object" ? Object.keys(diagnosticReceipt) : [] } : null, receipt_summary: diagnosticReceipt ? { execution_result: diagnosticReceipt.execution_result, result: diagnosticReceipt.result, gas_used: diagnosticReceipt.gas_used, vote: diagnosticReceipt.vote, eq_outputs_keys: diagnosticReceipt.eq_outputs && typeof diagnosticReceipt.eq_outputs === "object" ? Object.keys(diagnosticReceipt.eq_outputs) : [] } : null, result_keys: result && typeof result === "object" ? Object.keys(result) : [], genvm_result: gr && typeof gr === "object" ? { stdout: gr.stdout, stderr: gr.stderr, error_code: gr.error_code, raw_error: gr.raw_error, error_description: gr.error_description, data_fee_bucket_totals: gr.data_fee_bucket_totals, data_fees_remaining: gr.data_fees_remaining, data_fees_consumed: gr.data_fees_consumed } : null }));
} else if (op === "debug-fresh-advisory-raw-gencall") {
  const sdk = await loadSdk();
  const action = new sdk.BaseAction();
  action.accountOverride = "beacon-final-deployer";
  const account = await action.getAccount(false);
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  const p = feesFromProfile(profile.deploy);
  const args = [FRESH_INCIDENT_ID, FRESH_ADVISORY_ID, "EMERGENCY", "SECURITY_ADVISORY", FRESH_ADVISORY_DIGEST, FRESH_OUTFLOW_TX, 1n, ""];
  const encodedData = [sdk.encode4(sdk.makeCalldataObject("bind_evidence", args, undefined)), false];
  const feeValue = process.argv[3] ?? "0";
  const requestParams = { type: "write", to: SENTINEL, from: account.address, data: sdk.serialize(encodedData), transaction_hash_variant: "latest-nonfinal", fees: { distribution: { leaderTimeunitsAllocation: p.leaderTimeunitsAllocation.toString(), validatorTimeunitsAllocation: p.validatorTimeunitsAllocation.toString(), appealRounds: p.appealRounds.toString(), executionBudgetPerRound: p.executionBudgetPerRound.toString(), executionConsumed: "0", totalMessageFees: p.totalMessageFees.toString(), rotations: p.rotations.map((value) => value.toString()), maxPriceGenPerTimeUnit: p.maxPriceGenPerTimeUnit.toString(), storageFeeMaxGasPrice: p.storageFeeMaxGasPrice.toString(), receiptFeeMaxGasPrice: p.receiptFeeMaxGasPrice.toString() }, messageAllocations: [], feeValue } };
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [requestParams] }) });
  const textBody = await response.text();
  let parsed;
  try { parsed = JSON.parse(textBody); } catch { parsed = null; }
  const result = parsed?.result;
  const diagnosticReceipt = parsed?.error?.data?.receipt;
  const gr = result?.genvm_result || diagnosticReceipt?.genvm_result;
  console.log(JSON.stringify({ http_status: response.status, top_keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [], rpc_error: parsed?.error ? { code: parsed.error.code, message: String(parsed.error.message || "").slice(0, 300), data_keys: parsed.error.data && typeof parsed.error.data === "object" ? Object.keys(parsed.error.data) : [], receipt_keys: diagnosticReceipt && typeof diagnosticReceipt === "object" ? Object.keys(diagnosticReceipt) : [] } : null, result_type: result === null ? "null" : typeof result, result_keys: result && typeof result === "object" ? Object.keys(result) : [], receipt_summary: diagnosticReceipt ? { execution_result: diagnosticReceipt.execution_result, result: diagnosticReceipt.result, gas_used: diagnosticReceipt.gas_used } : null, genvm_result: gr && typeof gr === "object" ? { stdout: gr.stdout, stderr: gr.stderr, error_code: gr.error_code, raw_error: gr.raw_error, error_description: gr.error_description } : null }));
} else if (op === "pause") {
  const result = await runWrite({
    label: "pause_execution",
    method: "execute_pause",
    args: [INCIDENT_ID],
    beforeCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      const paused = await read(client, DEMO, "is_paused");
      if (incident.state !== "ACTIVE_INCIDENT" || incident.incident_verdict !== "ACTIVE_INCIDENT" || paused !== false) throw new Error("pause precondition mismatch: " + JSON.stringify(safe({ incident, paused })));
      return { incident, paused };
    },
    afterCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      const paused = await read(client, DEMO, "is_paused");
      if (incident.state !== "ACTIVE_INCIDENT" || incident.pause_requested !== true) throw new Error("pause request readback mismatch: " + JSON.stringify(safe(incident)));
      return { incident, targetPaused: paused };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "confirm") {
  const result = await runWrite({
    label: "pause_confirmation",
    method: "confirm_pause",
    args: [INCIDENT_ID],
    beforeCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      const paused = await read(client, DEMO, "is_paused");
      if (incident.state !== "ACTIVE_INCIDENT" || incident.pause_requested !== true || paused !== true) throw new Error("pause confirmation precondition mismatch: " + JSON.stringify(safe({ incident, paused })));
      return { incident, paused };
    },
    afterCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [INCIDENT_ID]);
      const target = { paused: await read(client, DEMO, "is_paused"), counters: await read(client, DEMO, "get_pause_counters") };
      if (incident.state !== "PAUSED" || target.paused !== true || String(target.counters.pause_count) !== "1") throw new Error("pause confirmation readback mismatch: " + JSON.stringify(safe({ incident, target })));
      return { incident, target };
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "post-check") {
  const sourceHashes = await hashes();
  const { account: ownerAccount, client: ownerClient } = await makeClient("beacon-final-deployer");
  const { account: actorAccount, client: actorClient } = await makeClient("player2");
  const targetState = {
    paused: await read(ownerClient, DEMO, "is_paused"),
    remediated: await read(ownerClient, DEMO, "is_remediated"),
    treasury: await read(ownerClient, DEMO, "get_treasury_state"),
    totalProcessed: await read(ownerClient, DEMO, "get_total_processed"),
    counters: await read(ownerClient, DEMO, "get_pause_counters"),
  };
  if (targetState.paused !== true || targetState.remediated !== false || String(targetState.treasury.treasury_balance) !== "900" || String(targetState.treasury.total_outflow) !== "100") throw new Error("containment state mismatch: " + JSON.stringify(safe(targetState)));
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  const feeOptions = feesFromProfile(profile.deploy);
  const actorFees = await actorClient.estimateTransactionFeesForWrite({ account: actorAccount, address: DEMO, functionName: "execute_outflow", args: [ACTOR, 1n], ...feeOptions });
  const processFees = await ownerClient.estimateTransactionFeesForWrite({ account: ownerAccount, address: DEMO, functionName: "process", args: [1n], ...feeOptions });
  let outflowRejected = false;
  let processRejected = false;
  try { await actorClient.simulateWriteContract({ account: actorAccount, address: DEMO, functionName: "execute_outflow", args: [ACTOR, 1n], fees: actorFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch (error) { outflowRejected = true; console.log("POST_PAUSE_OUTFLOW_REJECTED: " + String(error.message || error)); }
  try { await ownerClient.simulateWriteContract({ account: ownerAccount, address: DEMO, functionName: "process", args: [1n], fees: processFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }); } catch (error) { processRejected = true; console.log("POST_PAUSE_PROCESS_REJECTED: " + String(error.message || error)); }
  if (!outflowRejected || !processRejected) throw new Error("post-pause simulation did not reject both writes");
  console.log(JSON.stringify({ event: "CONTAINMENT_VERIFIED", sourceHashes, targetState: safe(targetState), postPauseOutflowSimulation: "REJECTED", postPauseProcessSimulation: "REJECTED" }, null, 2));
} else if (op === "read-state") {
  const { client } = await makeClient("beacon-final-deployer");
  const result = {
    policy: await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]),
    incident: await read(client, SENTINEL, "get_incident", [INCIDENT_ID]),
    evidence_ids: ["chain-254762469c", "advisory-254762469c"],
    target: {
      owner: await read(client, DEMO, "get_owner"),
      authorized: await read(client, DEMO, "get_authorized_sentinel"),
      configured: await read(client, DEMO, "is_controller_configured"),
      paused: await read(client, DEMO, "is_paused"),
      remediated: await read(client, DEMO, "is_remediated"),
      treasury: await read(client, DEMO, "get_treasury_state"),
      totalProcessed: await read(client, DEMO, "get_total_processed"),
      counters: await read(client, DEMO, "get_pause_counters"),
    },
    account: await preflight(client, (await makeClient("beacon-final-deployer")).account, OWNER),
  };
  for (const id of result.evidence_ids) {
    try { result[id] = await read(client, SENTINEL, "get_evidence", [id]); } catch (error) { result[id] = { status: "NOT_BOUND", message: String(error?.message || error).slice(0, 200) }; }
  }
  console.log(JSON.stringify(safe(result), null, 2));
} else if (op === "read-fresh-state") {
  const { account, client } = await makeClient("beacon-final-deployer");
  const result = {
    policy: await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]),
    incident: await read(client, SENTINEL, "get_incident", [FRESH_INCIDENT_ID]),
    evidence_ids: ["chain-e25b16a662", FRESH_ADVISORY_ID],
    target: {
      owner: await read(client, DEMO, "get_owner"),
      authorized: await read(client, DEMO, "get_authorized_sentinel"),
      configured: await read(client, DEMO, "is_controller_configured"),
      paused: await read(client, DEMO, "is_paused"),
      remediated: await read(client, DEMO, "is_remediated"),
      treasury: await read(client, DEMO, "get_treasury_state"),
      totalProcessed: await read(client, DEMO, "get_total_processed"),
      counters: await read(client, DEMO, "get_pause_counters"),
    },
    account: await preflight(client, account, OWNER),
  };
  for (const id of result.evidence_ids) {
    try { result[id] = await read(client, SENTINEL, "get_evidence", [id]); } catch (error) { result[id] = { status: "NOT_BOUND", message: String(error?.message || error).slice(0, 200) }; }
  }
  console.log(JSON.stringify(safe(result), null, 2));
} else {
  throw new Error("unsupported operation: " + op);
}
