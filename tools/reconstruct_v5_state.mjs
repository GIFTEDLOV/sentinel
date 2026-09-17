import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ACTOR = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const SENTINEL = "0x06f30DF85294f0732f36Fb8d44f5fE00e0D91f53";
const DEMO = "0xbfC7DD4e7c57997F74C56175DBad234E4CA01B05";
const STATE = `${ROOT}/deploy/evidence/final-v5/V5_INCIDENT_STATE.json`;
const OUT = `${ROOT}/deploy/evidence/final-v5/LOST_RUN_CHAIN_RECONCILIATION.json`;
const SETUP_HASHES = [
  "0xd83271289d927999a8a25d3edc43834bd5d1af5c9503779ade9c0425a6409e41",
  "0xd218aac9abd2fffd4641a6034850249ad30e3c691ee85b5c0bb991ff6ecd5851",
  "0xcc9e3f71d06fe39a44c9514245ffbecc40fa6086ae571ed5d00c304e6d19fe59",
  "0xd721702c2f278e2b48cba5485cfb41a30d4503e67d3d92f3be37612c6dbb0417",
  "0xbc8fca492d640dc6cf09c2046652f6a923d257f05b97f50f32b6cadefd021357",
];

function safe(value) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function lower(value) { return String(value).toLowerCase(); }
function first(value, names) { for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name]; return null; }

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    return `${prefix}${quote}${new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const { createClient2, studioDevnet, BaseAction } = await loadSdk();
function makeChain() { return { ...studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } }; }
async function clientFor(alias) {
  const action = new BaseAction(); action.accountOverride = alias;
  const account = await action.getAccount(false);
  const client = createClient2({ chain: makeChain(), endpoint: RPC, account });
  await client.initializeConsensusSmartContract();
  return { account, client };
}
async function read(client, address, functionName, args = []) {
  try { return { ok: true, value: safe(await client.readContract({ address, functionName, args, jsonSafeReturn: true })) }; }
  catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
}
async function rpc(client, method, params = []) {
  try { return { ok: true, value: safe(await client.request({ method, params })) }; }
  catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
}
function stateHashes(state) {
  const hashes = [];
  const walk = (value) => {
    if (typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value)) hashes.push(value.toLowerCase());
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(state);
  return [...new Set(hashes)];
}

const state = JSON.parse(await readFile(STATE, "utf8"));
const owner = await clientFor("beacon-final-deployer");
const actor = await clientFor("player2");
const incidentId = state.FINAL_INCIDENT_ID;
const evidenceIds = [state.CHAIN_EVIDENCE_ID, state.advisoryEvidenceId, state.recoveryChainEvidenceId, state.recoveryAdvisoryEvidenceId].filter(Boolean);
const knownHashes = [...new Set([...SETUP_HASHES, ...stateHashes(state)])];
const ownerNonce = {
  latest: await rpc(owner.client, "eth_getTransactionCount", [owner.account.address, "latest"]),
  pending: await rpc(owner.client, "eth_getTransactionCount", [owner.account.address, "pending"]),
};
const actorNonce = {
  latest: await rpc(actor.client, "eth_getTransactionCount", [actor.account.address, "latest"]),
  pending: await rpc(actor.client, "eth_getTransactionCount", [actor.account.address, "pending"]),
};
const result = {
  network: { rpc: RPC, chainId: await rpc(owner.client, "eth_chainId") },
  accounts: {
    owner: { address: owner.account.address, balance: await rpc(owner.client, "eth_getBalance", [owner.account.address, "latest"]), nonce: ownerNonce },
    player2: { address: actor.account.address, balance: await rpc(actor.client, "eth_getBalance", [actor.account.address, "latest"]), nonce: actorNonce },
  },
  addresses: { sentinel: SENTINEL, protectedDemo: DEMO },
  sourceState: {
    incidentId,
    policy: await read(owner.client, SENTINEL, "get_protocol", ["sentinel-demo"]),
    incident: await read(owner.client, SENTINEL, "get_incident", [incidentId]),
    evidence: Object.fromEntries(await Promise.all(evidenceIds.map(async (id) => [id, await read(owner.client, SENTINEL, "get_evidence", [id])]))),
    target: {
      owner: await read(owner.client, DEMO, "get_owner"),
      authorizedSentinel: await read(owner.client, DEMO, "get_authorized_sentinel"),
      controllerConfigured: await read(owner.client, DEMO, "is_controller_configured"),
      paused: await read(owner.client, DEMO, "is_paused"),
      remediated: await read(owner.client, DEMO, "is_remediated"),
      treasury: await read(owner.client, DEMO, "get_treasury_state"),
      totalProcessed: await read(owner.client, DEMO, "get_total_processed"),
      counters: await read(owner.client, DEMO, "get_pause_counters"),
    },
  },
  transactions: Object.fromEntries(await Promise.all(knownHashes.map(async (hash) => [hash, {
    transaction: await rpc(owner.client, "eth_getTransactionByHash", [hash]),
    receipt: await rpc(owner.client, "eth_getTransactionReceipt", [hash]),
  }]))),
};
await writeFile(OUT, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
