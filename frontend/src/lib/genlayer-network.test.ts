import { describe, expect, it } from "vitest";
import { createGenLayerNetworkConfig, genLayerNetwork, SHARED_GENLAYER_CHAIN } from "./genlayer-network";

describe("Studio Next network coordination", () => {
  it("uses the final Studio Next defaults", () => {
    expect(genLayerNetwork.chain).toBe(SHARED_GENLAYER_CHAIN);
    expect(SHARED_GENLAYER_CHAIN.id).toBe(61997);
    expect(SHARED_GENLAYER_CHAIN.name).toBe("GenLayer Studio Next");
    expect(SHARED_GENLAYER_CHAIN.rpcUrls.default.http).toEqual(["https://studio-next.genlayer.com/api"]);
    expect(SHARED_GENLAYER_CHAIN.nativeCurrency.symbol).toBe("GEN");
  });

  it("derives wallet metadata from the same chain definition", () => {
    const config = createGenLayerNetworkConfig({
      chainId: "61997",
      chainName: "GenLayer Studio Next",
      rpcUrl: "https://studio-next.genlayer.com/api",
      symbol: "GEN",
    });
    expect(config.wallet.chainId).toBe("0xF22D");
    expect(config.wallet.rpcUrls).toEqual(config.chain.rpcUrls.default.http);
    expect(config.wallet.nativeCurrency).toEqual(config.chain.nativeCurrency);
  });
});

