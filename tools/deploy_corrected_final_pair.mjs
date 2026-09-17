import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const ACCOUNT_ADDRESS = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ZERO = "0x0000000000000000000000000000000000000000";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE_CLASS = "unauthorized-drain";
const DOMAINS = "studio-dev.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-dev.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const RPC_ENDPOINT = RPC;
const EXPECTED_SENTINEL_SHA = "7C1AAA1E2BAF4E30FDE3F9CB329F17FCBB5860AFE3A3F66BA4A6D6D58A2F53EE";
const EXPECTED_PROTECTED_DEMO_SHA = "1A091C8541DF3FBEDEE2B31D22AFFE7E2C3AF515D9584C31EEA576625D2F74F4";
const PROFILE_PATH = `${ROOT}/deploy/fee-profile.json`;
const EVIDENCE_DIR = `${ROOT}/deploy/evidence/final-v2`;
const SENTINEL_SOURCE = `${ROOT}/contracts/sentinel.py`;
const PROTECTED_SOURCE = `${ROOT}/contracts/protected_demo.py`;

async function loadInstalledSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const lastInit = source.lastIndexOf("initializeCLI();");
  if (lastInit < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, lastInit) + source.slice(lastInit + "initializeCLI();".length);
  const bundleFileUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleFileUrl)}).href`);
  transformed = transformed.replace(
    /export \{\s*initializeCLI\s*\};\s*$/m,
    "export { createClient2, studioDevnet, BaseAction };"
  );
  const requireFromBundle = createRequire(bundlePath);
  const builtins = new Set([
    "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises",
    "http", "https", "module", "net", "os", "path", "process", "stream",
    "stream/promises", "string_decoder", "tty", "url", "util", "zlib"
  ]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    const resolved = requireFromBundle.resolve(spec);
    return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function first(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) return value[name];
  }
  return null;
}

function terminal(receipt) {
  return {
    status: first(receipt, ["statusName", "status_name", "status"]),
    consensus: first(receipt, ["resultName", "result_name", "consensusStatus", "consensus_status"]),
    execution: first(receipt, ["txExecutionResultName", "tx_execution_result_name", "txExecutionResult"]),
    id: first(receipt, ["id", "txHash", "hash"]),
    contractAddress: first(receipt?.data, ["contract_address", "contractAddress"]) ?? first(receipt, ["contractAddress", "contract_address"]),
  };
}

function requireSuccess(receipt, operation) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" ||
      !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) ||
      String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") {
    throw new Error(`${operation} failed terminal-success gate: ${JSON.stringify(result)}`);
  }
  return result;
}

function profileOptions(profile) {
  const appealRounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return {
    leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation),
    appealRounds,
    executionBudgetPerRound: BigInt(profile.executionBudgetPerRound),
    totalMessageFees: BigInt(profile.totalMessageFees ?? 0),
    rotations: Array.from({ length: Number(appealRounds) + 1 }, () => rotation),
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
    transactionHashVariant: "latest-nonfinal",
  };
}

function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded);
  const decodedArgs = decoded.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== args.length ||
      !decodedArgs.every((value, index) => String(value) === String(args[index]))) {
    throw new Error(`${method} calldata roundtrip mismatch`);
  }
  return {
    method,
    encodedHex: "0x" + Buffer.from(encoded).toString("hex"),
    decodedArgs: decodedArgs.map((value) => typeof value === "bigint" ? value.toString() : value),
    exact: true,
  };
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

async function preflight(client, account) {
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
    unknownPendingTransactions: "not exposed by the canonical RPC; latest equals pending is the available gate",
  };
  if (result.chainId !== CHAIN_ID) throw new Error(`unexpected chain id ${result.chainId}`);
  if (result.account.toLowerCase() !== ACCOUNT_ADDRESS.toLowerCase()) throw new Error(`unexpected account ${result.account}`);
  if (result.latestNonce !== result.pendingNonce) throw new Error(`nonce mismatch ${result.latestNonce}/${result.pendingNonce}`);
  return result;
}

async function readContract(client, address, method, args = []) {
  return client.readContract({ address, functionName: method, args, jsonSafeReturn: true });
}

async function readCodeHash(client, address) {
  const encoded = await client.request({ method: "gen_getContractCode", params: [address] });
  const source = Buffer.from(encoded, "base64");
  return { sha256: createHash("sha256").update(source).digest("hex").toUpperCase(), bytes: source.length };
}

async function readSchema(client, address) {
  return client.request({ method: "gen_getContractSchema", params: [address] });
}

async function sourceSchema(client, source) {
  return client.request({ method: "gen_getContractSchemaForCode", params: [source] });
}

function checkSchema(schema, label) {
  if (!schema || !schema.methods) throw new Error(`${label} schema missing`);
  return schema;
}

function checkProtected(state, expectedSentinel, stage) {
  const lower = (value) => String(value).toLowerCase();
  if (lower(state.owner) !== ACCOUNT_ADDRESS.toLowerCase()) throw new Error(`${stage}: owner mismatch`);
  if (lower(state.authorized) !== expectedSentinel.toLowerCase()) throw new Error(`${stage}: authorized sentinel mismatch`);
  if (state.configured !== (expectedSentinel !== ZERO)) throw new Error(`${stage}: controller configured mismatch`);
  if (state.paused !== false || state.remediated !== false) throw new Error(`${stage}: paused/remediated mismatch`);
  if (String(state.treasury.treasury_balance) !== "1000" || String(state.treasury.total_outflow) !== "0") throw new Error(`${stage}: treasury mismatch`);
  if (String(state.totalProcessed) !== "0" || String(state.counters.pause_count) !== "0" || String(state.counters.unpause_count) !== "0") throw new Error(`${stage}: lifecycle counters changed`);
}

async function protectedState(client, address) {
  return {
    owner: await readContract(client, address, "get_owner"),
    authorized: await readContract(client, address, "get_authorized_sentinel"),
    configured: await readContract(client, address, "is_controller_configured"),
    paused: await readContract(client, address, "is_paused"),
    remediated: await readContract(client, address, "is_remediated"),
    treasury: await readContract(client, address, "get_treasury_state"),
    totalProcessed: await readContract(client, address, "get_total_processed"),
    counters: await readContract(client, address, "get_pause_counters"),
  };
}

async function requireUnknownProtocol(client, address) {
  try {
    await readContract(client, address, "get_protocol", [PROTOCOL_ID]);
  } catch (error) {
    const encoded = error?.cause?.data?.receipt?.result;
    const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    if (decoded.includes("Unknown protected protocol") || String(error).includes("Unknown protected protocol")) return "UNKNOWN_PROTECTED_PROTOCOL";
    throw new Error(`protocol precondition read failed: ${String(error).slice(0, 500)}`);
  }
  throw new Error("sentinel-demo already exists; registration must not be attempted");
}

function checkPolicy(policy, target, locked) {
  const actual = {
    protocol_id: policy.protocol_id,
    target_address: String(policy.target_address).toLowerCase(),
    critical_failure_class: policy.critical_failure_class,
    allowed_source_domains: policy.allowed_source_domains,
    allowed_source_prefixes: policy.allowed_source_prefixes,
    canonical_rpc_endpoint: policy.canonical_rpc_endpoint,
    minimum_sources: String(policy.minimum_sources),
    max_evidence_age_seconds: String(policy.max_evidence_age_seconds),
    recovery_cooldown_seconds: String(policy.recovery_cooldown_seconds),
    policy_locked: policy.policy_locked,
  };
  const expected = {
    protocol_id: PROTOCOL_ID,
    target_address: target.toLowerCase(),
    critical_failure_class: FAILURE_CLASS,
    allowed_source_domains: DOMAINS,
    allowed_source_prefixes: PREFIX,
    canonical_rpc_endpoint: RPC_ENDPOINT,
    minimum_sources: "2",
    max_evidence_age_seconds: "3600",
    recovery_cooldown_seconds: "900",
    policy_locked: locked,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`policy readback mismatch: ${JSON.stringify(actual)}`);
  return actual;
}

async function writeEvidence(name, lines) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(`${EVIDENCE_DIR}/${name}`, lines.join("\n") + "\n", "utf8");
}

const { createClient2, studioDevnet, BaseAction } = await loadInstalledSdk();
const accountAction = new BaseAction();
accountAction.accountOverride = "beacon-final-deployer";
const account = await accountAction.getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const sentinelSha = await sha256(SENTINEL_SOURCE);
const protectedDemoSha = await sha256(PROTECTED_SOURCE);
if (sentinelSha !== EXPECTED_SENTINEL_SHA || protectedDemoSha !== EXPECTED_PROTECTED_DEMO_SHA) throw new Error("source hash gate failed");

const sentinelSource = await readFile(SENTINEL_SOURCE, "utf8");
const protectedSource = await readFile(PROTECTED_SOURCE, "utf8");
const sentinelSchema = checkSchema(await sourceSchema(client, sentinelSource), "Sentinel");
const protectedSchema = checkSchema(await sourceSchema(client, protectedSource), "ProtectedDemo");
if (sentinelSchema.methods.bind_evidence.params.some((item) => item[0] === "observed_at")) throw new Error("caller observed_at remains in ABI");
if (protectedSchema.ctor.params[0]?.[1] !== "address") throw new Error("unexpected ProtectedDemo constructor");

const profileDocument = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
if (profileDocument.chainId !== CHAIN_ID || !profileDocument.deploy) throw new Error("invalid fee profile");
const feeOptions = profileOptions(profileDocument.deploy);
const beforeDeployments = await preflight(client, account);
if (BigInt(beforeDeployments.balanceWei) <= 0n) throw new Error("deployment account has no balance");
const currentFeePolicy = await client.getCurrentFeePolicy();
const protectedProfileEstimate = await client.estimateTransactionFees(feeOptions);
const sentinelProfileEstimate = await client.estimateTransactionFees(feeOptions);
if (BigInt(protectedProfileEstimate.feeValue) <= 0n || BigInt(sentinelProfileEstimate.feeValue) <= 0n) throw new Error("deployment fee estimate is zero");

const refreshedProfile = {
  version: profileDocument.version ?? 1,
  network: "studio_devnet",
  measuredAt: new Date().toISOString(),
  chainId: CHAIN_ID,
  deploy: profileDocument.deploy,
  methods: profileDocument.methods ?? {},
  sourceHashes: { sentinel: sentinelSha, protectedDemo: protectedDemoSha },
  currentFeePolicy: safe(currentFeePolicy),
  liveDeploymentEstimates: {
    protectedDemo: safe(protectedProfileEstimate),
    sentinel: safe(sentinelProfileEstimate),
  },
  note: "Current Studio-dev estimates captured immediately before corrected final-pair deployment; deploy entry retains the installed measured 2x-headroom profile.",
};
await writeFile(PROFILE_PATH, JSON.stringify(refreshedProfile, null, 2) + "\n", "utf8");

const allEvidence = [];
const broadcasted = [];
let capturedEvmHash = null;
const originalSendRaw = client.sendRawTransaction.bind(client);
client.sendRawTransaction = async (args) => {
  const hash = await originalSendRaw(args);
  capturedEvmHash = hash;
  console.log(JSON.stringify({ event: "BROADCAST_RETURNED", hash }));
  return hash;
};

async function deploy(label, source, args, expectedSha, expectedCtor) {
  const before = await preflight(client, account);
  const fees = await client.estimateTransactionFees(feeOptions);
  if (BigInt(fees.feeValue) <= 0n || BigInt(before.balanceWei) < BigInt(fees.feeValue)) throw new Error(`${label}: invalid balance/fee estimate`);
  const submission = {
    label, sourceSha: expectedSha, constructor: expectedCtor, preflight: before,
    feeProfile: refreshedProfile.deploy, fees: safe(fees), simulationEstimate: "PASS",
  };
  const tx = await client.deployContract({ account, code: source, args, fees });
  broadcasted.push({ label, tx, evmHash: capturedEvmHash });
  await writeEvidence(`${label}.txt`, [label, "BROADCAST_RETURNED: YES", "TRANSACTION_HASH: " + tx, "EVM_HASH: " + (capturedEvmHash ?? "NONE"), "SUBMISSION: " + JSON.stringify(submission)]);
  const receipt = await client.waitForTransactionReceipt({ hash: tx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
  const result = requireSuccess(receipt, label);
  const address = result.contractAddress;
  if (!address) throw new Error(`${label}: deployed address missing`);
  const remote = await readCodeHash(client, address);
  if (remote.sha256 !== expectedSha) throw new Error(`${label}: deployed source mismatch ${remote.sha256}`);
  const record = { ...submission, tx, receipt: safe(receipt), terminal: result, address, deployedSource: remote };
  await writeEvidence(`${label}.txt`, [label, "BROADCAST_COUNT: 1", "TRANSACTION_HASH: " + tx, "DEPLOYED_ADDRESS: " + address, "SUBMISSION: " + JSON.stringify(submission), "TERMINAL: " + JSON.stringify(result), "SOURCE_PARITY: " + JSON.stringify(remote)]);
  return { address, tx, result, receipt, fees, before, remote };
}

const protectedDeployment = await deploy(
  "CORRECTED_PROTECTED_DEMO_DEPLOYMENT",
  protectedSource,
  [ZERO],
  protectedDemoSha,
  { authorized_sentinel: ZERO },
);
const protectedAddress = protectedDeployment.address;
const initialProtected = await protectedState(client, protectedAddress);
checkProtected(initialProtected, ZERO, "new ProtectedDemo initial state");
await writeEvidence("CORRECTED_PROTECTED_DEMO_DEPLOYMENT.txt", [
  "CORRECTED PROTECTEDDEMO DEPLOYMENT",
  `SOURCE_SHA: ${protectedDemoSha}`,
  `NETWORK: studio-dev`, `RPC: ${RPC}`, `CHAIN_ID: ${CHAIN_ID}`, `ACCOUNT: ${account.address}`,
  `TRANSACTION_HASH: ${protectedDeployment.tx}`, `FINAL_STATUS: ${protectedDeployment.result.status}`,
  `CONSENSUS: ${protectedDeployment.result.consensus}`, `EXECUTION: ${protectedDeployment.result.execution}`,
  `ADDRESS: ${protectedAddress}`, `SOURCE_PARITY: ${JSON.stringify(protectedDeployment.remote)}`,
  `INITIAL_STATE: ${JSON.stringify(safe(initialProtected))}`,
  `FEE_ESTIMATE: ${JSON.stringify(safe(protectedDeployment.fees))}`,
]);

const beforeSentinel = await preflight(client, account);
const sentinelShaBefore = await sha256(SENTINEL_SOURCE);
if (sentinelShaBefore !== EXPECTED_SENTINEL_SHA) throw new Error("Sentinel hash changed before deployment");
const sentinelDeployment = await deploy(
  "CORRECTED_SENTINEL_DEPLOYMENT",
  sentinelSource,
  [],
  sentinelSha,
  { constructor: "no arguments" },
);
const sentinelAddress = sentinelDeployment.address;
const deployedSentinelSchema = checkSchema(await readSchema(client, sentinelAddress), "deployed Sentinel");
if (deployedSentinelSchema.methods.bind_evidence.params.some((item) => item[0] === "observed_at")) throw new Error("deployed Sentinel ABI still exposes observed_at");
if ((await requireUnknownProtocol(client, sentinelAddress)) !== "UNKNOWN_PROTECTED_PROTOCOL") throw new Error("new Sentinel is not empty");
await writeEvidence("CORRECTED_SENTINEL_DEPLOYMENT.txt", [
  "CORRECTED SENTINEL DEPLOYMENT",
  `SOURCE_SHA: ${sentinelSha}`, `NETWORK: studio-dev`, `RPC: ${RPC}`, `CHAIN_ID: ${CHAIN_ID}`, `ACCOUNT: ${account.address}`,
  `TRANSACTION_HASH: ${sentinelDeployment.tx}`, `FINAL_STATUS: ${sentinelDeployment.result.status}`,
  `CONSENSUS: ${sentinelDeployment.result.consensus}`, `EXECUTION: ${sentinelDeployment.result.execution}`,
  `ADDRESS: ${sentinelAddress}`, `SOURCE_PARITY: ${JSON.stringify(sentinelDeployment.remote)}`,
  `CORRECTED_BIND_EVIDENCE_ABI: ${JSON.stringify(deployedSentinelSchema.methods.bind_evidence)}`,
  `EMPTY_STATE: UNKNOWN_PROTECTED_PROTOCOL`, `FEE_ESTIMATE: ${JSON.stringify(safe(sentinelDeployment.fees))}`,
  `PRE_SENTINEL_REPREFLIGHT: ${JSON.stringify(beforeSentinel)}`,
]);

let protectedBeforeConfig = await protectedState(client, protectedAddress);
checkProtected(protectedBeforeConfig, ZERO, "before controller binding");
const configureArgs = [sentinelAddress];
const configureCalldata = calldataRoundtrip("configure_sentinel", configureArgs);
const configureBefore = await preflight(client, account);
const configureFees = await client.estimateTransactionFeesForWrite({ account, address: protectedAddress, functionName: "configure_sentinel", args: configureArgs, ...feeOptions });
if (BigInt(configureFees.feeValue) <= 0n) throw new Error("configure fee estimate is zero");
const configureSimulation = await client.simulateWriteContract({ account, address: protectedAddress, functionName: "configure_sentinel", args: configureArgs, fees: configureFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
const configureTx = await client.writeContract({ account, address: protectedAddress, functionName: "configure_sentinel", args: configureArgs, fees: configureFees });
broadcasted.push({ label: "CONFIGURE_SENTINEL", tx: configureTx, evmHash: capturedEvmHash });
await writeEvidence("CORRECTED_CONTROLLER_BINDING.txt", ["CORRECTED CONTROLLER BINDING", `TRANSACTION_HASH: ${configureTx}`, `BROADCAST_COUNT: 1`, `PREFLIGHT: ${JSON.stringify(configureBefore)}`, `CALLDATA: ${JSON.stringify(configureCalldata)}`, `SIMULATION: ${JSON.stringify(safe(configureSimulation))}`, `FEE_ESTIMATE: ${JSON.stringify(safe(configureFees))}`]);
const configureReceipt = await client.waitForTransactionReceipt({ hash: configureTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
const configureResult = requireSuccess(configureReceipt, "controller binding");
protectedBeforeConfig = await protectedState(client, protectedAddress);
checkProtected(protectedBeforeConfig, sentinelAddress, "after controller binding");
let secondConfigureSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: protectedAddress, functionName: "configure_sentinel", args: configureArgs, fees: configureFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  secondConfigureSimulation = "UNEXPECTED_SUCCESS";
} catch { /* expected */ }
if (secondConfigureSimulation !== "REJECTED") throw new Error("second controller configuration was not rejected");
await writeEvidence("CORRECTED_CONTROLLER_BINDING.txt", ["CORRECTED CONTROLLER BINDING", `TRANSACTION_HASH: ${configureTx}`, `BROADCAST_COUNT: 1`, `PREFLIGHT: ${JSON.stringify(configureBefore)}`, `CALLDATA: ${JSON.stringify(configureCalldata)}`, `SIMULATION: PASS`, `FINAL_STATUS: ${configureResult.status}`, `CONSENSUS: ${configureResult.consensus}`, `EXECUTION: ${configureResult.execution}`, `AUTHORIZED_SENTINEL_AFTER: ${sentinelAddress}`, `CONTROLLER_CONFIGURED_AFTER: true`, `SECOND_CONFIGURATION_SIMULATION: ${secondConfigureSimulation}`, `STATE: ${JSON.stringify(safe(protectedBeforeConfig))}`]);

const protocolPrecondition = await requireUnknownProtocol(client, sentinelAddress);
const registerArgs = [PROTOCOL_ID, protectedAddress, FAILURE_CLASS, DOMAINS, PREFIX, RPC_ENDPOINT, 2n, 3600n, 900n];
const registerCalldata = calldataRoundtrip("register_protected_protocol", registerArgs);
const registerBefore = await preflight(client, account);
const registerFees = await client.estimateTransactionFeesForWrite({ account, address: sentinelAddress, functionName: "register_protected_protocol", args: registerArgs, ...feeOptions });
if (BigInt(registerFees.feeValue) <= 0n) throw new Error("registration fee estimate is zero");
const registerSimulation = await client.simulateWriteContract({ account, address: sentinelAddress, functionName: "register_protected_protocol", args: registerArgs, fees: registerFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
const registerTx = await client.writeContract({ account, address: sentinelAddress, functionName: "register_protected_protocol", args: registerArgs, fees: registerFees });
broadcasted.push({ label: "CORRECTED_POLICY_REGISTRATION", tx: registerTx, evmHash: capturedEvmHash });
await writeEvidence("CORRECTED_POLICY_REGISTRATION.txt", ["CORRECTED POLICY REGISTRATION", `TRANSACTION_HASH: ${registerTx}`, `BROADCAST_COUNT: 1`, `PREFLIGHT: ${JSON.stringify(registerBefore)}`, `PROTOCOL_PRECONDITION: ${protocolPrecondition}`, `CALLDATA: ${JSON.stringify(registerCalldata)}`, `SIMULATION: ${JSON.stringify(safe(registerSimulation))}`, `FEE_ESTIMATE: ${JSON.stringify(safe(registerFees))}`]);
const registerReceipt = await client.waitForTransactionReceipt({ hash: registerTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
const registerResult = requireSuccess(registerReceipt, "policy registration");
const policyAfterRegister = checkPolicy(await readContract(client, sentinelAddress, "get_protocol", [PROTOCOL_ID]), protectedAddress, false);
await writeEvidence("CORRECTED_POLICY_REGISTRATION.txt", ["CORRECTED POLICY REGISTRATION", `TRANSACTION_HASH: ${registerTx}`, `BROADCAST_COUNT: 1`, `FINAL_STATUS: ${registerResult.status}`, `CONSENSUS: ${registerResult.consensus}`, `EXECUTION: ${registerResult.execution}`, `REGISTERED_POLICY: ${JSON.stringify(policyAfterRegister)}`, `PROTECTED_TARGET: ${protectedAddress}`]);

const lockArgs = [PROTOCOL_ID];
const lockCalldata = calldataRoundtrip("lock_emergency_policy", lockArgs);
const lockBefore = await preflight(client, account);
const policyBeforeLock = checkPolicy(await readContract(client, sentinelAddress, "get_protocol", [PROTOCOL_ID]), protectedAddress, false);
const lockFees = await client.estimateTransactionFeesForWrite({ account, address: sentinelAddress, functionName: "lock_emergency_policy", args: lockArgs, ...feeOptions });
if (BigInt(lockFees.feeValue) <= 0n) throw new Error("policy lock fee estimate is zero");
const lockSimulation = await client.simulateWriteContract({ account, address: sentinelAddress, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
const lockTx = await client.writeContract({ account, address: sentinelAddress, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees });
broadcasted.push({ label: "CORRECTED_POLICY_LOCK", tx: lockTx, evmHash: capturedEvmHash });
await writeEvidence("CORRECTED_POLICY_LOCK.txt", ["CORRECTED POLICY LOCK", `TRANSACTION_HASH: ${lockTx}`, `BROADCAST_COUNT: 1`, `PREFLIGHT: ${JSON.stringify(lockBefore)}`, `POLICY_BEFORE: ${JSON.stringify(policyBeforeLock)}`, `CALLDATA: ${JSON.stringify(lockCalldata)}`, `SIMULATION: ${JSON.stringify(safe(lockSimulation))}`, `FEE_ESTIMATE: ${JSON.stringify(safe(lockFees))}`]);
const lockReceipt = await client.waitForTransactionReceipt({ hash: lockTx, retries: 100, interval: 5000, waitUntil: "finalized", fullTransaction: true });
const lockResult = requireSuccess(lockReceipt, "policy lock");
const finalPolicy = checkPolicy(await readContract(client, sentinelAddress, "get_protocol", [PROTOCOL_ID]), protectedAddress, true);
let updateSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: sentinelAddress, functionName: "update_emergency_policy", args: [PROTOCOL_ID, FAILURE_CLASS, DOMAINS, PREFIX, RPC_ENDPOINT, 2n, 3600n, 900n], fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  updateSimulation = "UNEXPECTED_SUCCESS";
} catch { /* expected */ }
let secondLockSimulation = "REJECTED";
try {
  await client.simulateWriteContract({ account, address: sentinelAddress, functionName: "lock_emergency_policy", args: lockArgs, fees: lockFees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  secondLockSimulation = "UNEXPECTED_SUCCESS";
} catch { /* expected */ }
if (updateSimulation !== "REJECTED" || secondLockSimulation !== "REJECTED") throw new Error("policy immutability simulation failed");
const finalProtected = await protectedState(client, protectedAddress);
checkProtected(finalProtected, sentinelAddress, "final ProtectedDemo state");
const after = await preflight(client, account);
const advisoryFiles = ["tools/build_advisory.py", "evidence/advisories/incident-template.json", "evidence/advisories/recovery-template.json", "docs/FINAL_ADVISORY_SOURCE.md"];
const oldAddress = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584".toLowerCase();
const advisoryHardcode = {};
for (const file of advisoryFiles) advisoryHardcode[file] = (await readFile(`${ROOT}/${file}`, "utf8")).toLowerCase().includes(oldAddress);
const advisoryToolHardcodesOldTarget = advisoryHardcode[advisoryFiles[0]];
const advisoryTemplatesReferenceOldTarget = advisoryHardcode[advisoryFiles[1]] || advisoryHardcode[advisoryFiles[2]];
await writeEvidence("CORRECTED_POLICY_LOCK.txt", [
  "CORRECTED POLICY LOCK", `TRANSACTION_HASH: ${lockTx}`, `BROADCAST_COUNT: 1`,
  `FINAL_STATUS: ${lockResult.status}`, `CONSENSUS: ${lockResult.consensus}`, `EXECUTION: ${lockResult.execution}`,
  `FINAL_POLICY: ${JSON.stringify(finalPolicy)}`, `UPDATE_AFTER_LOCK_SIMULATION: ${updateSimulation}`, `SECOND_LOCK_SIMULATION: ${secondLockSimulation}`,
  `FINAL_PROTECTED_STATE: ${JSON.stringify(safe(finalProtected))}`, `BALANCE_AFTER_WEI: ${after.balanceWei}`,
  `LATEST_NONCE_AFTER: ${after.latestNonce}`, `PENDING_NONCE_AFTER: ${after.pendingNonce}`,
  `INCIDENT_CREATED: NO`, `EVIDENCE_BOUND: NO`, `ADVISORY_TOOL_HARDCODES_OLD_TARGET: ${advisoryToolHardcodesOldTarget ? "YES" : "NO"}`,
  `ADVISORY_TEMPLATES_REFERENCE_OLD_TARGET: ${advisoryTemplatesReferenceOldTarget ? "YES" : "NO"}`,
]);
console.log(JSON.stringify({
  event: "CORRECTED_FINAL_PAIR_LOCKED",
  sourceHashes: { sentinel: sentinelSha, protectedDemo: protectedDemoSha },
  network: "studio-dev", rpc: RPC, chainId: CHAIN_ID, account: account.address,
  profile: refreshedProfile, protectedDeployment: { tx: protectedDeployment.tx, address: protectedAddress, terminal: protectedDeployment.result },
  sentinelDeployment: { tx: sentinelDeployment.tx, address: sentinelAddress, terminal: sentinelDeployment.result },
  configure: { tx: configureTx, terminal: configureResult, secondSimulation: secondConfigureSimulation },
  register: { tx: registerTx, terminal: registerResult, policy: policyAfterRegister },
  lock: { tx: lockTx, terminal: lockResult, policy: finalPolicy, updateSimulation, secondLockSimulation },
  finalProtected: safe(finalProtected), after,
  advisoryToolHardcodesOldTarget, advisoryTemplatesReferenceOldTarget,
  writes: broadcasted,
}, (_, value) => typeof value === "bigint" ? value.toString() : value));
