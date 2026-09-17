import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { abi } from "genlayer-js";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const SENTINEL = "0x5a2a5288C7213d60EC9C92ffa504Ef8FA64fc723";
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const INCIDENT = "incident-741e5d640646";
const EVIDENCE = "chain-741e5d640646";
const OUTFLOW = "0x741e5d6406466dfbc9bd7c54ef633c062606047240a790b037bcf7cf5dcbd19f";
const DIGEST = "4aa3613fe65f00d04ff576f73803fc159a9519dcb64d6c3c11180758f82d4192";
const INPUT = "FgB8ZXhlY3V0ZV9vdXRmbG93BGFyZ3MV1AIweDYzMTFkZTk4OWFiMDFhZTRkYTc3ZDM2Y2M0NWQ0OTVmYmNkNGI3YTihBg==";
const PROFILE = `${ROOT}/deploy/fee-profile.json`;
const RAW = `${ROOT}/deploy/evidence/final-v2/NONDET_DIAG_RAW.json`;

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction, encode4, makeCalldataObject, serialize };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    return p + q + new URL(`file://${req.resolve(spec)}`).href + close;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function safe(value) {
  return JSON.parse(JSON.stringify(value ?? null, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function fees(profile) {
  const rounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return {
    distribution: {
      leaderTimeunitsAllocation: String(profile.leaderTimeunitsAllocation),
      validatorTimeunitsAllocation: String(profile.validatorTimeunitsAllocation),
      appealRounds: String(rounds),
      executionBudgetPerRound: String(profile.executionBudgetPerRound),
      executionConsumed: "0",
      totalMessageFees: String(profile.totalMessageFees ?? 0),
      rotations: Array.from({ length: Number(rounds) + 1 }, () => String(rotation)),
      maxPriceGenPerTimeUnit: "2",
      storageFeeMaxGasPrice: "300000000",
      receiptFeeMaxGasPrice: "300000000",
    },
    messageAllocations: [],
    feeValue: "1429544700126258",
  };
}

function requestData(sdk, args) {
  return sdk.serialize([sdk.encode4(sdk.makeCalldataObject("bind_evidence", args, undefined)), false]);
}

function params(sdk, args, profile, leaderResults) {
  const result = {
    type: "write",
    to: SENTINEL,
    from: OWNER,
    data: requestData(sdk, args),
    transaction_hash_variant: "latest-nonfinal",
    status: "finalized",
  };
  if (leaderResults) result.leader_results = leaderResults;
  return result;
}

function focus(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    topKeys: Object.keys(r),
    data: r.data ?? null,
    eqOutputs: r.eqOutputs ?? r.eq_outputs ?? null,
    status: r.status ?? null,
    stdout: r.stdout ?? null,
    stderr: r.stderr ?? null,
    logs: r.logs ?? null,
    events: r.events ?? null,
    messages: r.messages ?? null,
    nondetDisagreementCallNo: r.nondetDisagreementCallNo ?? r.nondet_disagreement_call_no ?? null,
    result: r.result ?? null,
    executionResult: r.execution_result ?? null,
    genvmResult: r.genvm_result ?? null,
  };
}

const sdk = await loadSdk();
const action = new sdk.BaseAction();
action.accountOverride = "beacon-final-deployer";
const account = await action.getAccount(false);
const profile = JSON.parse(await readFile(PROFILE, "utf8"));
const args = [INCIDENT, EVIDENCE, "EMERGENCY", "CHAIN_TRANSACTION", RPC, "unauthorized-drain", DIGEST, OUTFLOW, 0n, INPUT];
const encoded = abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined));
const decoded = abi.calldata.decode(encoded).get("args");
const leaderRequest = params(sdk, args, profile, null);
async function rpcCall(method, request) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [request] }) });
  const envelope = JSON.parse(await response.text());
  if (envelope.error) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}
const leader = await rpcCall("sim_call", leaderRequest);
const leaderFocus = focus(leader);
const eqOutputs = Array.isArray(leaderFocus.eqOutputs) ? leaderFocus.eqOutputs : (leaderFocus.eqOutputs && typeof leaderFocus.eqOutputs === "object" ? Object.values(leaderFocus.eqOutputs) : null);
let validator = null;
let validatorFocus = null;
if (Array.isArray(eqOutputs)) {
  const validatorRequest = params(sdk, args, profile, eqOutputs);
  validator = await rpcCall("gen_call", validatorRequest);
  validatorFocus = focus(validator);
}
const output = {
  rpc: RPC,
  sentinel: SENTINEL,
  from: account.address,
  calldata: `0x${Buffer.from(encoded).toString("hex")}`,
  decodedArgs: decoded.map((value) => typeof value === "bigint" ? value.toString() : value),
  leader: safe(leader),
  validator: safe(validator),
  leaderFocus: safe(leaderFocus),
  validatorFocus: safe(validatorFocus),
};
await mkdir(`${ROOT}/deploy/evidence/final-v2`, { recursive: true });
await writeFile(RAW, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ raw: RAW, calldata: output.calldata, decodedArgs: output.decodedArgs, leader: leaderFocus, validator: validatorFocus }, null, 2));
