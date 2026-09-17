import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

const ROOT = "C:/Users/DELL/Sentinel";
const RPC = "https://studio-next.genlayer.com/api";
const SENTINEL = "0x8e7B0387F1C527d0cd14cCA9E76420952B5B483c";
const INCIDENT = "incident-studio-next-v4-mu1ocbh7";
const EVIDENCE_IDS = ["chain-50de89d7215d", "advisory-incident-mu1ocbh7"];
const OUT = `${ROOT}/deploy/evidence/final-v4/runtime-diagnosis`;

function safe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const source = await readFile(`${ROOT}/contracts/sentinel.py`);
  const chain = {
    ...studioDevnet,
    id: 61997,
    name: "GenLayer Studio Next",
    rpcUrls: { default: { http: [RPC] } },
  };
  const client = createClient({ chain, endpoint: RPC });
  const codeResponse = await client.request({ method: "gen_getContractCode", params: [SENTINEL] });
  const deployedCode = Buffer.from(codeResponse, "base64");
  const rawStateRequest = { jsonrpc: "2.0", id: 1, method: "gen_getContractState", params: [SENTINEL] };
  let rawStateResponse;
  try {
    rawStateResponse = await client.request({ method: rawStateRequest.method, params: rawStateRequest.params });
  } catch (error) {
    rawStateResponse = { error: String(error) };
  }
  await writeFile(`${OUT}/gen_getContractState_response.json`, JSON.stringify(safe(rawStateResponse), null, 2) + "\n", "utf8");

  const read = async (variant, functionName, args = []) => {
    try {
      return await client.readContract({ address: SENTINEL, functionName, args, transactionHashVariant: variant, jsonSafeReturn: true });
    } catch (error) {
      return { error: String(error) };
    }
  };
  const variants = {};
  for (const variant of ["latest-final", "latest-nonfinal"]) {
    variants[variant] = {
      incident: await read(variant, "get_incident", [INCIDENT]),
      chainEvidence: await read(variant, "get_evidence", [EVIDENCE_IDS[0]]),
      advisoryEvidence: await read(variant, "get_evidence", [EVIDENCE_IDS[1]]),
      policy: await read(variant, "get_protocol", ["sentinel-demo"]),
      state: await read(variant, "get_state", []),
    };
  }
  const snapshot = {
    network: "Studio Next",
    rpc: RPC,
    chainId: 61997,
    sentinel: SENTINEL,
    incident: INCIDENT,
    evidenceIds: EVIDENCE_IDS,
    deployedCode: {
      bytes: deployedCode.length,
      sha256: createHash("sha256").update(deployedCode).digest("hex").toUpperCase(),
    },
    rawStateRpc: rawStateResponse,
    variants,
  };
  await writeFile(`${OUT}/V4_FINAL_STATE_SNAPSHOT.json`, JSON.stringify(safe(snapshot), null, 2) + "\n", "utf8");
  console.log(JSON.stringify(safe(snapshot), null, 2));
}

await main();
