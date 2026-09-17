import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const SENTINEL = "0xCdd1e472AFD0EE301C1981a6abe1208f55B730f5";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = "incident-b2fa64830f71";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const SIM_FILE = `${ROOT}/deploy/evidence/runtime-diagnosis/ASSESS_INCIDENT_SIMULATION_RECEIPT.json`;
const OUT = `${ROOT}/deploy/evidence/runtime-diagnosis/ASSESS_INCIDENT_VALIDATOR_DIAGNOSIS.json`;

const safe = (value) => JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));

async function loadCodec() {
  const source = await readFile(BUNDLE, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${BUNDLE.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`)
    .replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { encode4, makeCalldataObject, serialize };");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    return `${prefix}${quote}${builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

async function call(method, request) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [request] }) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  return { httpStatus: response.status, body };
}

const codec = await loadCodec();
const sim = JSON.parse(await readFile(SIM_FILE, "utf8"));
const receipt = sim.simulation.receipt;
const encoded = codec.serialize([codec.encode4(codec.makeCalldataObject("assess_incident", [INCIDENT], undefined)), false]);
const fees = sim.feeEnvelope;
const base = {
  type: "write",
  to: SENTINEL,
  from: OWNER,
  data: encoded,
  status: "finalized",
  transaction_hash_variant: "latest-final",
  fees,
};
const leader = await call("sim_call", base);
const rawEq = receipt.eq_outputs && (receipt.eq_outputs["0"] ?? Object.values(receipt.eq_outputs)[0]);
const leaderOutputs = rawEq ? [`0x${Buffer.from(rawEq, "base64").toString("hex")}`] : null;
const validator = leaderOutputs ? await call("sim_call", { ...base, leader_results: leaderOutputs }) : null;
const output = {
  rpc: RPC,
  sentinel: SENTINEL,
  incident: INCIDENT,
  broadcast: false,
  calldata: encoded,
  leaderEqOutputBase64FromSdkSimulation: rawEq ?? null,
  leaderEqOutputHexForValidator: leaderOutputs?.[0] ?? null,
  leader: safe(leader),
  validator: safe(validator),
  simulationReceiptSummary: {
    execution_result: receipt.execution_result,
    result: receipt.result,
    nondet_disagree: receipt.nondet_disagree,
    llm: receipt.execution_stats?.llm ?? null,
    call_counts: receipt.execution_stats?.call_counts ?? null,
  },
};
await mkdir(`${ROOT}/deploy/evidence/runtime-diagnosis`, { recursive: true });
await writeFile(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: OUT, leader: output.leader, validator: output.validator }, null, 2));
