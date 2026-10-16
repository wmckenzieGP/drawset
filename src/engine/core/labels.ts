/** Page labels from a region, /PageLabels and /Outlines writers. */
import * as mupdf from "mupdf";
import type { Rect } from "../../markup/geometry";
import type { OutlineNode } from "../types";

/** Text of a structured-text page whose characters' centres fall inside `r`, line by line, spaces tidied. */
export function textInRect(st: mupdf.StructuredText, r: Rect): string {
  const lines: string[] = [];
  let cur = "";
  st.walk({
    onChar(c, _origin, _font, _size, q) {
      const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
      const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
      if (cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]) cur += c;
    },
    endLine() {
      if (cur.trim()) lines.push(cur.trim());
      cur = "";
    },
  });
  if (cur.trim()) lines.push(cur.trim());
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Writes /PageLabels giving each page its label as a prefix (no numbering style), the plainest valid form. */
export function writePageLabels(doc: mupdf.PDFDocument, labels: string[]) {
  const nums = doc.newArray();
  labels.forEach((label, i) => {
    nums.push(doc.newInteger(i));
    const d = doc.newDictionary();
    d.put("P", doc.newString(label));
    nums.push(d);
  });
  const tree = doc.newDictionary();
  tree.put("Nums", nums);
  doc.getTrailer().get("Root").put("PageLabels", doc.addObject(tree));
}

/** Replaces the document outline. Node pages are physical indices; destinations point at the page objects. */
export function writeOutline(doc: mupdf.PDFDocument, nodes: OutlineNode[]) {
  const root = doc.getTrailer().get("Root");
  if (!nodes.length) {
    root.delete("Outlines");
    return;
  }
  const outlines = doc.addObject({ Type: doc.newName("Outlines") });
  const build = (parent: mupdf.PDFObject, list: OutlineNode[]): number => {
    const items = list.map((n) => {
      const item = doc.addObject({ Title: doc.newString(n.title), Parent: parent });
      if (n.page !== null && n.page >= 0 && n.page < doc.countPages()) item.put("Dest", [doc.findPage(n.page), doc.newName("Fit")]);
      else if (n.uri) item.put("A", { S: doc.newName("URI"), URI: doc.newString(n.uri) });
      return item;
    });
    const count = items.length;
    items.forEach((item, i) => {
      if (i > 0) item.put("Prev", items[i - 1]);
      if (i < items.length - 1) item.put("Next", items[i + 1]);
      if (list[i].children.length) {
        const kids = build(item, list[i].children);
        // closed by default: a negative count
        item.put("Count", -kids);
      }
    });
    parent.put("First", items[0]);
    parent.put("Last", items[items.length - 1]);
    return count;
  };
  const n = build(outlines, nodes);
  outlines.put("Count", n);
  root.put("Outlines", outlines);
}
