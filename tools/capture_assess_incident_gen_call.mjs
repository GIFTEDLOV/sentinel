import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const SENTINEL = process.env.SENTINEL_ADDRESS || "0xCdd1e472AFD0EE301C1981a6abe1208f55B730f5";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = process.env.INCIDENT_ID || "incident-b2fa64830f71";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const OUT = process.env.OUTPUT_PATH || `${ROOT}/deploy/evidence/runtime-diagnosis/ASSESS_INCIDENT_GEN_CALL_RAW.json`;

function safe(value) { return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
async function loadCodec() {
  const source = await readFile(BUNDLE, "utf8");
  const marker = "initializeCLI();", end = source.lastIndexOf(marker);
  let transformed = source.slice(0, end) + source.slice(end + marker.length);
  const bundleUrl = new URL(`file://${BUNDLE}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`).replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { encode4, makeCalldataObject, serialize };");
  const req = createRequire(BUNDLE), builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => { if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all; return `${prefix}${quote}${builtins.has(spec) ? `node:${spec}` : new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href}${close}`; });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

async function rawGenCall(codec, data, status, transactionHashVariant) {
  const request = {
    type: "write",
    to: SENTINEL,
    from: OWNER,
    data,
    status,
    transaction_hash_variant: transactionHashVariant,
    fees: {
      distribution: {
        leaderTimeunitsAllocation: "100",
        validatorTimeunitsAllocation: "200",
        appealRounds: "1",
        executionBudgetPerRound: "160221000000000",
        executionConsumed: "0",
        totalMessageFees: "0",
        rotations: ["0", "0"],
        maxPriceGenPerTimeUnit: "2",
        storageFeeMaxGasPrice: "300000000",
        receiptFeeMaxGasPrice: "300000000",
      },
      messageAllocations: [],
      feeValue: "480663000018429",
    },
  };
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [request] }) });
  const body = await response.text();
  let parsed; try { parsed = JSON.parse(body); } catch { parsed = { raw_text: body }; }
  return { status, transactionHashVariant, httpStatus: response.status, request, response: parsed };
}

const codec = await loadCodec();
const encoded = codec.serialize([codec.encode4(codec.makeCalldataObject("assess_incident", [INCIDENT], undefined)), false]);
const result = {
  rpc: RPC,
  chainId: 61997,
  runner: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng",
  sentinel: SENTINEL,
  from: OWNER,
  incident: INCIDENT,
  method: "gen_call",
  broadcast: false,
  calldata: encoded,
  encodedCalldataSha256: createHash("sha256").update(encoded).digest("hex"),
  accepted: await rawGenCall(codec, encoded, "accepted", "latest-nonfinal"),
  finalized: await rawGenCall(codec, encoded, "finalized", "latest-final"),
};
await mkdir(`${ROOT}/deploy/evidence/runtime-diagnosis`, { recursive: true });
await writeFile(OUT, JSON.stringify(safe(result), null, 2) + "\n", "utf8");
console.log(JSON.stringify(safe({ output: OUT, accepted: result.accepted, finalized: result.finalized }), null, 2));
