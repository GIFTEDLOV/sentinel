import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const TARGET = "0x7F3F78291C3bE65d924C3e18bc65F7500E93c590";
const PROTOCOL_ID = "sentinel-demo";
const FAILURE = "unauthorized-drain";
const DOMAINS = "studio-next.genlayer.com,raw.githubusercontent.com";
const PREFIX = "studio-next.genlayer.com|/api;raw.githubusercontent.com|/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const ADVISORY_PREFIX = "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/";
const INCIDENT = "incident-studio-next-v4-mu1ocbh7";
const OUTFLOW_TX = "0x50de89d7215d2241fc337fa77301bb3cb632f557604eece0cfaf02344dcb2dd7";
const OUTFLOW_DIGEST = "0b0794e0f4f70af26d44e1d77e164b1826a7b60b3b6645c4411a892f287af383";
const OUTFLOW_INPUT = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg==";
const ADVISORY_ID = "advisory-incident-mu1ocbh7";
const ADVISORY_URL = `${ADVISORY_PREFIX}incident-studio-next-v4-mu1ocbh7.json`;
const ADVISORY_DIGEST = "00e47d64d2e145341e2abd4dd8a2d5c9ab09cb6cb94c5eefcd0622ebc1ac464b";
const ADVISORY_BYTES = 950;
const SOURCE_PATH = `${ROOT}/contracts/sentinel.py`;
const OUT = `${ROOT}/deploy/evidence/final-v4/runtime-diagnosis`;
const JOURNAL = `${OUT}/PRODUCTION_CANDIDATE_DEPLOYMENT.json`;

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function lower(value) { return String(value ?? "").toLowerCase(); }
function terminal(receipt) {
  return {
    status: receipt?.statusName ?? receipt?.status_name ?? receipt?.status ?? null,
    consensus: receipt?.resultName ?? receipt?.result_name ?? receipt?.consensusStatus ?? receipt?.consensus_status ?? null,
    execution: receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name ?? receipt?.txExecutionResultName ?? receipt?.txExecutionResult ?? null,
    address: receipt?.contractAddress ?? receipt?.contract_address ?? receipt?.data?.contract_address ?? receipt?.data?.contractAddress ?? null,
  };
}
function requireSuccess(receipt, label) {
  const result = terminal(receipt);
  if (String(result.status).toUpperCase() !== "FINALIZED" || !["MAJORITY_AGREE", "ACCEPTED"].includes(String(result.consensus).toUpperCase()) || String(result.execution).toUpperCase() !== "FINISHED_WITH_RETURN") throw new Error(`${label} terminal gate failed: ${JSON.stringify(result)}`);
  return result;
}
function chain() { return { ...studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", nativeCurrency: { ...studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }; }
async function loadAccount() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
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
  const { BaseAction } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
  const action = new BaseAction();
  action.accountOverride = "beacon-final-deployer";
  return action.getAccount(false);
}
async function preflight(client, account, label) {
  const [chainId, balance, latest, pending] = await Promise.all([
    client.request({ method: "eth_chainId" }),
    client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
    client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
  ]);
  const result = { label, rpc: RPC, chainId: Number.parseInt(chainId, 16), account: account.address, balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (result.chainId !== CHAIN_ID || lower(result.account) !== OWNER || result.latestNonce !== result.pendingNonce) throw new Error(`${label} gate failed: ${JSON.stringify(result)}`);
  return result;
}
function calldataRoundtrip(method, args) {
  const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
  const decoded = abi.calldata.decode(encoded).get("args");
  if (!Array.isArray(decoded) || decoded.length !== args.length || !decoded.every((value, index) => String(value) === String(args[index]))) throw new Error(`${method} calldata roundtrip failed`);
  return { method, encoded: `0x${Buffer.from(encoded).toString("hex")}`, decoded: safe(decoded) };
}
async function waitSameHash(client, hash, label) {
  try { return await client.waitForTransactionReceipt({ hash, retries: 120, interval: 5000, waitUntil: "finalized", fullTransaction: true }); } catch (error) {
    for (let i = 0; i < 120; i += 1) {
      try { const tx = await client.getTransaction({ hash }); if (String(terminal(tx).status).toUpperCase() === "FINALIZED") return tx; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`${label} same-hash reconciliation timed out: ${String(error)}`);
  }
}
async function estimate(client, account, address, functionName, args) { return address ? client.estimateTransactionFeesForWrite({ account, address, functionName, args, appealRounds: 1n, rotations: [0n, 0n] }) : client.estimateTransactionFees({ account, appealRounds: 1n, rotations: [0n, 0n] }); }
async function writeOnce(client, account, journal, label, address, functionName, args, before = null) {
  if (before) await before();
  const pre = await preflight(client, account, `${label} preflight`);
  const calldata = calldataRoundtrip(functionName, args);
  const fees = await estimate(client, account, address, functionName, args);
  if (BigInt(pre.balanceWei) < BigInt(fees.feeValue)) throw new Error(`${label} fee balance gate failed`);
  const simulation = await client.simulateWriteContract({ account, address, functionName, args, fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" });
  const tx = await client.writeContract({ account, address, functionName, args, fees });
  journal.entries.push({ label, tx, nonce: pre.latestNonce, calldata, fees: safe(fees), simulation: safe(simulation) });
  await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ broadcast: label, tx, nonce: pre.latestNonce }));
  const receipt = await waitSameHash(client, tx, label);
  const final = requireSuccess(receipt, label);
  journal.entries[journal.entries.length - 1].terminal = final;
  await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
  return { tx, receipt, terminal: final, calldata, fees };
}

await mkdir(OUT, { recursive: true });
const source = await readFile(SOURCE_PATH, "utf8");
const sourceSha = createHash("sha256").update(source).digest("hex").toUpperCase();
const account = await loadAccount();
const client = createClient({ chain: chain(), endpoint: RPC, account });
const journal = { network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, sourceSha, account: account.address, entries: [] };
await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
const before = await preflight(client, account, "probe deployment");
const schema = await client.request({ method: "gen_getContractSchemaForCode", params: [source] });
const deployFees = await estimate(client, account, null, null, []);
const deployTx = await client.deployContract({ account, code: source, args: [], fees: deployFees });
journal.entries.push({ label: "production candidate deployment", tx: deployTx, nonce: before.latestNonce, fees: safe(deployFees) });
await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ broadcast: "production candidate deployment", tx: deployTx, nonce: before.latestNonce }));
const deployReceipt = await waitSameHash(client, deployTx, "production candidate deployment");
const deployTerminal = requireSuccess(deployReceipt, "production candidate deployment");
const probeAddress = deployTerminal.address;
if (!probeAddress) throw new Error("runtime probe deployment did not return an address");
journal.entries[journal.entries.length - 1].terminal = deployTerminal;
journal.probeAddress = probeAddress;
await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ candidateAddress: probeAddress, deployTx, schemaMethods: Object.keys(schema.methods ?? {}).sort() }, null, 2));

