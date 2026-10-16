import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { diffFraction, openPdfjs, renderPdfjs } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const FILLED = { project_name: "Library fit-out", approved: "Yes", discipline: "Hydraulic", stage: "Tender" };

function widgetsOf(bytes: Uint8Array) {
  const doc = openMupdf(bytes);
  return (doc.loadPage(0) as mupdf.PDFPage).getWidgets();
}

async function pdfjsValues(bytes: Uint8Array) {
  const pj = await openPdfjs(bytes);
  const annots = await (await pj.getPage(1)).getAnnotations();
  await pj.destroy();
  return { annots };
}

describe("form fields", () => {
  it("reads text, check box, choice and radio fields with their widgets", () => {
    const e = new EngineCore();
    const info = e.open(read("form.pdf"), "form.pdf");
    expect(info.hasForm).toBe(true);
    const fields = e.formFields(info.docId);
    expect(fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ["project_name", "text", "Hospital Stage 2"],
      ["approved", "checkbox", "Off"],
      ["discipline", "choice", "Mechanical"],
      ["stage", "radio", "Off"],
    ]);
    expect(fields[2].options).toEqual(["Mechanical", "Electrical", "Hydraulic"]);
    expect(fields[3].widgets.map((w) => w.on)).toEqual(["Concept", "Tender"]);
  });

  it("fills every field type, saves incrementally, and MuPDF and pdf.js read the values and appearances back", async () => {
    const e = new EngineCore();
    const src = read("form.pdf");
    const info = e.open(src, "form.pdf");
    const before = renderMupdf(src, 0, 1);
    expect(e.setFieldValues(info.docId, FILLED)).toEqual([0]);
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T", fieldValues: FILLED }, "incremental");
    // incremental: the original file is untouched at the start of the new one
    expect(Buffer.from(res.bytes.subarray(0, src.length)).equals(Buffer.from(src))).toBe(true);
    expect(Object.fromEntries(e.formFields(res.info.docId).map((f) => [f.name, f.value]))).toEqual(FILLED);

    const ws = widgetsOf(res.bytes);
    const tx = ws.find((w) => w.getName() === "project_name")!;
    const ap = tx.getObject().get("AP").get("N").readStream().asString();
    expect(ap).toContain("Library fit-out");
    const radios = ws.filter((w) => w.getName() === "stage");
    expect(radios.map((w) => w.getObject().get("AS").asName())).toEqual(["Off", "Tender"]);
    expect(ws.find((w) => w.getName() === "approved")!.getObject().get("AS").asName()).not.toBe("Off");

    const { annots } = await pdfjsValues(res.bytes);
    expect(annots.find((a) => a.fieldName === "project_name").fieldValue).toBe("Library fit-out");
    expect(annots.find((a) => a.fieldName === "discipline").fieldValue).toEqual(["Hydraulic"]);
    const pjCheck = annots.find((a) => a.fieldName === "approved");
    expect(pjCheck.fieldValue).not.toBe("Off");
    expect(annots.filter((a) => a.fieldName === "stage").map((a) => a.fieldValue)).toEqual(["Tender", "Tender"]);

    // the new appearances are visible in both renderers
    expect(diffFraction(before, renderMupdf(res.bytes, 0, 1))).toBeGreaterThan(0.0005);
    const pjBefore = await renderPdfjs(src, 0, 1);
    expect(diffFraction(pjBefore, await renderPdfjs(res.bytes, 0, 1))).toBeGreaterThan(0.0005);
  });

  it("flattening burns the fields into the page: no widgets or AcroForm remain and the page looks the same", async () => {
    const e = new EngineCore();
    const info = e.open(read("form.pdf"), "form.pdf");
    e.setFieldValues(info.docId, FILLED);
    const filled = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T" }, "full");
    const ref = renderMupdf(filled.bytes, 0, 1);
    const pjRef = await renderPdfjs(filled.bytes, 0, 1);
    const flat = e.save(filled.info.docId, { pages: identityPages(filled.info), upserts: [], deletes: [], defaultAuthor: "T", flattenForms: true }, "incremental");
    expect(flat.info.hasForm).toBe(false);
    expect(widgetsOf(flat.bytes)).toHaveLength(0);
    expect(openMupdf(flat.bytes).getTrailer().get("Root").get("AcroForm").isNull()).toBe(true);
    expect(e.formFields(flat.info.docId)).toEqual([]);
    const { annots } = await pdfjsValues(flat.bytes);
    expect(annots.filter((a) => a.subtype === "Widget")).toHaveLength(0);
    // the filled text is now page content
    const text = (openMupdf(flat.bytes).loadPage(0) as mupdf.PDFPage).toStructuredText("").asText();
    expect(text).toContain("Library fit-out");
    expect(text).toContain("Hydraulic");
    expect(diffFraction(ref, renderMupdf(flat.bytes, 0, 1))).toBeLessThan(0.001);
    expect(diffFraction(pjRef, await renderPdfjs(flat.bytes, 0, 1))).toBeLessThan(0.002);
  });

  it("leaves read-only fields alone", () => {
    const e = new EngineCore();
    const info = e.open(read("form.pdf"), "form.pdf");
    const doc = e.pdf(info.docId);
    const w = (doc.loadPage(0) as mupdf.PDFPage).getWidgets().find((x) => x.getName() === "project_name")!;
    w.getObject().put("Ff", 1);
    expect(e.formFields(info.docId)[0].readOnly).toBe(true);
    expect(e.setFieldValues(info.docId, { project_name: "Changed" })).toEqual([]);
    expect(e.formFields(info.docId)[0].value).toBe("Hospital Stage 2");
  });
});

