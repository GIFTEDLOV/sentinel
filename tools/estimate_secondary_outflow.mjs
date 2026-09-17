import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-dev.genlayer.com/api";
const CHAIN_ID = 61997;
const OWNER = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const ACTOR_NAME = "player2";
const DEMO = "0x38f38591A2835e2e9b467FBAc94D4b613Ce27584";
const AMOUNT = 100n;
const PROFILE = ROOT + "/deploy/fee-profile.json";

async function loadSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const end = source.lastIndexOf("initializeCLI();");
  if (end < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, end) + source.slice(end + "initializeCLI();".length);
  const bundleUrl = new URL("file://" + bundlePath).href;
  transformed = transformed.replaceAll("import.meta.url", "new URL(" + JSON.stringify(bundleUrl) + ").href");
  transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction };");
  const req = createRequire(bundlePath);
  const builtins = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises", "http", "https", "module", "net", "os", "path", "process", "stream", "stream/promises", "string_decoder", "tty", "url", "util", "zlib"]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, p, q, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return p + q + "node:" + spec + close;
    const resolved = req.resolve(spec);
    return p + q + new URL("file://" + resolved.replaceAll("\\", "/")).href + close;
  });
  return import("data:text/javascript;base64," + Buffer.from(transformed).toString("base64"));
}

function safe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

function feesFromProfile(profile) {
  const rounds = BigInt(profile.appealRounds ?? 1);
  const rotation = BigInt(profile.rotationsPerRound ?? 3);
  return {
    leaderTimeunitsAllocation: BigInt(profile.leaderTimeunitsAllocation),
    validatorTimeunitsAllocation: BigInt(profile.validatorTimeunitsAllocation),
    appealRounds: rounds,
    executionBudgetPerRound: BigInt(profile.executionBudgetPerRound),
    totalMessageFees: BigInt(profile.totalMessageFees ?? 0),
    rotations: Array.from({ length: Number(rounds) + 1 }, () => rotation),
    maxPriceGenPerTimeUnit: 2n,
    storageFeeMaxGasPrice: 300000000n,
    receiptFeeMaxGasPrice: 300000000n,
    transactionHashVariant: "latest-nonfinal",
  };
}

function terminal(receipt) {
  return {
    status: receipt.statusName ?? receipt.status_name ?? receipt.status ?? null,
    consensus: receipt.resultName ?? receipt.result_name ?? receipt.consensusStatus ?? receipt.consensus_status ?? null,
    execution: receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? receipt.txExecutionResult ?? null,
  };
}

const { createClient2, studioDevnet, BaseAction } = await loadSdk();
const action = new BaseAction();
action.accountOverride = ACTOR_NAME;
const account = await action.getAccount(false);
const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
  client.request({ method: "eth_chainId" }),
  client.request({ method: "eth_getBalance", params: [account.address, "latest"] }),
  client.request({ method: "eth_getTransactionCount", params: [account.address, "latest"] }),
  client.request({ method: "eth_getTransactionCount", params: [account.address, "pending"] }),
]);
const profile = JSON.parse(await readFile(PROFILE, "utf8"));
if (profile.chainId !== CHAIN_ID || !profile.deploy) throw new Error("invalid measured fee profile");
const args = [account.address, AMOUNT];
const feeOptions = feesFromProfile(profile.deploy);
const fees = await client.estimateTransactionFeesForWrite({
  account, address: DEMO, functionName: "execute_outflow", args, ...feeOptions,
});
const simulation = await client.simulateWriteContract({
  account, address: DEMO, functionName: "execute_outflow", args,
  fees, includeReceipt: true, transactionHashVariant: "latest-nonfinal",
});
console.log(JSON.stringify({
  network: "studio-dev",
  rpc: RPC,
  chainId: Number.parseInt(chainIdHex, 16),
  owner: OWNER,
  secondaryTestActor: { alias: ACTOR_NAME, address: account.address },
  balanceWei: BigInt(balanceHex).toString(),
  latestNonce: Number.parseInt(latestHex, 16),
  pendingNonce: Number.parseInt(pendingHex, 16),
  method: "execute_outflow",
  args: safe(args),
  calldata: "official SDK calldata supplied by write/simulation path",
  fees: safe(fees),
  simulation: terminal(simulation.receipt || {}),
}, null, 2));
