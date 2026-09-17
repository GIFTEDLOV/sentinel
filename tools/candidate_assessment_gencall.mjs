import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CANDIDATE = "0x408367CD10Ba3Bb311E2dD6dd97253a74e89b4cE";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = "incident-studio-next-v4-mu1ocbh7";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const OUT = `${ROOT}/deploy/evidence/final-v4/runtime-diagnosis/CANDIDATE_ASSESSMENT_GENCALL.json`;

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

async function loadCodec() {
  const source = await readFile(BUNDLE, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
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

const codec = await loadCodec();
const data = codec.serialize([codec.encode4(codec.makeCalldataObject("assess_incident", [INCIDENT], undefined)), false]);
const request = {
  type: "write",
  to: CANDIDATE,
  from: OWNER,
  data,
  transaction_hash_variant: "latest-final",
  fees: {
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
  },
};
const response = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [request] }),
});
const body = await response.text();
let parsed;
try { parsed = JSON.parse(body); } catch { parsed = { raw_text: body }; }
const receipt = parsed?.error?.data?.receipt ?? parsed?.result?.receipt ?? null;
const genvm = parsed?.result?.genvm_result ?? receipt?.genvm_result ?? null;
const output = {
  rpc: RPC,
  candidate: CANDIDATE,
  incident: INCIDENT,
  broadcast: false,
  http_status: response.status,
  request,
  top_level_keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
  rpc_error: parsed?.error ?? null,
  result: parsed?.result ?? null,
  receipt_summary: receipt ? {
    execution_result: receipt.execution_result,
    result: receipt.result,
    mode: receipt.mode,
    vote: receipt.vote,
    eq_outputs: receipt.eq_outputs ?? null,
  } : null,
  genvm_result: genvm ? {
    stdout: genvm.stdout ?? "",
    stderr: genvm.stderr ?? "",
    error_code: genvm.error_code ?? null,
    raw_error: genvm.raw_error ?? null,
    error_description: genvm.error_description ?? null,
  } : null,
};
await writeFile(OUT, JSON.stringify(safe(output), null, 2) + "\n", "utf8");
console.log(JSON.stringify(safe(output), null, 2));
