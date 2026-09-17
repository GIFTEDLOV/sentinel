import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const SENTINEL = "0x408367CD10Ba3Bb311E2dD6dd97253a74e89b4cE";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = "incident-studio-next-v4-mu1ocbh7";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const OUT = `${ROOT}/deploy/evidence/runtime-diagnosis/OLD_CANDIDATE_ASSESSMENT_SIMULATION.json`;
const safe = (value) => JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));

async function loadCodec() {
  const source = await readFile(BUNDLE, "utf8");
  const marker = "initializeCLI();";
  const end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const url = new URL(`file://${BUNDLE.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(url)}).href`).replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { encode4, makeCalldataObject, serialize };");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    return `${prefix}${quote}${builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}
const codec = await loadCodec();
const data = codec.serialize([codec.encode4(codec.makeCalldataObject("assess_incident", [INCIDENT], undefined)), false]);
const request = {
  type: "write", to: SENTINEL, from: OWNER, data, status: "finalized", transaction_hash_variant: "latest-final",
  fees: { distribution: { leaderTimeunitsAllocation: "100", validatorTimeunitsAllocation: "200", appealRounds: "1", executionBudgetPerRound: "300000000000000", executionConsumed: "0", totalMessageFees: "0", rotations: ["0", "0"], maxPriceGenPerTimeUnit: "2", storageFeeMaxGasPrice: "300000000", receiptFeeMaxGasPrice: "300000000" }, messageAllocations: [], feeValue: "1000000000000000" },
};
const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_call", params: [request] }) });
const body = await response.text();
let parsed; try { parsed = JSON.parse(body); } catch { parsed = { raw_text: body }; }
const result = parsed?.result ?? {};
const output = { rpc: RPC, sentinel: SENTINEL, incident: INCIDENT, broadcast: false, request, response: safe(parsed), summary: { mode: result.mode, execution_result: result.execution_result, result: result.result, nondet_disagree: result.nondet_disagree, eq_outputs: result.eq_outputs ?? null, llm: result.execution_stats?.llm ?? null, call_counts: result.execution_stats?.call_counts ?? null, genvm: { error_code: result.genvm_result?.error_code ?? null, raw_error: result.genvm_result?.raw_error ?? null, error_description: result.genvm_result?.error_description ?? null } } };
await writeFile(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: OUT, summary: output.summary }, null, 2));
