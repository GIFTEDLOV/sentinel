/**
 * Immutable public facts for the active hardened Studio Next proof.
 * Runtime reads remain authoritative; legacy proof is kept separate below.
 */
export const FINAL_DEPLOYMENT = {
  label: "ACTIVE HARDENED DEPLOYMENT",
  version: "Sentinel v2",
  authBoundaryVersion: "Authentication Boundary v1",
  network: "Studio Next",
  chainId: 61997,
  rpcUrl: "https://studio-next.genlayer.com/api",
  sentinelAddress: "0xeA6d5350929d0F3cc80f5f3f9533515C690a3952",
  protectedDemoAddress: "0xdFb4f6Fc4570B04A198b484aa6175025882c7c21",
  protocolId: "sentinel-demo",
  incidentId: "incident-hardened-v1-r2-20260917",
  failureClass: "unauthorized-drain",
  sourceHashes: {
    sentinel: "55A33D31B473BC61384EDDC723C15B378ABF9668C9A2760CB79438F3AA0A1ED8",
    protectedDemo: "7D684E6CA326981018ED63EECC4EEC8C6C4D1B8FF91BC20037E2BA38175FCFBD",
  },
  owner: "0xb1e3ea743df2b006b66751d57337c2bb10e23ecc",
  controlledSecondary: "0x6311de989ab01ae4da77d36cc45d495fbcd4b7a8",
  policy: { minimumSources: 2, maxEvidenceAgeSeconds: 3600, recoveryCooldownSeconds: 900, locked: true },
  evidenceIds: {
    incidentChain: "chain-3acb12cf3e16-20260917",
    incidentAdvisory: "advisory-incident-hardened-v1-r2-20260917",
    recoveryChain: "recovery-chain-fa81e65be38f",
    recoveryAdvisory: "advisory-recovery-hardened-v1-r2-20260917",
  },
  incidentAdvisory: {
    url: "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/incident-hardened-v1-r2-20260917.json",
    commit: "556820c622a005831bb974783d22e530203a641e",
    digest: "44958a8f2cd0e6b2279efbb35d1c7fe787fd6e207ff002d0068581abbb891ab0",
  },
  recoveryAdvisory: {
    url: "https://raw.githubusercontent.com/GIFTEDLOV/sentinel-evidence/main/evidence/advisories/recovery-hardened-v1-r2-20260917.json",
    commit: "556820c622a005831bb974783d22e530203a641e",
    digest: "afb42dc168491682b3874efd97609acb5e8a7f4e79e1feac556e00e335259788",
  },
  deployment: {
    protectedDemo: "0xedf828b7c65d97f0f55d49a9d24a0e137f83f5164eec5cb92734fa186d2bb4d6",
    sentinel: "0x19743a9c8d9a268f71f096e442cd8e3ba489aae37b5c8ba1956b10a99b5769c4",
    controllerConfiguration: "0x5f981b2319ad9a6df570f9924d429dafcc381c80563a23e240bf43f047baebae",
    registration: "0x697971e306f4fd31ac829f28cab60e837498daf09a74d61b63d15d793f4822bd",
    policyLock: "0x3d9350abbf5f153a92a4d19bf7157bf3039e4b7c4752e77471124cf61b732533",
  },
  proof: {
    incidentCreate: "0x9fd456a229f79cc7f4004c6e15220ed5069340d73c609a3b3663004a5d742aa1",
    outflow: "0x3acb12cf3e16bda98bc7ecb95aa0e64a3dfa13005bcdc3dd3ab94414a9d1948d",
    incidentAssessment: "0xae3ec6b3b3f54d73712cc770ef16448627ca2063c16c0b3b1df103eeb57edf96",
    pause: "0xf20a61a3e50a74aa27249f1b40762424418ccf99d2352a5fd56e0b4caf58ee40",
    pauseConfirmation: "0x28682d83e4dd5b6eb89c2d2a3bf598839c9b74d8f48ff7959e0ee0d7a89005ba",
    remediation: "0xfa81e65be38f4fd772f5b2319f4b9a63cd67bc7e669c10eb4b2599ae511eb94f",
    beginRecovery: "0x3d526d6eeff2058e4a746c64021d59acadc2966bffd3252c76809bee13cbf7fc",
    recoveryAssessment: "0x1c6226bb5dca01d1df5536aa5ffa9acddab7bd538cbabdba6b8e76664cdb85ea",
    unpause: "0xeca5cb57f3aa3e34fc1837db772b66d843991a3d1c2a1b735de6b9b6603f4c3d",
    recoveredConfirmation: "0xdef1cf59a7c262a17455de67295e9443230d2304fe548f93351a3f49ed92a619",
    postRecoveryProcess: null,
  },
  decisions: {
    incident: {
      assessmentId: "incident-hardened-v1-r2-20260917:incident:1",
      questionVersion: "INCIDENT_ASSESSMENT_V1",
      decisionInputHash: "454abba089fbdfbb557e184deee526e122f445aa052772aeb5e11045fbbb3c5b",
      localHash: "454abba089fbdfbb557e184deee526e122f445aa052772aeb5e11045fbbb3c5b",
      verdict: "ACTIVE_INCIDENT",
      resultingState: "ACTIVE_INCIDENT",
    },
    recovery: {
      assessmentId: "incident-hardened-v1-r2-20260917:recovery:1",
      questionVersion: "RECOVERY_ASSESSMENT_V1",
      decisionInputHash: "6d4579774e0fd0366d74cc9d35eb7da1e8505807b5087d2e0133debcdd872403",
      localHash: "6d4579774e0fd0366d74cc9d35eb7da1e8505807b5087d2e0133debcdd872403",
      verdict: "SAFE_TO_RECOVER",
      resultingState: "RECOVERY_AUTHORIZED",
    },
  },
  authentication: {
    blockedProof: { incidentId: "incident-hardened-v1-mu5x1g4z", blockCode: "SOURCE_UNAVAILABLE", semanticAssessmentInvoked: false, approvalProduced: false },
    incident: { state: "VERIFIED", sourceCount: 2, freshCount: 2, distinctCount: 2 },
    recovery: { state: "VERIFIED", sourceCount: 2, freshCount: 2, distinctCount: 2 },
  },
  finalReadback: {
    incidentState: "RECOVERED", incidentVerdict: "ACTIVE_INCIDENT", recoveryVerdict: "SAFE_TO_RECOVER",
    targetPaused: false, targetRemediated: true, treasury: 900, totalOutflow: 100, totalProcessed: 2,
    pauseCount: 1, unpauseCount: 1,
    incidentEvidence: { bound: 2, authenticated: 2, fresh: 2, distinct: 2 },
    recoveryEvidence: { bound: 2, authenticated: 2, fresh: 2, distinct: 2 },
  },
  explorerBaseUrl: "https://explorer-studio.genlayer.com/tx/",
} as const;

/** Immutable historical proof. Never selected by sentinelClientConfig. */
export const LEGACY_DEPLOYMENT = {
  label: "LEGACY DEPLOYMENT / HISTORICAL PROOF",
  network: "Studio Next",
  chainId: 61997,
  sentinelAddress: "0xd83b20EcCF5c1Ddd70aD57EF0E25a5200079c4de",
  protectedDemoAddress: "0xDf9635A1E13379b2F7c25166aAE1C29729b3bFDA",
  protocolId: "sentinel-demo",
  incidentId: "incident-e5115f160d64",
  finalState: "RECOVERED",
} as const;

export type FinalDeployment = typeof FINAL_DEPLOYMENT;
