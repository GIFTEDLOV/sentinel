# Sentinel Studio-dev validation summary

This is the canonical v2 Studio-dev validation record. Historical v1 and
Bradbury artifacts remain in this directory for audit history and are not the
deployment identity used below.

## Network and source

- Network: `studio-dev`
- RPC: `https://studio-dev.genlayer.com/api`
- Chain ID: `61997`
- Hosted GenVM observed: `v0.3.0-rc7-x86_64-linux-release`
- Runner: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`
- Sentinel SHA-256: `81E19727F469365D2EBADD5EAEF1C855C335A016D7389928EEA86A7F7319D4EA`
- ProtectedDemo SHA-256: `AA6AE78F77FD2549EE89E6D0FCA0198F69168DAB933EADC4A15B435299E4D1DD`

Canonical deployed addresses:

- Sentinel: `0x5a965B5089878fB1DE519001350eb33664eb6995`
- ProtectedDemo: `0xC786C9a28997cdD42483A45Bc60961D673a36969`

Both deployed source parity records report `HASH_PARITY: PASS` and
`BYTE_FOR_BYTE_PARITY: PASS`.

## Local gates

- `python -m pytest -q`: **15 passed**
- `genvm-lint check`: **PASS** for both contracts
- `genvm-lint typecheck --strict`: **PASS** for both contracts using the
  cached v0.6 standard library
- `genvm-lint schema`: **PASS** for both contracts
- Hosted `gen_getContractSchemaForCode`: **PASS** for both contracts
- `git diff --check`: **PASS**

## Finalized deployment and configuration

| Operation | GenLayer transaction | Result |
| --- | --- | --- |
| ProtectedDemo deployment | `0x56ad4259b8ae22b73ae2512cfaee86f4b41b901cb9e24b73296a38e5a9aec05d` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Sentinel deployment | `0x92b395ea0c75702591eab2d498ccb4fa89a38db759b493f6a6102607e1f9621a` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Controller configuration | `0xbc4411045868887013fd79e99ad97f5db80fab917443000867daa9421af5c735` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Baseline `process(7)` | `0x0957b0277a1c212803b99304bfcf25f4bc53ca18d487d39605374dfd7bf3966d` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Protocol registration | `0x8e1285338cbbdca95b972bdc1776638e91d9e947d1e530d0aaa4a12222c9d453` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Policy lock | `0xa127ea56d1fa7431efaaed6d3a1e7ec1f15e20174d52a93fe9c43b42069a05ca` | `FINALIZED`, `FINISHED_WITH_RETURN` |

ProtectedDemo readback confirmed the deployed Sentinel address, controller
configuration, and `paused == false` before the live proof.

## Positive incident proof

Protocol: `studio-v2-demo`  
Incident: `studio-v2-positive-20260911`  
Evidence: `v2-httpbin`, `v2-httpbingo`

| Step | GenLayer transaction | Result/readback |
| --- | --- | --- |
| Open incident | `0xa0af732ce9da8a5c6ad969744d3b286a6e866a04f4c4354551206cb65a2f82b7` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Bind HTTPBin evidence | `0xbe76544ee4a784678719cf6ebaf63c05598c311f4d2f0aa8801ea0a95c841984` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Bind HTTPBingo evidence | `0x24411c6ea72ace04d685da7b7a1c3c8b1694984b16aab4f977a0d665366f48c2` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Assess incident | `0x10fe09699313fd07f571447f2ac5a47e9a3d5df81eb26b545660c42d47191c5f` | `FINALIZED`, `FINISHED_WITH_RETURN`; stored `ACTIVE_INCIDENT` |
| Execute pause parent | `0xf8c9c4a2019a2877bb3171db3998055ae3c91ea2885e7274802e582b93bc58b5` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Target pause child | `0x3dfae31ef88e4fbc887e813dbd869352f9a2e06e9726362124e04cebccc55071` | `FINALIZED`, `FINISHED_WITH_RETURN`; `is_paused == true` |
| Confirm pause | `0xb2baa953f764103aa9685d01094b27aebd562c81b6a722e2f849818d3fdc70ec` | `FINALIZED`, `FINISHED_WITH_RETURN`; Sentinel `PAUSED` |
| Blocked `process(1)` | `0x8bc3849e8b3516e0d8af624984eb319f520b80e1eb84aafdc0040bfd627c39bc` | `FINALIZED`, `FINISHED_WITH_ERROR`: `Protected protocol is paused` |

Assessment receipts exposed five validators and a finalized majority result;
the recorded vote set was `[AGREE, AGREE, DISAGREE, DISAGREE, AGREE]`.

## Negative fail-closed proof

Incident: `studio-v2-negative-20260912`  
Evidence: `v2-negative-httpbin`, `v2-negative-httpbingo`  
Defect: authenticated evidence target mismatch.

- Open incident: `0xae46db0b096fef11eac2b7f23d8e9df14004cf80015179901cf551f0fc6fccac`
- Bind HTTPBin: `0x28768021843e289ed32a9b0daac7690c1f6d02721d732495fcb0d3b011ac42c4`
- Bind HTTPBingo: `0x907f3ccfbd4eba172c355a76feef7be38b5c29f6d5dcd5e99bcf4a5aebdef64c`
- Assess: `0x5ee4d3cf0da9407c3b03b0428cf61294562d7856981aa13243c4145fcbdfc0c9`
- Assessment result: `FINALIZED`, `FINISHED_WITH_RETURN`; stored verdict `INCONCLUSIVE`
- Target readback: `is_paused == false`; `pause_requested == false`

## Recovery proof

The positive incident used fresh recovery evidence `v2-recovery3-httpbin`
and `v2-recovery3-httpbingo`.

| Step | GenLayer transaction | Result/readback |
| --- | --- | --- |
| Begin recovery | `0x0c5c4b5310a9e5c634b84f4de3053b127da9978121be10358b891e4753dd7993` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Bind HTTPBin recovery evidence | `0xf280a44d39a1309013c7e3e791b87bdd3b0f4c2de0259591329f9c7cd24b2556` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Bind HTTPBingo recovery evidence | `0x28cd3872c1312d13313d02e6e09b67866aee7c6b850809ef5081f6837bb36ac9` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Assess recovery | `0xfdd2585085cb4888b59762d35dca11c10fb74a22df4e554da94a62943deb09c9` | `FINALIZED`, `FINISHED_WITH_RETURN`; stored `SAFE_TO_RECOVER` |
| Execute unpause parent | `0x6bf610a12e3f36138ec9b5643a21763ea40fa838fb81abb8cde4928b77abbcb8` | `FINALIZED`, `FINISHED_WITH_RETURN` |
| Target unpause child | `0xa0d00fe930ce06dae61c05b4e18a75e9b741c319b8ce17d98bbb0a7174a46a8b` | `FINALIZED`, `FINISHED_WITH_RETURN`; `is_paused == false` |
| Confirm recovered | `0x42d24484ea4f4893dc180d7ba60fd225f2920adf614e566aa4271c80f1452ff5` | `FINALIZED`, `FINISHED_WITH_RETURN`; Sentinel `RECOVERED` |
| Restored `process(1)` | `0x142b6aed2c8b0ebaf04271299520b158dce559ae80407ff8b4ab21e5b9514e3a` | `FINALIZED`, `FINISHED_WITH_RETURN`; total processed `8` |

Recovery assessment exposed five validators and a finalized majority result;
the recorded vote set was `[AGREE, AGREE, DISAGREE, AGREE, DISAGREE]`.

## Final readback

- Controller: exact deployed Sentinel address
- Policy: locked
- Positive incident: `RECOVERED`, incident verdict `ACTIVE_INCIDENT`, recovery
  verdict `SAFE_TO_RECOVER`
- Negative incident: `ASSESSING`, verdict `INCONCLUSIVE`, no pause requested
- ProtectedDemo: unpaused
- ProtectedDemo total processed: `8`

The complete transaction-level receipts and readbacks are in this directory.
