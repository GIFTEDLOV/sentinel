import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const bundlePath = "C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/dist/index.js";
const source = await readFile(bundlePath, "utf8");
const marker = "initializeCLI();";
const end = source.lastIndexOf(marker);
if (end < 0) throw new Error("GenLayer CLI initializer not found");
let transformed = source.slice(0, end) + source.slice(end + marker.length);
const bundleUrl = new URL(`file://${bundlePath.replaceAll("\\", "/")}`).href;
transformed = transformed.replaceAll("import.meta.url", `new URL(${JSON.stringify(bundleUrl)}).href`);
transformed = transformed.replace(/export \{\s*initializeCLI\s*\};\s*$/m, "export { createClient2, studioDevnet, BaseAction, isSuccessful };");
transformed = transformed.replaceAll("fs2.chmodSync(this.folderPath, 448);", "try { fs2.chmodSync(this.folderPath, 448); } catch {};");
transformed = transformed.replaceAll("fs2.chmodSync(this.keystoresPath, 448);", "try { fs2.chmodSync(this.keystoresPath, 448); } catch {};");
const requireFromBundle = createRequire(bundlePath);
const builtins = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "fs/promises",
  "http", "https", "module", "net", "os", "path", "process", "stream",
  "stream/promises", "string_decoder", "tty", "url", "util", "zlib",
]);
transformed = transformed.replace(/(from\s+|import\(\s*)(["'])([^"']+)(\2)/g, (all, prefix, quote, spec, close) => {
  if (spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) return all;
  if (builtins.has(spec)) return `${prefix}${quote}node:${spec}${close}`;
  const resolved = requireFromBundle.resolve(spec);
  return `${prefix}${quote}${new URL(`file://${resolved.replaceAll("\\", "/")}`).href}${close}`;
});
const sdk = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
for (const alias of ["beacon-final-deployer", "player2"]) {
  const action = new sdk.BaseAction();
  action.accountOverride = alias;
  const account = await action.getAccount(false);
  console.log(JSON.stringify({ alias, address: account.address, hasWaitForDecision: typeof sdk.createClient2({ chain: sdk.studioDevnet, endpoint: "https://studio-next.genlayer.com/api", account }).waitForDecision === "function", hasWaitForFinalization: typeof sdk.createClient2({ chain: sdk.studioDevnet, endpoint: "https://studio-next.genlayer.com/api", account }).waitForFinalization === "function", hasIsSuccessful: typeof sdk.isSuccessful === "function" }));
}
