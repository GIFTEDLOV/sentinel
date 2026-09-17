import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const RPC = "https://studio-dev.genlayer.com/api";
const SENTINEL = "0x5a2a5288C7213d60EC9C92ffa504Ef8FA64fc723";
const DEMO = "0xFCeC042B2fcc1d793Bf92877665c9Bae16971AE1";
const INCIDENT = "incident-741e5d640646";
const EVIDENCE = "chain-741e5d640646";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";

async function loadSdk() {
  const source = await readFile(BUNDLE, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${BUNDLE}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert","buffer","child_process","crypto","events","fs","fs/promises","http","https","module","net","os","path","process","stream","stream/promises","string_decoder","tty","url","util","zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all,p,q,s,c) => {
    if (s.startsWith("node:") || s.startsWith(".") || s.startsWith("/")) return all;
    if (builtins.has(s)) return p + q + "node:" + s + c;
    return p + q + new URL(`file://${req.resolve(s)}`).href + c;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}
function safe(v) { return JSON.parse(JSON.stringify(v ?? null, (_, x) => typeof x === "bigint" ? x.toString() : x)); }
const { createClient2, studioDevnet, BaseAction } = await loadSdk();
const action = new BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();
async function read(address, functionName, args = []) {
  try { return { ok: true, value: safe(await client.readContract({ address, functionName, args, jsonSafeReturn: true })) }; }
  catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
}
const output = {
  account: account.address,
  incident: await read(SENTINEL, "get_incident", [INCIDENT]),
  chainEvidence: await read(SENTINEL, "get_evidence", [EVIDENCE]),
  advisoryEvidence: await read(SENTINEL, "get_evidence", [`advisory-${INCIDENT.slice(9)}`]),
  paused: await read(DEMO, "is_paused"),
  remediated: await read(DEMO, "is_remediated"),
  treasury: await read(DEMO, "get_treasury_state"),
  lastOutflow: await read(DEMO, "get_last_outflow"),
  totalProcessed: await read(DEMO, "get_total_processed"),
  pauseCounters: await read(DEMO, "get_pause_counters"),
};
console.log(JSON.stringify(output, null, 2));
