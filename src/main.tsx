import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { useApp } from "./state/store";
import { journalNow, startJournal } from "./features/recovery/journal";
import { useCursor } from "./features/viewer/cursor";

// hooks for the browser tests: read the state (and where the pointer is), and write the crash journal without waiting a minute
(window as unknown as { __drawset: unknown }).__drawset = { useApp, journalNow, useCursor };

startJournal();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
