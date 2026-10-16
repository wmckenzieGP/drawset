import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { useApp } from "./state/store";

// read-only hook for the browser tests
(window as unknown as { __drawset: unknown }).__drawset = { useApp };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
