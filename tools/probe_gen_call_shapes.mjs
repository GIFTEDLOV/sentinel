import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const RPC = "https://studio-dev.genlayer.com/api";
const SENTINEL = "0x5a2a5288C7213d60EC9C92ffa504Ef8FA64fc723";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const BUNDLE = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const args = ["incident-741e5d640646", "chain-741e5d640646", "EMERGENCY", "CHAIN_TRANSACTION", "https://studio-dev.genlayer.com/api", "unauthorized-drain", "4aa3613fe65f00d04ff576f73803fc159a9519dcb64d6c3c11180758f82d4192", "0x741e5d6406466dfbc9bd7c54ef633c062606047240a790b037bcf7cf5dcbd19f", 0n, "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg=="];

async function loadSdk() {
  const source = await readFile(BUNDLE, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${BUNDLE}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { encode4, makeCalldataObject, serialize };");
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
const sdk = await loadSdk();
const data = sdk.serialize([sdk.encode4(sdk.makeCalldataObject("bind_evidence", args, undefined)), false]);
console.log(JSON.stringify({ dataType: typeof data, dataConstructor: data?.constructor?.name, dataPreview: typeof data === "string" ? data.slice(0, 120) : safe(data) }));
const base = { type: "write", to: SENTINEL, from: OWNER, data };
const variants = [
  ["base", { ...base }],
  ["finalized", { ...base, status: "finalized" }],
  ["accepted", { ...base, status: "accepted" }],
  ["value", { ...base, value: "0x0" }],
  ["gas-value", { ...base, gas: "0x989680", value: "0x0" }],
  ["finalized-value", { ...base, status: "finalized", gas: "0x989680", value: "0x0" }],
];
const leaderEqBase64 = "AD4TYXV0aGVudGljYXRlZF9mYWN0c+QceyJjb25zZW5zdXMiOiJNQUpPUklUWV9BR1JFRSIsImV2ZW50X3RpbWVzdGFtcCI6MTc4OTMzOTU5MywiZXhlY3V0aW9uIjoiRklOSVNIRURfV0lUSF9SRVRVUk4iLCJoYXNoIjoiMHg3NDFlNWQ2NDA2NDY2ZGZiYzliZDdjNTRlZjYzM2MwNjI2MDYwNDcyNDBhNzkwYjAzN2JjZjdjZjVkY2JkMTlmIiwiaW5wdXQiOiJGZ0I4WlhobFkzVjBaVjl2ZFhSbWJHOTNCR0Z5WjNNVjFBSXdlRFl6TVRGa1pUazRPV0ZpTURGaFpUUmtZVGMzWkRNMlkyTTBOV1EwT1RWbVltTmtOR0kzWVRpaEJnPT0iLCJvcmlnaW4iOiIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTgiLCJzZW5kZXIiOiIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTgiLCJzdGF0dXMiOiJGSU5BTElaRUQiLCJ0YXJnZXQiOiIweGZjZWMwNDJiMmZjYzFkNzkzYmY5Mjg3NzY2NWM5YmFlMTY5NzFhZTEifQRib2R55Bx7ImNvbnNlbnN1cyI6Ik1BSk9SSVRZX0FHUkVFIiwiZXZlbnRfdGltZXN0YW1wIjoxNzg5MzM5NTkzLCJleGVjdXRpb24iOiJGSU5JU0hFRF9XSVRIX1JFVFVSTiIsImhhc2giOiIweDc0MWU1ZDY0MDY0NjZkZmJjOWJkN2M1NGVmNjMzYzA2MjYwNjA0NzI0MGE3OTBiMDM3YmNmN2NmNWRjYmQxOWYiLCJpbnB1dCI6IkZnQjhaWGhsWTNWMFpWOXZkWFJtYkc5M0JHRnlaM01WMUFJd2VEWXpNVEZrWlRrNE9XRmlNREZoWlRSa1lUYzNaRE0yWTJNME5XUTBPVFZtWW1Oa05HSTNZVGloQmc9PSIsIm9yaWdpbiI6IjB4NjMxMWRlOTg5YWIwMWFlNGRhNzdkMzZjYzQ1ZDQ5NWZiY2Q0YjdhOCIsInNlbmRlciI6IjB4NjMxMWRlOTg5YWIwMWFlNGRhNzdkMzZjYzQ1ZDQ5NWZiY2Q0YjdhOCIsInN0YXR1cyI6IkZJTkFMSVpFRCIsInRhcmdldCI6IjB4ZmNlYzA0MmIyZmNjMWQ3OTNiZjkyODc3NjY1YzliYWUxNjk3MWFlMSJ9D2NyaXRpY2FsX3NpZ25hbBAHY3VycmVudBAPZXZlbnRfdGltZXN0YW1wyfzkqTUTbWl0aWdhdGlvbl9jb21wbGV0ZQgGc3RhdHVzLFZBTElE";
const leaderEqHex = "0x" + Buffer.from(leaderEqBase64, "base64").toString("hex");
variants.push(["validator-leader-results-hex", { ...base, status: "finalized", leader_results: [leaderEqHex] }]);
for (const [name, request] of variants) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [request] }) });
  const body = await response.text();
  let parsed = null; try { parsed = JSON.parse(body); } catch {}
  const result = parsed?.result;
  console.log(JSON.stringify({ name, http: response.status, keys: parsed ? Object.keys(parsed) : [], error: parsed?.error ? { code: parsed.error.code, message: parsed.error.message, dataKeys: parsed.error.data && Object.keys(parsed.error.data) } : null, resultType: result === null ? "null" : typeof result, resultKeys: result && typeof result === "object" ? Object.keys(result) : [], result: typeof result === "string" ? result : safe(result) }, null, 2));
}
