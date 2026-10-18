import { useEffect } from "react";
import { useApp } from "../state/store";
import { useInteraction } from "../features/viewer/controller";
import { setTool } from "./commands";
import { expectPasteEvent, pasteEvent } from "./clipboard";
import { commandFor } from "./keymap";

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
      const fKey = /^F\d+$/.test(e.key);
      // function keys (F1, F3, F4, F11...) work from anywhere, except while typing into a markup
      if (useInteraction.getState().editingId && !fKey) return;
      if ((textEntry || (control && !ctrl)) && !fKey) return;
      if (e.key === "Escape") {
        if (useApp.getState().tools.tool !== "select") setTool("select");
        return;
      }
      const c = commandFor(e);
      if (!c) return;
      if (c.doc && !useApp.getState().tabs.length) return;
      if (c.id === "edit.paste") {
        // the browser's paste event brings what other programs copied; it is handled below
        expectPasteEvent();
        return;
      }
      e.preventDefault();
      void c.run();
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (useInteraction.getState().editingId || !useApp.getState().tabs.length) return;
      void pasteEvent(e);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
