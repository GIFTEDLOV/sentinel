import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const SENTINEL = "0xCdd1e472AFD0EE301C1981a6abe1208f55B730f5";
const DEMO = "0xb31a879d7e6929c1c8F6Fd5ba5cAdA89BD210eC1";
const INCIDENT = "incident-b2fa64830f71";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
async function loadSdk() {
  const source = await readFile(BUNDLE, "utf8"), marker = "initializeCLI();", end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const url = new URL(`file://${BUNDLE}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(url)}).href`).replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };").replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {}; ").replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {}; ");
  const req = createRequire(BUNDLE), builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => { if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all; return `${prefix}${quote}${builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`; });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}
const sdk = await loadSdk();
const action = new sdk.BaseAction(); action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false), chain = { ...sdk.studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } }, client = sdk.createClient2({ chain, endpoint: RPC, account });
await client.initializeConsensusSmartContract();
const read = (address, functionName, args = []) => client.readContract({ address, functionName, args, jsonSafeReturn: true });
const incident = await read(SENTINEL, "get_incident", [INCIDENT]);
const evidenceIds = String(incident.evidence_ids_csv ?? "").split(",").filter(Boolean);
const evidence = [];
for (const id of evidenceIds) evidence.push({ id, record: await read(SENTINEL, "get_evidence", [id]) });
const protocol = await read(SENTINEL, "get_protocol", ["sentinel-demo"]);
const target = { paused: await read(DEMO, "is_paused"), remediated: await read(DEMO, "is_remediated"), treasury: await read(DEMO, "get_treasury_state"), counters: await read(DEMO, "get_pause_counters"), owner: await read(DEMO, "get_owner"), authorizedSentinel: await read(DEMO, "get_authorized_sentinel"), controllerConfigured: await read(DEMO, "is_controller_configured") };
const lifecycle = await client.request({ method: "gen_getTransactionLifecycle", params: [{ txId: "0x2a6113215f03346ac5d99b053e378a0937cf1b6c14294a1cd07ee6bc0f65dee4" }] });
console.log(JSON.stringify({ rpc: RPC, chainId: CHAIN_ID, sentinel: SENTINEL, demo: DEMO, incident, protocol, evidence, target, lifecycle }, null, 2));
