import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "@genlayer/transaction-kit-react/styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Sentinel root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