const registerArgs = [PROTOCOL_ID, TARGET, FAILURE, DOMAINS, PREFIX, RPC, 2n, 3600n, 900n];
await writeOnce(client, account, journal, "candidate register policy", probeAddress, "register_protected_protocol", registerArgs);
await writeOnce(client, account, journal, "candidate lock policy", probeAddress, "lock_emergency_policy", [PROTOCOL_ID]);
await writeOnce(client, account, journal, "candidate open incident", probeAddress, "open_incident", [INCIDENT, PROTOCOL_ID]);
await writeOnce(client, account, journal, "candidate bind chain evidence", probeAddress, "bind_evidence", [INCIDENT, "chain-50de89d7215d", "EMERGENCY", "CHAIN_TRANSACTION", RPC, FAILURE, OUTFLOW_DIGEST, OUTFLOW_TX, 0n, OUTFLOW_INPUT]);
await writeOnce(client, account, journal, "candidate bind advisory evidence", probeAddress, "bind_evidence", [INCIDENT, ADVISORY_ID, "EMERGENCY", "SECURITY_ADVISORY", ADVISORY_URL, FAILURE, ADVISORY_DIGEST, OUTFLOW_TX, 1n, ""]);
const finalPreflight = await preflight(client, account, "candidate after setup");
journal.after = finalPreflight;
await writeFile(JOURNAL, JSON.stringify(safe(journal), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ complete: true, candidateAddress: probeAddress, journal }, null, 2));