describe("filling through the app state", () => {
  it("each change is undoable, the engine follows undo and redo, and the save plan carries the values", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, undo, redo, useApp, isDirty } = await import("../../src/state/store");
    const { buildPlan } = await import("../../src/state/documents");
    const { setField, toggleField, clickField, fieldValue } = await import("../../src/features/forms/forms");
    const core = useNodeEngine();
    const info = core.open(read("form.pdf"), "form.pdf");
    const key = addTab(info, "form.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    useApp.setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, fields: core.formFields(info.docId) } : t)) }));
    const field = (n: string) => tab().fields!.find((f) => f.name === n)!;
    const engineValues = async () => {
      await new Promise((r) => setTimeout(r, 0));
      return Object.fromEntries(core.formFields(info.docId).map((f) => [f.name, f.value]));
    };

    setField(key, field("project_name"), "Library fit-out");
    toggleField(key, field("approved"), "Off");
    setField(key, field("discipline"), "Hydraulic");
    // clicking the second radio button on the page turns it on
    const tender = field("stage").widgets[1].rect;
    expect(clickField(tab(), 0, [(tender[0] + tender[2]) / 2, (tender[1] + tender[3]) / 2])).toBe(true);
    expect(isDirty(tab())).toBe(true);
    expect(fieldValue(tab(), field("stage"))).toBe("Tender");
    expect(await engineValues()).toEqual({ ...FILLED, approved: field("approved").onValues[0] ?? "Yes" });
    expect(buildPlan(tab()).fieldValues).toMatchObject({ project_name: "Library fit-out", stage: "Tender" });

    undo(key);
    undo(key);
    expect((await engineValues()).discipline).toBe("Mechanical");
    expect((await engineValues()).stage).toBe("Off");
    redo(key);
    expect((await engineValues()).discipline).toBe("Hydraulic");
    undo(key);
    undo(key);
    undo(key);
    expect(tab().state.fields ?? {}).toEqual({});
    expect(await engineValues()).toEqual({ project_name: "Hospital Stage 2", approved: "Off", discipline: "Mechanical", stage: "Off" });
    expect(buildPlan(tab()).fieldValues).toBeUndefined();
  });
});
