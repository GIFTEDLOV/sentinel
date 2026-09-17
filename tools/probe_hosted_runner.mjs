import { readFile } from "node:fs/promises";

const RPC = "https://studio-next.genlayer.com/api";
const hashes = [
  "9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0",
  "1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
  "5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng",
  "1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh",
];
const sourcePaths = ["contracts/sentinel.py", "contracts/protected_demo.py"];

async function rpc(method, params) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const body = await response.json();
  return { httpStatus: response.status, body };
}

for (const hash of hashes) {
  for (const path of sourcePaths) {
    const original = await readFile(path, "utf8");
    const source = original.replace(/^# \{ "Depends": "py-genlayer:[^\"]+" \}\r?\n/, `# { "Depends": "py-genlayer:${hash}" }\n`);
    const result = await rpc("gen_getContractSchemaForCode", [source]);
    const error = result.body?.error;
    const methods = result.body?.result?.methods ? Object.keys(result.body.result.methods).sort() : [];
    console.log(JSON.stringify({ hash, path, httpStatus: result.httpStatus, ok: !error, error: error ? { code: error.code, message: error.message, data: error.data ? String(error.data).slice(0, 500) : undefined } : undefined, methods }));
  }
}
