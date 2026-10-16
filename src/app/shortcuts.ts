import { useEffect } from "react";
import { useApp, type ToolId } from "../state/store";
import { useInteraction } from "../features/viewer/controller";
import { openPrintDialog } from "../features/print/PrintDialog";
import { cmd, setTool } from "./commands";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  h: "pan",
  z: "zoom",
  t: "text",
  r: "rectangle",
  e: "ellipse",
  l: "line",
  a: "arrow",
  n: "polyline",
  p: "polygon",
  c: "cloud",
  f: "pen",
  g: "highlighter",
  x: "textbox",
  q: "callout",
  o: "note",
  i: "highlight",
  u: "underline",
  k: "strikeout",
  s: "stamp",
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const ctrl = e.ctrlKey || e.metaKey;
      const tag = target?.tagName;
      const inputType = tag === "INPUT" ? (target as HTMLInputElement).type : "";
      // text fields keep their own keys; lists, sliders and tick boxes still pass Ctrl shortcuts (undo, save) through
      const textEntry = !!target && (tag === "TEXTAREA" || target.isContentEditable || (tag === "INPUT" && !["range", "checkbox", "radio", "button", "color"].includes(inputType)));
      const control = tag === "SELECT" || (tag === "INPUT" && !textEntry);
      if (textEntry || (control && !ctrl) || useInteraction.getState().editingId) return;
      const k = e.key.toLowerCase();
      const run = (fn: () => unknown) => {
        e.preventDefault();
        fn();
      };
      if (ctrl) {
        if (k === "o") return run(cmd.open);
        if (k === "s" && e.shiftKey) return run(cmd.saveCopy);
        if (k === "s") return run(cmd.save);
        if (k === "p") return run(openPrintDialog);
        if (k === "w") return run(cmd.close);
        if (k === "z" && e.shiftKey) return run(cmd.redo);
        if (k === "z") return run(cmd.undo);
        if (k === "y") return run(cmd.redo);
        if (k === "c") return run(cmd.copy);
        if (k === "v") return run(cmd.paste);
        if (k === "d") return run(cmd.duplicate);
        if (k === "a") return run(cmd.selectAllOnPage);
        if (k === "l") return run(() => cmd.setLocked(!e.shiftKey));
        if (k === "r") return run(() => useApp.setState((s) => ({ tools: { ...s.tools, reuse: !s.tools.reuse } })));
        if (k === "f") return run(() => useApp.setState({ leftPanel: "search" }));
        if (k === "0") return run(cmd.fitPage);
        if (k === "1") return run(cmd.actualSize);
        if (k === "2") return run(cmd.fitWidth);
        // Ctrl+Shift+Plus / Ctrl+Shift+Minus rotate the view (as the View menu shows)
        if ((k === "=" || k === "+") && e.shiftKey && e.code !== "NumpadAdd") return run(() => cmd.rotateView(90));
        if ((k === "-" || k === "_") && e.shiftKey && e.code !== "NumpadSubtract") return run(() => cmd.rotateView(-90));
        if (k === "=" || k === "+") return run(cmd.zoomIn);
        if (k === "-") return run(cmd.zoomOut);
        return;
      }
      if (e.altKey && k === "l") return run(() => useApp.setState((s) => ({ bottomPanel: !s.bottomPanel })));
      if (e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") return run(cmd.deleteSelection);
      if (e.key === "Escape") {
        if (useApp.getState().tools.tool !== "select") setTool("select");
        return;
      }
      const tool = TOOL_KEYS[k];
      if (tool && !e.shiftKey && useApp.getState().tabs.length) return run(() => setTool(tool));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
