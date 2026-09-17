import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const SENTINEL = "0x3Ebe17d44E2ede43C459310CF7582cbc1B3fA82e";
const INCIDENT = "incident-9f85596208f3";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const OUT = `${ROOT}/deploy/evidence/runtime-diagnosis/SNAPSHOT_FIX_PROBE_RESIMULATION.json`;

const safe = (value) => JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));

async function loadSdk() {
  const source = await readFile(BUNDLE, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${BUNDLE}`).href;
  transformed = transformed
    .replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`)
    .replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };")
    .replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};")
    .replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    const resolved = builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href;
    return `${prefix}${quote}${resolved}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const sdk = await loadSdk();
const action = new sdk.BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const chain = { ...studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const client = createClient({ chain, endpoint: RPC, account });
const output = { rpc: RPC, chainId: CHAIN_ID, sentinel: SENTINEL, incident: INCIDENT, broadcast: false };
try {
  const fees = await client.estimateTransactionFeesForWrite({ account, address: SENTINEL, functionName: "assess_incident", args: [INCIDENT], appealRounds: 1n, rotations: [0n, 0n] });
  output.fees = safe(fees);
  output.simulation = safe(await client.simulateWriteContract({ account, address: SENTINEL, functionName: "assess_incident", args: [INCIDENT], fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal" }));
  output.status = "SIMULATION_COMPLETED";
} catch (error) {
  output.status = "SIMULATION_ERROR";
  output.error = { name: error?.name, message: String(error?.message ?? error), shortMessage: error?.shortMessage, details: error?.details, receipt: safe(error?.cause?.data?.receipt ?? error?.data?.receipt) };
}
await writeFile(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: OUT, ...output }, null, 2));
