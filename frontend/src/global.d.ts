import type { Eip1193Provider } from "./lib/genlayer-client";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export {};
