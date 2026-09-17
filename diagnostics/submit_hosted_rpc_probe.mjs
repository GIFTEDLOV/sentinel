import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const RPC = "https://studio-dev.genlayer.com/api";
const EXPECTED_CHAIN_ID = 61997;
const EXPECTED_ACCOUNT = "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc";
const DIAGNOSTIC = "0x689129b4B2f3Df4D6764C9D5E04480AaC4Ca689A";
const TARGET_HASH = "0x101816026d41441709293b7f946963dd894262bdedc88a788ea934290ffc5099";

// The published CLI bundle contains the current GenLayerJS implementation used
// by the installed CLI, but only exports the CLI entry point. Load that exact
// implementation in memory while exposing its SDK client for this typed call.
// No installed package file is modified.
async function loadInstalledSdk() {
  const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
  const source = await readFile(bundlePath, "utf8");
  const lastInit = source.lastIndexOf("initializeCLI();");
  if (lastInit < 0) throw new Error("installed CLI initializer not found");
  let transformed = source.slice(0, lastInit) + source.slice(lastInit + "initializeCLI();".length);
  const bundleFileUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
  transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleFileUrl)}).href`);
  transformed = transformed.replace(
    /export \{\s*initializeCLI\s*\};\s*$/m,
    "export { createClient2, studioDevnet, BaseAction };"
  );
  if (!transformed.includes("export { createClient2, studioDevnet, BaseAction };")) {
    throw new Error("installed SDK export seam not found");
  }

  const requireFromBundle = createRequire(bundlePath);
  const builtins = new Set([
    "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises",
    "http", "https", "module", "net", "os", "path", "process", "stream",
    "stream/promises", "string_decoder", "tty", "url", "util", "zlib"
  ]);
  transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
    if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
    if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
    const resolved = requireFromBundle.resolve(spec);
    return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

const { createClient2, studioDevnet, BaseAction } = await loadInstalledSdk();
const account = await new BaseAction().getAccount(false);
if (account.address.toLowerCase() !== EXPECTED_ACCOUNT) {
  throw new Error(`unexpected signing account ${account.address}`);
}

const client = createClient2({ chain: studioDevnet, endpoint: RPC, account });
await client.initializeConsensusSmartContract();

const [chainIdHex, balanceHex, latestHex, pendingHex] = await Promise.all([
  client.request({ method: "eth_chainId" }),
  client.request({ method: "eth_getBalance", params: [EXPECTED_ACCOUNT, "latest"] }),
  client.request({ method: "eth_getTransactionCount", params: [EXPECTED_ACCOUNT, "latest"] }),
  client.request({ method: "eth_getTransactionCount", params: [EXPECTED_ACCOUNT, "pending"] })
]);
const chainId = Number.parseInt(chainIdHex, 16);
const latestNonce = Number.parseInt(latestHex, 16);
const pendingNonce = Number.parseInt(pendingHex, 16);
if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`unexpected chain id ${chainId}`);
if (latestNonce !== pendingNonce) throw new Error(`nonce mismatch latest=${latestNonce} pending=${pendingNonce}`);

const feeEstimate = await client.estimateTransactionFeesForWrite({
  account,
  address: DIAGNOSTIC,
  functionName: "probe_transaction",
  args: [TARGET_HASH],
  leaderTimeunitsAllocation: 200n,
  validatorTimeunitsAllocation: 400n,
  appealRounds: 1n,
  executionBudgetPerRound: 157789000000000n,
  totalMessageFees: 0n,
  rotations: [3n, 3n],
  maxPriceGenPerTimeUnit: 2n,
  storageFeeMaxGasPrice: 300000000n,
  receiptFeeMaxGasPrice: 300000000n,
  transactionHashVariant: "latest-nonfinal"
});

const originalSendRaw = client.sendRawTransaction.bind(client);
let evmHashAtSubmission = null;
client.sendRawTransaction = async (args) => {
  const hash = await originalSendRaw(args);
  evmHashAtSubmission = hash;
  console.log(JSON.stringify({ event: "BROADCAST_RETURNED", evmHash: hash }));
  return hash;
};

const txHash = await client.writeContract({
  account,
  address: DIAGNOSTIC,
  functionName: "probe_transaction",
  args: [TARGET_HASH],
  fees: feeEstimate
});

console.log(JSON.stringify({
  event: "SUBMITTED",
  txHash,
  evmHashAtSubmission,
  network: "studio-dev",
  rpc: RPC,
  chainId,
  account: account.address,
  balanceWei: BigInt(balanceHex).toString(),
  latestNonce,
  pendingNonce,
  feeEstimate
}, (_, value) => typeof value === "bigint" ? value.toString() : value));
