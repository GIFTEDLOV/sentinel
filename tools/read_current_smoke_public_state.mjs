import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const SENTINEL = process.env.SENTINEL_ADDRESS || "0xE8dF7DDDcca3F4640b1ce8B7C6cc1bE032573664";
const DEMO = process.env.DEMO_ADDRESS || "0x5Fb5C741d565dC79DaD9b01053aAb09d293bbaE4";
const INCIDENT = process.env.INCIDENT_ID || "incident-9f85596208f3";
const ADVISORY_URL = process.env.ADVISORY_URL || "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-incident-9f85596208f3.json";
const OUT = `${ROOT}/deploy/evidence/runtime-diagnosis/CURRENT_SMOKE_PUBLIC_READS.json`;

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };");
  transformed = transformed.replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};");
  transformed = transformed.replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    return `${prefix}${quote}${new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }

const sdk = await loadSdk();
const action = new sdk.BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const chain = { ...studioDevnet, id: 61997, name: "GenLayer Studio Next", nativeCurrency: { ...studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const client = createClient({ chain, endpoint: RPC, account });
const read = (address, functionName, args = []) => client.readContract({ address, functionName, args, jsonSafeReturn: true });
const incident = await read(SENTINEL, "get_incident", [INCIDENT]);
const ids = String(incident.evidence_ids_csv ?? "").split(",").filter(Boolean);
const evidence = [];
for (const id of ids) evidence.push({ id, record: await read(SENTINEL, "get_evidence", [id]) });
const advisoryResponse = await fetch(ADVISORY_URL);
const advisoryBytes = Buffer.from(await advisoryResponse.arrayBuffer());
const rpcTransactions = {};
for (const item of evidence) {
  const hash = item.record.transaction_hash;
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }) });
  rpcTransactions[hash] = { httpStatus: response.status, body: await response.json() };
}
const output = {
  network: "Studio Next", rpc: RPC, chainId: 61997, sentinel: SENTINEL, protectedDemo: DEMO, incidentId: INCIDENT,
  readAccount: account.address,
  incident,
  boundEvidenceCount: ids.length,
  evidence,
  target: {
    paused: await read(DEMO, "is_paused"),
    remediated: await read(DEMO, "is_remediated"),
    treasury: await read(DEMO, "get_treasury_state"),
    outflow: await read(DEMO, "get_last_outflow"),
    totalProcessed: await read(DEMO, "get_total_processed"),
    counters: await read(DEMO, "get_pause_counters"),
  },
  policy: await read(SENTINEL, "get_protocol", ["sentinel-demo"]),
  advisory: { url: ADVISORY_URL, httpStatus: advisoryResponse.status, bytes: advisoryBytes.length, sha256: createHash("sha256").update(advisoryBytes).digest("hex") },
  rpcTransactions,
};
await mkdir(`${ROOT}/deploy/evidence/runtime-diagnosis`, { recursive: true });
await writeFile(OUT, JSON.stringify(safe(output), null, 2) + "\n", "utf8");
console.log(JSON.stringify(safe(output), null, 2));
