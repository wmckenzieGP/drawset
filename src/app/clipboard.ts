/**
 * Copy and paste. Copied markups paste where the pointer is (or where a right-click menu was opened); Paste in
 * place keeps their spot. A picture or text copied in another program pastes as an image or a text box.
 */
import { centredOn, fitToLines, keptWithin } from "../markup/arrange";
import { cloneMarkup, relinkGroups } from "../markup/edit";
import type { Pt } from "../markup/geometry";
import { newId, type Markup, type MarkupImage } from "../markup/model";
import { activeTab, commit, flash, updateTab, useApp, withMarkups, type DocTab } from "../state/store";
import { useCursor } from "../features/viewer/cursor";
import { imageAt, textBoxAt } from "../features/viewer/create";
import { imageFromBytes } from "./images";

/** A spot on a page of the active document. */
export interface PastePoint {
  pageId: string;
  pt: Pt;
}

/** The copied markups, and the line of text put on the system clipboard with them (`onSystem` once it is there). */
let clipboard: { docId: string; markups: Markup[]; token: string; onSystem: boolean } | null = null;

/** Whether markups have been copied (for menus). */
export const hasCopiedMarkups = () => !!clipboard?.markups.length;

const writeSystemText = (text: string): Promise<boolean> =>
  navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);

/** Copies the selected markups, or else the selected PDF text. Returns whether anything was copied. */
export function copySelection(): boolean {
  const t = activeTab();
  if (!t) return false;
  const ms = t.selection.map((id) => t.state.markups[id]).filter(Boolean);
  if (ms.length) {
    // other programs get a line of text; finding the same line on paste means the markups are the latest copy
    const token = `[Drawset: ${ms.length} markup${ms.length === 1 ? "" : "s"} ${Date.now().toString(36)}]`;
    const copied = { docId: t.docId, markups: ms, token, onSystem: false };
    clipboard = copied;
    void writeSystemText(token).then((ok) => void (copied.onSystem = ok));
    return true;
  }
  if (t.textSelection?.text) {
    void writeSystemText(t.textSelection.text);
    return true;
  }
  return false;
}

/**
 * Puts a picture markup (a snapshot) on the clipboard. Drawset pastes the markup itself, at the size it was taken;
 * other programs get the picture. The line of text beside it marks it as the latest copy, as for markups.
 */
export async function copyPicture(docId: string, m: Markup, png: Blob): Promise<void> {
  const token = `[Drawset: snapshot ${Date.now().toString(36)}]`;
  const copied = { docId, markups: [m], token, onSystem: false };
  clipboard = copied;
  let ok = false;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    ok = await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([token], { type: "text/plain" }), "image/png": png })]).then(() => true, () => false);
  }
  copied.onSystem = ok || (await writeSystemText(token));
}

/** The pointer's spot when it is over a page of the active document. */
export function pointerSpot(): PastePoint | null {
  const t = activeTab();
  const c = useCursor.getState();
  if (!t || c.tabKey !== t.key || !c.pageId || !c.pt || !t.state.pages.some((p) => p.id === c.pageId)) return null;
  return { pageId: c.pageId, pt: c.pt };
}

function place(t: DocTab, ms: Markup[], label: string) {
  if (!ms.length) return;
  commit(t.key, label, (s) => withMarkups(s, ms));
  updateTab(t.key, (x) => ({ ...x, selection: ms.map((m) => m.id) }));
}

/** Puts `ms` (already on `at`'s page) with their middle on `at`, inside the page. */
function atSpot(t: DocTab, at: PastePoint, ms: Markup[]): Markup[] {
  const page = t.state.pages.find((p) => p.id === at.pageId)!;
  return keptWithin(page.info.bounds, centredOn(ms, at.pt));
}

/**
 * Pastes the copied markups: centred on `at` when given; otherwise, with `inPlace`, at their own spot on the
 * current page, or a little down and right of the originals when they are on this page.
 */
export function pasteMarkups(at: PastePoint | null, inPlace = false) {
  const t = activeTab();
  if (!t || !clipboard) return;
  const pageId = at?.pageId ?? t.state.pages[t.currentPage]?.id;
  if (!pageId) return;
  const sameDoc = clipboard.docId === t.docId;
  const author = useApp.getState().author;
  // kept appearances and other editors' annotations only copy within their own file
  const originals = clipboard.markups.filter((m) => m.kind !== "foreign" && (sameDoc || !m.keepAppearance));
  const nudge = (m: Markup) => (!inPlace && !at && m.pageId === pageId ? 12 : 0);
  let copies = relinkGroups(
    originals,
    originals.map((m) => cloneMarkup(m, newId(), pageId, nudge(m), nudge(m), author)),
  );
  if (at) copies = atSpot(t, at, copies);
  place(t, copies, "Paste");
  // the next plain paste steps on from these
  clipboard = { ...clipboard, markups: copies };
}

