import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFile, readFile, writeFile } from "node:fs/promises";
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
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
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

async function preflight(client, account, label) {
  const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = {
    label,
    network: "studio-dev",
    rpc: RPC,
    chainId: Number.parseInt(chainIdHex, 16),
    account: account.address,
    balanceWei: BigInt(balanceHex).toString(),
    latestNonce: Number.parseInt(latestHex, 16),
    pendingNonce: Number.parseInt(pendingHex, 16),
    unknownPendingTransactions: "eth_pendingTransactions unsupported; latest==pending is the available gate",
  };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== lower(label === "outflow" ? ACTOR : OWNER) || result.latestNonce !== result.pendingNonce) {
    throw new Error(label + " account/network/nonce preflight failed: " + JSON.stringify(result));
  }
  return result;
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

async function append(lines) {
  await appendFile(EVIDENCE, lines.join("\n") + "\n", "utf8");
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

async function commonPolicy(client) {
  const policy = await read(client, SENTINEL, "get_protocol", [PROTOCOL_ID]);
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("locked policy mismatch");
  return actual;
}

async function exactDemoState(client) {
  return {
    paused: await read(client, DEMO, "is_paused"),
    remediated: await read(client, DEMO, "is_remediated"),
    treasury: await read(client, DEMO, "get_treasury_state"),
    lastOutflow: await read(client, DEMO, "get_last_outflow"),
    totalProcessed: await read(client, DEMO, "get_total_processed"),
    counters: await read(client, DEMO, "get_pause_counters"),
  };
}

function assertHealthy(state, expectedProcessed) {
  if (state.paused !== false || state.remediated !== false || String(state.treasury.treasury_balance) !== "1000" || String(state.treasury.total_outflow) !== "0" || String(state.totalProcessed) !== String(expectedProcessed) || String(state.counters.pause_count) !== "0" || String(state.counters.unpause_count) !== "0") {
    throw new Error("healthy ProtectedDemo state mismatch: " + JSON.stringify(safe(state)));
  }
}

async function runWrite({ label, accountName, address, method, args, beforeCheck, afterCheck }) {
  const sourceHashes = await hashes();
  const { account, client } = await makeClient(accountName);
  const accountRole = label.includes("outflow") ? "outflow" : "owner";
  const policy = await commonPolicy(client);
  const beforeState = await exactDemoState(client);
  await beforeCheck({ account, client, beforeState, policy });
  const initialPreflight = await preflight(client, account, accountRole);
  const profile = JSON.parse(await readFile(PROFILE, "utf8"));
  if (profile.chainId !== CHAIN_ID || !profile.deploy) throw new Error("invalid current fee profile");
  const feeOptions = feesFromProfile(profile.deploy);
  const calldata = calldataRoundtrip(method, args);
  const fees = await client.estimateTransactionFeesForWrite({ account, address, functionName: method, args, ...feeOptions });
  if (BigInt(fees.feeValue) <= 0n) throw new Error(label + " fee quote is zero");
  if (BigInt(initialPreflight.balanceWei) < BigInt(fees.feeValue)) throw new Error(label + " balance is below quoted fee");
  const simulation = await client.simulateWriteContract({ account, address, functionName: method, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const simulationTerminal = terminal(simulation.receipt || {});
  console.log(JSON.stringify({ event: label.toUpperCase() + "_PREFLIGHT", sourceHashes, policy, beforeState: safe(beforeState), preflight: initialPreflight, calldata, fees: safe(fees), simulation: simulationTerminal }, null, 2));
  const beforeBroadcast = await preflight(client, account, accountRole);
  const tx = await client.writeContract({ account, address, functionName: method, args, fees });
  console.log(JSON.stringify({ event: label.toUpperCase() + "_BROADCAST_RETURNED", tx }));
  await append([
    "STEP: " + label,
    "SOURCE_HASHES: " + JSON.stringify(sourceHashes),
    "ACCOUNT: " + account.address,
    "PREFLIGHT: " + JSON.stringify(beforeBroadcast),
    "CALLDATA: " + JSON.stringify(calldata),
    "FEES: " + JSON.stringify(safe(fees)),
    "SIMULATION: " + JSON.stringify(simulationTerminal),
    "TX: " + tx,
    "BROADCAST_COUNT: 1",
  ]);
  const receipt = await client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const final = requireSuccess(receipt, label);
  const afterState = await exactDemoState(client);
  await afterCheck({ account, client, beforeState, afterState, final, tx });
  await append([
    "FINAL_STATUS: " + final.status,
    "CONSENSUS: " + final.consensus,
    "EXECUTION: " + final.execution,
    "STATE_AFTER: " + JSON.stringify(safe(afterState)),
  ]);
  console.log(JSON.stringify({ event: label.toUpperCase() + "_FINALIZED", tx, final, afterState: safe(afterState) }, null, 2));
  return { tx, final, afterState, account: account.address, fees: safe(fees), calldata, before: beforeBroadcast };
}

const op = process.argv[2];
if (!op) throw new Error("usage: node tools/run_incident_step.mjs <baseline|outflow|open> [incident_id]");

if (op === "baseline") {
  const result = await runWrite({
    label: "healthy_baseline",
    accountName: "beacon-final-deployer",
    address: DEMO,
    method: "process",
    args: [1n],
    beforeCheck: async ({ beforeState }) => {
      assertHealthy(beforeState, 0);
    },
    afterCheck: async ({ afterState }) => {
      assertHealthy(afterState, 1);
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "outflow") {
  const result = await runWrite({
    label: "demo_outflow",
    accountName: "player2",
    address: DEMO,
    method: "execute_outflow",
    args: [ACTOR, 100n],
    beforeCheck: async ({ account, beforeState }) => {
      if (lower(account.address) !== ACTOR || beforeState.paused !== false || beforeState.remediated !== false || String(beforeState.treasury.treasury_balance) !== "1000" || String(beforeState.treasury.total_outflow) !== "0") throw new Error("outflow precondition mismatch");
    },
    afterCheck: async ({ account, afterState }) => {
      if (lower(afterState.lastOutflow.actor) !== lower(account.address) || String(afterState.lastOutflow.amount) !== "100" || afterState.paused !== false || afterState.remediated !== false || String(afterState.treasury.treasury_balance) !== "900" || String(afterState.treasury.total_outflow) !== "100") throw new Error("outflow consequence mismatch: " + JSON.stringify(safe(afterState)));
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "fresh-outflow") {
  const result = await runWrite({
    label: "fresh_demo_outflow",
    accountName: "player2",
    address: DEMO,
    method: "execute_outflow",
    args: [ACTOR, 50n],
    beforeCheck: async ({ account, beforeState }) => {
      if (lower(account.address) !== ACTOR || beforeState.paused !== false || beforeState.remediated !== false || String(beforeState.treasury.treasury_balance) !== "900" || String(beforeState.treasury.total_outflow) !== "100") throw new Error("fresh outflow precondition mismatch: " + JSON.stringify(safe(beforeState)));
    },
    afterCheck: async ({ account, afterState }) => {
      if (lower(afterState.lastOutflow.actor) !== lower(account.address) || String(afterState.lastOutflow.amount) !== "50" || afterState.paused !== false || afterState.remediated !== false || String(afterState.treasury.treasury_balance) !== "850" || String(afterState.treasury.total_outflow) !== "150") throw new Error("fresh outflow consequence mismatch: " + JSON.stringify(safe(afterState)));
    },
  });
  console.log(JSON.stringify({ result }, null, 2));
} else if (op === "open") {
  const incidentId = process.argv[3];
  if (!incidentId) throw new Error("open requires incident id");
  const result = await runWrite({
    label: "incident_create",
    accountName: "beacon-final-deployer",
    address: SENTINEL,
    method: "open_incident",
    args: [incidentId, PROTOCOL_ID],
    beforeCheck: async ({ client, beforeState }) => {
      if (beforeState.paused !== false || beforeState.remediated !== false || String(beforeState.treasury.treasury_balance) !== "900" || String(beforeState.treasury.total_outflow) !== "100" || String(beforeState.totalProcessed) !== "1" || String(beforeState.counters.pause_count) !== "0" || String(beforeState.counters.unpause_count) !== "0") {
        throw new Error("incident creation post-outflow precondition mismatch: " + JSON.stringify(safe(beforeState)));
      }
      try {
        await read(client, SENTINEL, "get_incident", [incidentId]);
        throw new Error("incident id already exists");
      } catch (error) {
        if (String(error.message || error).includes("incident id already exists")) throw error;
      }
    },
    afterCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [incidentId]);
      if (incident.protocol_id !== PROTOCOL_ID || incident.state !== "ASSESSING" || incident.evidence_ids_csv !== "" || incident.source_domains_csv !== "") throw new Error("incident creation readback mismatch: " + JSON.stringify(safe(incident)));
      await append(["INCIDENT_ID: " + incidentId, "INCIDENT_STATE_AFTER_CREATE: " + JSON.stringify(safe(incident))]);
    },
  });
  console.log(JSON.stringify({ incidentId, result }, null, 2));
} else if (op === "open-fresh") {
  const incidentId = process.argv[3];
  if (!incidentId) throw new Error("open-fresh requires incident id");
  const result = await runWrite({
    label: "fresh_incident_create",
    accountName: "beacon-final-deployer",
    address: SENTINEL,
    method: "open_incident",
    args: [incidentId, PROTOCOL_ID],
    beforeCheck: async ({ client, beforeState }) => {
      if (beforeState.paused !== false || beforeState.remediated !== false || String(beforeState.treasury.treasury_balance) !== "850" || String(beforeState.treasury.total_outflow) !== "150" || String(beforeState.totalProcessed) !== "1" || String(beforeState.counters.pause_count) !== "0" || String(beforeState.counters.unpause_count) !== "0") {
        throw new Error("fresh incident creation precondition mismatch: " + JSON.stringify(safe(beforeState)));
      }
      try {
        await read(client, SENTINEL, "get_incident", [incidentId]);
        throw new Error("fresh incident id already exists");
      } catch (error) {
        if (String(error.message || error).includes("fresh incident id already exists")) throw error;
      }
    },
    afterCheck: async ({ client }) => {
      const incident = await read(client, SENTINEL, "get_incident", [incidentId]);
      if (incident.protocol_id !== PROTOCOL_ID || incident.state !== "ASSESSING" || incident.evidence_ids_csv !== "" || incident.source_domains_csv !== "") throw new Error("fresh incident creation readback mismatch: " + JSON.stringify(safe(incident)));
      await append(["FRESH_INCIDENT_ID: " + incidentId, "FRESH_INCIDENT_STATE_AFTER_CREATE: " + JSON.stringify(safe(incident))]);
    },
  });
  console.log(JSON.stringify({ incidentId, result }, null, 2));
} else {
  throw new Error("unsupported operation: " + op);
}
