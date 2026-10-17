/** Hyperlink annotations: reading and writing their targets (a page, another file, or a web address). */
import * as mupdf from "mupdf";
import type { LinkTarget } from "../../markup/model";

const pageNums = new WeakMap<mupdf.PDFDocument, { count: number; map: Map<number, number> }>();

/** Physical page index of a page object, or -1. */
function pageIndexOf(doc: mupdf.PDFDocument, ref: mupdf.PDFObject): number {
  if (!ref.isIndirect()) return ref.isNumber() ? ref.asNumber() : -1;
  const n = doc.countPages();
  let c = pageNums.get(doc);
  if (!c || c.count !== n) {
    const map = new Map<number, number>();
    for (let i = 0; i < n; i++) map.set(doc.findPage(i).asIndirect(), i);
    pageNums.set(doc, (c = { count: n, map }));
  }
  return c.map.get(ref.asIndirect()) ?? -1;
}

/** resolve() that tolerates null objects (mupdf.js's shared null cannot be resolved). */
const res = (o: mupdf.PDFObject) => (o.isNull() ? o : o.resolve());

function str(o: mupdf.PDFObject): string {
  return o.isString() ? o.asString() : o.isName() ? o.asName() : "";
}

/** A file specification: a string, or a dictionary with /UF or /F. */
function fileSpec(o: mupdf.PDFObject): string {
  const f = res(o);
  if (f.isString()) return f.asString();
  if (f.isDictionary()) return str(f.get("UF")) || str(f.get("F")) || str(f.get("Unix")) || str(f.get("DOS"));
  return "";
}

function destPage(doc: mupdf.PDFDocument, d: mupdf.PDFObject): number {
  const dest = res(d);
  if (dest.isArray() && dest.length > 0) return pageIndexOf(doc, dest.get(0));
  if (dest.isDictionary() && dest.get("D").isArray()) return pageIndexOf(doc, dest.get("D").get(0));
  const name = str(dest);
  if (!name) return -1;
  try {
    return doc.resolveLink(`#nameddest=${encodeURIComponent(name)}`);
  } catch {
    return -1;
  }
}

/** The link's target, or null when it does something Drawset does not edit (scripts, named actions…). */
export function readLinkTarget(doc: mupdf.PDFDocument, obj: mupdf.PDFObject): LinkTarget | null {
  const dest = obj.get("Dest");
  if (!dest.isNull()) {
    const page = destPage(doc, dest);
    return page >= 0 ? { type: "page", page } : null;
  }
  const a = res(obj.get("A"));
  if (!a.isDictionary()) return null;
  switch (str(a.get("S"))) {
    case "GoTo": {
      const page = destPage(doc, a.get("D"));
      return page >= 0 ? { type: "page", page } : null;
    }
    case "URI": {
      const url = str(a.get("URI"));
      return url ? { type: "url", url } : null;
    }
    case "GoToR": {
      const path = fileSpec(a.get("F"));
      if (!path) return null;
      const d = res(a.get("D"));
      // remote destinations name the page by number (0-based)
      const page = d.isArray() && d.length && d.get(0).isNumber() ? d.get(0).asNumber() : undefined;
      return page !== undefined ? { type: "file", path, page } : { type: "file", path };
    }
    case "Launch": {
      const path = fileSpec(a.get("F")) || fileSpec(a.get("Win").isDictionary() ? a.get("Win").get("F") : a.get("Win"));
      return path ? { type: "file", path } : null;
    }
    default:
      return null;
  }
}

/** Writes the link's action; replaces /Dest and any earlier action. */
export function writeLinkTarget(doc: mupdf.PDFDocument, obj: mupdf.PDFObject, t: LinkTarget) {
  obj.delete("Dest");
  if (t.type === "page") {
    const p = Math.max(0, Math.min(doc.countPages() - 1, t.page));
    obj.put("A", { S: doc.newName("GoTo"), D: [doc.findPage(p), doc.newName("Fit")] });
  } else if (t.type === "url") {
    obj.put("A", { S: doc.newName("URI"), URI: doc.newString(t.url) });
  } else {
    const spec = { Type: doc.newName("Filespec"), F: doc.newString(t.path), UF: doc.newString(t.path) };
    if (/\.pdf$/i.test(t.path)) obj.put("A", { S: doc.newName("GoToR"), F: spec, D: [t.page ?? 0, doc.newName("Fit")], NewWindow: true });
    else obj.put("A", { S: doc.newName("Launch"), F: spec, NewWindow: true });
  }
}
