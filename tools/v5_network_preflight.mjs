import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const PLAYER2 = "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8";
const OUT = `${ROOT}/deploy/evidence/final-v5`;

function safe(v) { return JSON.parse(JSON.stringify(v ?? null, (_, x) => typeof x === "bigint" ? x.toString() : x)); }
function lower(v) { return String(v ?? "").toLowerCase(); }
function chain() { return { ...studioDevnet, id: CHAIN_ID, name: "GenLayer Studio Next", nativeCurrency: { ...studioDevnet.nativeCurrency, name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }; }

async function sdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    return p + q + new URL(`file://${req.resolve(spec).replaceAll("\\", "/")}`).href + close;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const { BaseAction } = await sdk();
async function account(alias) { const a = new BaseAction(); a.accountOverride = alias; return a.getAccount(false); }
async function one(alias, expected) {
  const a = await account(alias);
  const c = createClient({ chain: chain(), endpoint: RPC, account: a });
  const [chainId, balance, latest, pending] = await Promise.all([
    c.request({ method: "eth_chainId" }),
    c.request({ method: "eth_getBalance", params: [a.address, "latest"] }),
    c.request({ method: "eth_getTransactionCount", params: [a.address, "latest"] }),
    c.request({ method: "eth_getTransactionCount", params: [a.address, "pending"] }),
  ]);
  const r = { alias, address: a.address, chainId: Number.parseInt(chainId, 16), balanceWei: BigInt(balance).toString(), latestNonce: Number.parseInt(latest, 16), pendingNonce: Number.parseInt(pending, 16) };
  if (r.chainId !== CHAIN_ID || lower(r.address) !== expected || r.latestNonce !== r.pendingNonce) throw new Error(`preflight gate failed: ${JSON.stringify(r)}`);
  return { account: a, client: c, result: r };
}
const owner = await one("beacon-final-deployer", OWNER);
const player2 = await one("player2", PLAYER2);
const policy = await owner.client.getCurrentFeePolicy();
const deployEstimate = await owner.client.estimateTransactionFees({ account: owner.account, appealRounds: 1n, rotations: [0n, 0n] });
const outflowEstimate = await player2.client.estimateTransactionFeesForWrite({ account: player2.account, address: "0x0000000000000000000000000000000000000001", functionName: "execute_outflow", args: [PLAYER2, 100n], appealRounds: 1n, rotations: [0n, 0n] }).catch(() => null);
const result = { network: "Studio Next", rpc: RPC, chainId: CHAIN_ID, owner: owner.result, player2: player2.result, feePolicy: safe(policy), deploymentEstimate: safe(deployEstimate), outflowEstimate: safe(outflowEstimate), player2FundingRequired: outflowEstimate ? BigInt(player2.result.balanceWei) < BigInt(outflowEstimate.feeValue) : "ESTIMATE_REQUIRES_DEPLOYED_TARGET" };
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/V5_NETWORK_PREFLIGHT.json`, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
