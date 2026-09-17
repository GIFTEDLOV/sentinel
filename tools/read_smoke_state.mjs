import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const SENTINEL = "0x23F33f709e56097dee9e6EfF111bBbE0c95E56E5";
const DEMO = "0x1eD91AA33aD5f2F30e97737ca8EA295EdAe89537";
const INCIDENT = "incident-5a302b6d35aa";

async function loadSdk() {
  const path = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(path, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const url = new URL(`file://${path}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(url)}).href`).replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };").replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {}; ").replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {}; ");
  const req = createRequire(path);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => { if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all; if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`; return `${prefix}${quote}${new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`; });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const sdk = await loadSdk();
const action = new sdk.BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const chain = { ...sdk.studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const client = sdk.createClient2({ chain, endpoint: RPC, account });
await client.initializeConsensusSmartContract();
const read = (address, functionName, args = []) => client.readContract({ address, functionName, args, jsonSafeReturn: true });
const incident = await read(SENTINEL, "get_incident", [INCIDENT]);
const evidenceIds = String(incident.evidence_ids_csv ?? "").split(",").filter(Boolean);
const evidence = [];
for (const id of evidenceIds) evidence.push({ id, record: await read(SENTINEL, "get_evidence", [id]) });
const target = { paused: await read(DEMO, "is_paused"), remediated: await read(DEMO, "is_remediated"), treasury: await read(DEMO, "get_treasury_state"), counters: await read(DEMO, "get_pause_counters") };
console.log(JSON.stringify({ incident, evidence, target }, null, 2));