/** A text box holding pasted text, with its middle on `at`. */
function pasteText(t: DocTab, at: PastePoint, text: string) {
  const box = fitToLines({ ...textBoxAt(at.pageId, at.pt, null), contents: text.replace(/\r\n?/g, "\n").trimEnd() });
  place(t, atSpot(t, at, [box]), "Paste text");
}

function pasteImage(t: DocTab, at: PastePoint, image: MarkupImage) {
  const m = imageAt(at.pageId, at.pt, null, image);
  if (m) place(t, atSpot(t, at, [m]), "Paste image");
}

/** Where a paste with no pointer over the page goes: the middle of the current page. */
function fallbackSpot(t: DocTab): PastePoint | null {
  const page = t.state.pages[t.currentPage];
  if (!page) return null;
  const b = page.info.bounds;
  return { pageId: page.id, pt: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
}

/** Handles what another program (or Drawset) put on the system clipboard. */
export async function pasteData(data: { text: string; image: { bytes: Uint8Array; mime: string } | null }, at: PastePoint | null) {
  const t = activeTab();
  if (!t) return;
  const text = data.text;
  // the markups are the latest copy when their line is on the system clipboard, or it could not be put there
  const ours = !!clipboard && (text === clipboard.token || !clipboard.onSystem || (!text && !data.image));
  if (ours) return pasteMarkups(at);
  const spot = at ?? fallbackSpot(t);
  if (!spot) return;
  if (data.image) {
    try {
      pasteImage(t, spot, await imageFromBytes(data.image.bytes, data.image.mime));
    } catch {
      flash("That picture could not be read.", "error");
    }
    return;
  }
  if (text.trim()) return pasteText(t, spot, text);
  if (clipboard) pasteMarkups(at);
}

/** Pictures dragged onto a page from Explorer: placed where they are dropped, each a little below the last. */
export async function dropImages(files: File[], at: PastePoint) {
  const t = activeTab();
  if (!t) return;
  let spot = at;
  for (const f of files) {
    try {
      const image = await imageFromBytes(new Uint8Array(await f.arrayBuffer()), f.type);
      pasteImage(t, spot, image);
      spot = { ...spot, pt: [spot.pt[0] + 18, spot.pt[1] + 18] };
    } catch {
      flash(`${f.name} could not be read as a picture.`, "error");
    }
  }
}

/** Reads a paste event's clipboard. */
export async function fromDataTransfer(dt: DataTransfer | null): Promise<{ text: string; image: { bytes: Uint8Array; mime: string } | null }> {
  const text = dt?.getData("text/plain") ?? "";
  // a picture copied in a browser, Word or the Snipping Tool comes as a file item
  const fromItems = dt ? [...dt.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()) : [];
  const file = [...fromItems, ...(dt ? [...dt.files] : [])].find((f): f is File => !!f && f.type.startsWith("image/"));
  return { text, image: file ? { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type } : null };
}

/** For menus: reads the system clipboard if it may, otherwise pastes the copied markups. */
export async function pasteFromMenu(at: PastePoint | null) {
  try {
    const items = await navigator.clipboard.read();
    let text = "";
    for (const item of items) {
      const type = item.types.find((x) => x.startsWith("image/"));
      if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
      // a snapshot's picture comes with its line of text, which says it is Drawset's own
      if (type) return await pasteData({ text, image: { bytes: new Uint8Array(await (await item.getType(type)).arrayBuffer()), mime: type } }, at);
    }
    return await pasteData({ text, image: null }, at);
  } catch {
    // no permission to read the system clipboard here: paste what Drawset copied
    pasteMarkups(at);
  }
}

/**
 * Ctrl+V lets the browser fire its paste event (the only way to see pictures copied elsewhere). If none comes
 * (nothing it can paste into), the copied markups are pasted anyway.
 */
let waiting: { timer: number; at: PastePoint | null } | null = null;
export function expectPasteEvent() {
  if (waiting) clearTimeout(waiting.timer);
  const at = pointerSpot();
  waiting = {
    at,
    timer: window.setTimeout(() => {
      waiting = null;
      pasteMarkups(at);
    }, 150),
  };
}

/** Handles a paste event that is not for a text field: at the spot Ctrl+V was pressed, or else the pointer. */
export async function pasteEvent(e: ClipboardEvent) {
  const at = waiting ? waiting.at : pointerSpot();
  if (waiting) clearTimeout(waiting.timer);
  waiting = null;
  e.preventDefault();
  await pasteData(await fromDataTransfer(e.clipboardData), at);
}
