/**
 * Immutable public facts for the completed Studio Next proof.
 * This file is display configuration only; chain reads remain authoritative.
 */
export const FINAL_DEPLOYMENT = {
  network: "Studio Next",
  chainId: 61997,
  rpcUrl: "https://studio-next.genlayer.com/api",
  sentinelAddress: "0xd83b20EcCF5c1Ddd70aD57EF0E25a5200079c4de",
  protectedDemoAddress: "0xDf9635A1E13379b2F7c25166aAE1C29729b3bFDA",
  protocolId: "sentinel-demo",
  incidentId: "incident-e5115f160d64",
  failureClass: "unauthorized-drain",
  sourceHashes: {
    sentinel: "49E50797E3201B09F9EABDBF21EDF61C532887687E049CC6371E63BCF0BE45ED",
    protectedDemo: "7D684E6CA326981018ED63EECC4EEC8C6C4D1B8FF91BC20037E2BA38175FCFBD",
  },
  owner: "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc",
  controlledSecondary: "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8",
  policy: {
    minimumSources: 2,
    maxEvidenceAgeSeconds: 3600,
    recoveryCooldownSeconds: 900,
    locked: true,
  },
  incidentAdvisory: {
    url: "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-incident-e5115f160d64.json",
    commit: "d1bcb30e825a2c486220de2a0f4d5c7b648b7be3",
    digest: "62464982faddd34e5eff54c14e14a5cf9cac654ffa679cd96d61e7fd74c55fce",
  },
  recoveryAdvisory: {
    url: "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/recovery-incident-e5115f160d64.json",
    commit: "a8b163bd518ed100c317e1283a43db42c6bb8beb",
    digest: "3ba3cfbbbc6206d3cadd5cb9830a87edf19363809716136e6db320ed2d7cf0f6",
  },
  evidenceIds: {
    incidentChain: "chain-e5115f160d64",
    incidentAdvisory: "advisory-e5115f160d64",
    recoveryChain: "recovery-chain-f5fbf8f49461",
    recoveryAdvisory: "recovery-advisory-f5fbf8f49461",
  },
  explorerBaseUrl: "https://explorer-studio.genlayer.com/tx/",
  proof: {
    incidentCreate: "0x3bf4873ec650f6ec11316228c3de53d83eda5c691db93121f8256b53b313ca3c",
    outflow: "0xe5115f160d6450567949b567dd1638417af2f94bf55a738ba5714c783a8da860",
    incidentAssessment: "0x2e71cecc511fb58f9a589602b8632927c7d643158e8b553946a00ba61a9ec312",
    pause: "0x4b4ba831d175884abb17f171671f5ec52a84655cd60c65204886421fe5f9f2c6",
    pauseConfirmation: "0x8ef13d9952fbc4a71221dc23c26368c260334ad11c8b28b671e480e65e6e4c54",
    remediation: "0xf5fbf8f4946122c04b433e290141a6688996c58192c40ac3d66dd3b221e82fa9",
    beginRecovery: "0x530b57a033cbcc8ab5fc1d1a311d1a2b0e110bc11329566d2b33095fbf7bf304",
    recoveryAssessment: "0x9b3e4d5f11ed8a62cc24991f472c25afa0930f70e46f6b17f4bd4ec3b6dee809",
    unpause: "0x801ffc548ca5da17355207685c4a927faef8350891796fd87b3b013f13247f88",
    recoveredConfirmation: "0x800d8c285cc06f32a07a439adfae6ecd29d9cf54893e35ee120beead20a37f0b",
    postRecoveryProcess: "0x79a8f5121765db195bac15797a39ed088730bf47cd817ac6465a1ffeccf7fc9e",
  },
  finalReadback: {
    incidentState: "RECOVERED",
    incidentVerdict: "ACTIVE_INCIDENT",
    recoveryVerdict: "SAFE_TO_RECOVER",
    targetPaused: false,
    targetRemediated: true,
    treasury: 900,
    totalOutflow: 100,
    totalProcessed: 2,
    pauseCount: 1,
    unpauseCount: 1,
    incidentEvidence: { bound: 2, authenticated: 2, fresh: 2, distinct: 2 },
    recoveryEvidence: { bound: 2, authenticated: 2, fresh: 2, distinct: 2 },
  },
} as const;

export type FinalDeployment = typeof FINAL_DEPLOYMENT;
