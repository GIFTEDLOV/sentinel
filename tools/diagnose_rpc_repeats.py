import json
import time
import urllib.request
from pathlib import Path

RPC = "https://studio-dev.genlayer.com/api"
TX = "0x741e5d6406466dfbc9bd7c54ef633c062606047240a790b037bcf7cf5dcbd19f"
OUT = Path(r"C:\Users\DELL\Sentinel\deploy\evidence\final-v2\NONDET_RPC_REPEATS.json")

responses = []
for _ in range(5):
    request = {"jsonrpc": "2.0", "method": "eth_getTransactionByHash", "params": [TX], "id": 1}
    http = urllib.request.Request(RPC, data=json.dumps(request).encode(), headers={"content-type": "application/json", "User-Agent": "genlayer-js/0.6"})
    with urllib.request.urlopen(http, timeout=30) as stream:
        responses.append(json.load(stream))
    time.sleep(0.25)

results = [response.get("result", {}) for response in responses]
def get(result, key):
    return result.get(key)

used = {}
for key in ["hash", "sender", "from_address", "origin_address", "recipient", "to_address", "status", "txExecutionResultName", "result_name", "created_timestamp", "created_at", "current_timestamp"]:
    values = [get(result, key) for result in results]
    used[key] = {"values": values, "stable": all(value == values[0] for value in values)}
data_values = [(result.get("data") or {}).get("calldata") for result in results]
used["data.calldata"] = {"values": data_values, "stable": all(value == data_values[0] for value in data_values)}

top_keys = [sorted(result.keys()) for result in results]
summary = {
    "rpc": RPC,
    "transaction_hash": TX,
    "call_count": len(responses),
    "top_level_keys_identical": all(keys == top_keys[0] for keys in top_keys),
    "top_level_keys": top_keys[0],
    "fields_used_by_sentinel": used,
    "raw_responses": responses,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": str(OUT), "call_count": 5, "top_level_keys_identical": summary["top_level_keys_identical"], "fields_used_by_sentinel": used}, indent=2))
