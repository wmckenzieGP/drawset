/** Filling form fields: every change is an undoable commit; documents.ts keeps the engine in step. */
import type { FormField } from "../../engine/types";
import { commit, flash, updateTab, useApp, type DocTab } from "../../state/store";
import { saveTab } from "../../state/documents";

/** The field's current value: the unsaved one if any, else the file's. */
export function fieldValue(tab: DocTab, f: FormField): string {
  return tab.state.fields?.[f.name] ?? f.value;
}

export const isChecked = (v: string) => v !== "" && v !== "Off";

/** Sets one field (no-op when unchanged). Text edits typed in quick succession share an undo step. */
export function setField(key: string, f: FormField, value: string) {
  if (f.readOnly) return;
  const v = f.type === "text" && f.maxLen > 0 ? value.slice(0, f.maxLen) : value;
  commit(
    key,
    `Fill ${f.name}`,
    (s) => {
      const cur = s.fields?.[f.name] ?? f.value;
      if (cur === v) return s;
      const fields = { ...(s.fields ?? {}) };
      if (v === f.value) delete fields[f.name];
      else fields[f.name] = v;
      return { ...s, fields };
    },
    f.type === "text" ? `field:${f.name}` : undefined,
  );
}

/** Check box: on/off. Radio button: turns on `on` (radio buttons are not turned off by clicking). */
export function toggleField(key: string, f: FormField, cur: string, on?: string) {
  if (f.type === "checkbox") setField(key, f, isChecked(cur) ? "Off" : (f.onValues[0] ?? "Yes"));
  else if (f.type === "radio" && on) setField(key, f, on);
}

/** Opens the Forms panel at a field. */
export function focusField(key: string, name: string) {
  useApp.setState({ leftPanel: "forms" });
  updateTab(key, (t) => ({ ...t, formFocus: { name, nonce: Date.now() } }));
}

/** Clicking a field on the page: check boxes and radio buttons toggle; other fields open in the Forms panel. */
export function clickField(tab: DocTab, src: number, p: [number, number]): boolean {
  for (const f of tab.fields ?? []) {
    for (const w of f.widgets) {
      if (w.page !== src || p[0] < w.rect[0] || p[0] > w.rect[2] || p[1] < w.rect[1] || p[1] > w.rect[3]) continue;
      if (f.readOnly || f.type === "button" || f.type === "signature") {
        focusField(tab.key, f.name);
        return true;
      }
      if (f.type === "checkbox") toggleField(tab.key, f, fieldValue(tab, f));
      else if (f.type === "radio") toggleField(tab.key, f, fieldValue(tab, f), w.on);
      else focusField(tab.key, f.name);
      return true;
    }
  }
  return false;
}

export async function flattenForms(tab: DocTab) {
  const n = tab.fields?.length ?? 0;
  if (!n) {
    flash("This document has no form fields to flatten.");
    return;
  }
  const ok = window.confirm(
    `Flatten ${n} form field${n === 1 ? "" : "s"} into the page content and save?\n\nThis is permanent: the values become part of the page and can no longer be changed.`,
  );
  if (!ok) return;
  await saveTab(tab.key, { flattenForms: true });
}
