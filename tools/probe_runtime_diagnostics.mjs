import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const PROBE = "0xFAf6eFA9030c62a65172f8eDfEd37B205fE68202";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = "incident-studio-next-v4-mu1ocbh7";
const OUT = `${ROOT}/deploy/evidence/final-v4/runtime-diagnosis`;
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

async function loadCodec() {
  const source = await readFile(BUNDLE, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${BUNDLE}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { encode4, makeCalldataObject, serialize };");
  const req = createRequire(BUNDLE);
  const builtins = new Set(["assert","buffer","child_process","crypto","events","fs","fs/promises","http","https","module","net","os","path","process","stream","stream/promises","string_decoder","tty","url","util","zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    return p + q + new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href + close;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function feeEnvelope() {
  return {
    distribution: {
      leaderTimeunitsAllocation: "100",
      validatorTimeunitsAllocation: "200",
      appealRounds: "1",
      executionBudgetPerRound: "300000000000000",
      executionConsumed: "0",
      totalMessageFees: "0",
      rotations: ["0", "0"],
      maxPriceGenPerTimeUnit: "2",
      storageFeeMaxGasPrice: "300000000",
      receiptFeeMaxGasPrice: "300000000",
    },
    messageAllocations: [],
    feeValue: "1000000000000000",
  };
}

async function rawGenCall(codec, method, args, transactionHashVariant) {
  const data = codec.serialize([codec.encode4(codec.makeCalldataObject(method, args, undefined)), false]);
  const request = {
    type: "write",
    to: PROBE,
    from: OWNER,
    data,
    transaction_hash_variant: transactionHashVariant,
    fees: feeEnvelope(),
  };
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [request] }),
  });
  const body = await response.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = { raw_text: body }; }
  return { request, http_status: response.status, response: parsed };
}

function extractDiagnostics(result) {
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(result);
  const lines = texts.flatMap((text) => text.split(/\r?\n/).filter((line) => line.includes("DBG_") || line.includes("Fresh evidence is insufficient")));
  return [...new Set(lines)];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const chain = { ...studioDevnet, id: 61997, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
  const client = createClient({ chain, endpoint: RPC });
  const read = async (functionName, args = []) => {
    try {
      return { ok: true, value: safe(await client.readContract({ address: PROBE, functionName, args, transactionHashVariant: "latest-final", jsonSafeReturn: true })) };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  const codec = await loadCodec();
  const view = await read("debug_assessment_snapshot", [INCIDENT]);
  const writeProbe = {};
  const assessment = {};
  for (const variant of ["latest-final", "latest-nonfinal"]) {
    writeProbe[variant] = await rawGenCall(codec, "debug_assessment_write_probe", [INCIDENT], variant);
    assessment[variant] = await rawGenCall(codec, "assess_incident", [INCIDENT], variant);
  }
  const output = {
    network: "Studio Next",
    rpc: RPC,
    chain_id: 61997,
    probe: PROBE,
    incident: INCIDENT,
    probe_code_sha256: createHash("sha256").update(await readFile(`${ROOT}/contracts/sentinel_runtime_probe.py`)).digest("hex").toUpperCase(),
    view,
    write_probe: writeProbe,
    assessment,
    extracted_diagnostics: {
      view: extractDiagnostics(view),
      write_probe: Object.fromEntries(Object.entries(writeProbe).map(([variant, value]) => [variant, extractDiagnostics(value)])),
      assessment: Object.fromEntries(Object.entries(assessment).map(([variant, value]) => [variant, extractDiagnostics(value)])),
    },
  };
  await writeFile(`${OUT}/RUNTIME_PROBE_DIAGNOSTICS.json`, JSON.stringify(safe(output), null, 2) + "\n", "utf8");
  console.log(JSON.stringify(safe(output), null, 2));
}

await main();
