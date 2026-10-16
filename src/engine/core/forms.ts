/** Form fields: read, fill and keep their appearances current. */
import * as mupdf from "mupdf";
import type { Rect } from "../../markup/geometry";
import type { FormField, FormFieldType } from "../types";

function onState(w: mupdf.PDFWidget): string | null {
  const ap = w.getObject().get("AP");
  if (!ap.isDictionary()) return null;
  const n = ap.get("N");
  let on: string | null = null;
  if (n.isDictionary()) n.forEach((_v, k) => {
    if (k !== "Off" && on === null) on = String(k);
  });
  return on;
}

function typeOf(w: mupdf.PDFWidget): FormFieldType {
  if (w.isText()) return "text";
  if (w.isCheckbox()) return "checkbox";
  if (w.isRadioButton()) return "radio";
  if (w.isChoice()) return "choice";
  if (w.isPushButton()) return "button";
  return w.getFieldType() === "signature" ? "signature" : "button";
}

/** Every field in the document, one entry per field name, with all its widgets. */
export function readFields(doc: mupdf.PDFDocument): FormField[] {
  const byName = new Map<string, FormField>();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const w of page.getWidgets()) {
      const name = w.getName();
      const type = typeOf(w);
      let f = byName.get(name);
      if (!f) {
        f = {
          name,
          type,
          value: w.getValue(),
          options: type === "choice" ? w.getOptions() : [],
          onValues: [],
          multiline: type === "text" && w.isMultiline(),
          readOnly: w.isReadOnly(),
          maxLen: type === "text" ? w.getMaxLen() : 0,
          widgets: [],
        };
        byName.set(name, f);
      }
      let on: string | null = null;
      if (type === "checkbox" || type === "radio") {
        on = onState(w);
        if (on && !f.onValues.includes(on)) f.onValues.push(on);
        // a radio group's value is whichever kid is on
        if (w.getValue() !== "Off" && w.getValue()) f.value = w.getValue();
      }
      f.widgets.push({ page: i, rect: w.getBounds() as Rect, ...(on ? { on } : {}) });
    }
  }
  return [...byName.values()];
}

/** Whether any widget of `w`'s radio group has the on-state `v`. */
function onValueIn(w: mupdf.PDFWidget, v: string): boolean {
  const parent = w.getObject().get("Parent");
  const kids = parent.isDictionary() ? parent.get("Kids") : null;
  if (!kids || !kids.isArray()) return onState(w) === v;
  for (let i = 0; i < kids.length; i++) {
    const n = kids.get(i).resolve().get("AP").get("N");
    if (n.isDictionary() && !n.get(v).isNull() && v !== "Off") return true;
  }
  return false;
}

/** Sets field values by name; returns the pages whose appearance changed. */
export function setFieldValues(doc: mupdf.PDFDocument, values: Record<string, string>): number[] {
  const touched = new Set<number>();
  const done = new Set<string>();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const w of page.getWidgets()) {
      const name = w.getName();
      if (!(name in values) || w.isReadOnly()) continue;
      const v = values[name];
      const type = typeOf(w);
      if (type === "text" || type === "choice") {
        if (done.has(name)) {
          w.update();
          touched.add(i);
          continue;
        }
        if (w.getValue() !== v) {
          if (type === "text") w.setTextValue(v);
          else w.setChoiceValue(v);
        }
        done.add(name);
      } else if (type === "checkbox") {
        const want = v !== "Off" && v !== "";
        const isOn = w.getValue() !== "Off" && w.getValue() !== "";
        if (want !== isOn) w.toggle();
      } else if (type === "radio") {
        // turn on the kid whose on-state is the value (toggling it turns its siblings off)
        if (onState(w) === v && w.getValue() !== v) w.toggle();
        else if (!onValueIn(w, v) && w.getValue() !== "Off") {
          // no button has this value (or "Off"): clear the group
          const o = w.getObject();
          o.put("AS", doc.newName("Off"));
          (o.get("Parent").isDictionary() ? o.get("Parent") : o).put("V", doc.newName("Off"));
        } else continue;
      } else continue;
      w.update();
      touched.add(i);
    }
  }
  return [...touched];
}
