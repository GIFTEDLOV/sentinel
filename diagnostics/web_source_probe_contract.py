# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import hashlib
import typing

import genlayer as gl


class WebSourceProbe(gl.contract.Contract):
    @gl.public.write
    def fetch(self, url: str) -> typing.Any:
        def leader() -> typing.Any:
            response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
            body = response.body or b""
            return {
                "status": response.status,
                "body_bytes": len(body),
                "body_sha256": hashlib.sha256(body).hexdigest(),
                "header_names": sorted(response.headers.keys()),
            }

        return gl.vm.run_nondet(leader, lambda _result: True)
