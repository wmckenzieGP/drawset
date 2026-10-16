import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { engine } from "../../engine/client";
import type { Matrix, Pt } from "../../markup/geometry";
import { saveAs } from "../../platform/host";
import type { Markup } from "../../markup/model";
import { activeTab, commit, flash, useApp, withMarkups, type DocTab } from "../../state/store";
import { compareClouds, pixelRectToPage } from "./compare";
import { alignFromPoints, colourfulness, compositeOverlay, diffRegions } from "./overlayMath";

const useDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openOverlayDialog = () => activeTab() && useDialog.setState({ open: true });

const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Longest side of page A on screen, and in the exported image, in pixels. */
const VIEW_PX = 1600;
const EXPORT_PX = 4200;

interface Side {
  key: string;
  page: number;
}

/** Pick phases: two points on page A, then the same two features on page B. */
type Phase = null | { pts: Pt[] };

function pageEntry(tabs: DocTab[], s: Side) {
  const t = tabs.find((x) => x.key === s.key);
  const p = t?.state.pages[s.page];
  return t && p ? { tab: t, page: p } : null;
}

function longest(tabs: DocTab[], s: Side) {
  const e = pageEntry(tabs, s);
  if (!e) return 1;
  const b = e.page.info.bounds;
  return Math.max(b[2] - b[0], b[3] - b[1]);
}

async function renderSide(tabs: DocTab[], s: Side, scale: number): Promise<ImageBitmap> {
  const e = pageEntry(tabs, s);
  if (!e) throw new Error("That page is no longer open.");
  const bmp = await engine().render({ docId: e.tab.docId, page: e.page.src, scale, rotate: e.page.rotation });
  if (!bmp.image) throw new Error("The page could not be drawn.");
  return bmp.image;
}

function pixels(img: CanvasImageSource, w: number, h: number, m: Matrix = IDENTITY): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

/** Red/blue composite of A and B (B placed by `m`, in A's pixels). */
export function composeOverlay(a: ImageBitmap, b: ImageBitmap, m: Matrix, showA: boolean, showB: boolean): ImageData {
  const pa = pixels(a, a.width, a.height);
  const pb = pixels(b, a.width, a.height, m);
  const out = new ImageData(a.width, a.height);
  compositeOverlay(pa.data, pb.data, out.data, RED, BLUE, showA, showB);
  return out;
}

const pageLabel = (tabs: DocTab[], s: Side) => {
  const e = pageEntry(tabs, s);
  return e ? `${e.tab.name} page ${e.page.info.label || s.page + 1}` : "";
};

export function OverlayDialog() {
  const open = useDialog((s) => s.open);
  const tabs = useApp((s) => s.tabs);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);
  const [showA, setShowA] = useState(true);
  const [showB, setShowB] = useState(true);
  /** Placement of B in A's view pixels. */
  const [align, setAlign] = useState<Matrix>(IDENTITY);
  const [aligned, setAligned] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [imgs, setImgs] = useState<{ a: ImageBitmap; b: ImageBitmap; scale: number } | null>(null);
  const [colour, setColour] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cloudCount, setCloudCount] = useState<number | null>(null);

  // default pages: the current page against the same page of another open file, else the next page
  useEffect(() => {
    if (!open) return;
    const t = activeTab();
    if (!t) return;
    const other = useApp.getState().tabs.find((x) => x.key !== t.key);
    setA({ key: t.key, page: t.currentPage });
    setB(other ? { key: other.key, page: Math.min(t.currentPage, other.state.pages.length - 1) } : { key: t.key, page: Math.min(t.currentPage + 1, t.state.pages.length - 1) });
    setAlign(IDENTITY);
    setAligned(false);
    setCloudCount(null);
    setPhase(null);
  }, [open]);

  // render both pages at one pixels-per-point so drawings at the same scale line up without alignment
  useEffect(() => {
    if (!open || !a || !b) return;
    let live = true;
    const all = useApp.getState().tabs;
    const scale = VIEW_PX / longest(all, a);
    Promise.all([renderSide(all, a, scale), renderSide(all, b, scale)])
      .then(([ia, ib]) => {
        if (!live) return;
        setImgs((old) => {
          old?.a.close();
          old?.b.close();
          return { a: ia, b: ib, scale };
        });
      })
      .catch((e) => flash((e as Error).message, "error"));
    return () => {
      live = false;
    };
  }, [open, a, b]);

  // draw: the composite, or one page alone while points are being picked on it
  useEffect(() => {
    const c = canvas.current;
    if (!c || !imgs) return;
    const ctx = c.getContext("2d")!;
    const picking = phase && phase.pts.length >= 2 ? imgs.b : phase ? imgs.a : null;
    if (picking) {
      c.width = picking.width;
      c.height = picking.height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(picking, 0, 0);
      const mine = phase!.pts.length >= 2 ? phase!.pts.slice(2) : phase!.pts;
      ctx.fillStyle = phase!.pts.length >= 2 ? "#1650ff" : "#e00000";
      for (const p of mine) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    const img = composeOverlay(imgs.a, imgs.b, align, showA, showB);
    c.width = img.width;
    c.height = img.height;
    ctx.putImageData(img, 0, 0);
    setColour(colourfulness(img.data));
  }, [imgs, align, showA, showB, phase]);

  const close = () => useDialog.setState({ open: false });
  if (!open || !a || !b) return null;

  const pickAt = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!phase || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const p: Pt = [((ev.clientX - r.left) * canvas.current.width) / r.width, ((ev.clientY - r.top) * canvas.current.height) / r.height];
    const pts = [...phase.pts, p];
    if (pts.length < 4) {
      setPhase({ pts });
      return;
    }
    setAlign(alignFromPoints(pts[0], pts[1], pts[2], pts[3]));
    setAligned(true);
    setPhase(null);
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const all = useApp.getState().tabs;
      const scale = EXPORT_PX / longest(all, a);
      const [ia, ib] = await Promise.all([renderSide(all, a, scale), renderSide(all, b, scale)]);
      // the alignment was found at view resolution: same rotation and size, translation scaled up
      const k = imgs ? scale / imgs.scale : 1;
      const m: Matrix = [align[0], align[1], align[2], align[3], align[4] * k, align[5] * k];
      const img = composeOverlay(ia, ib, m, showA, showB);
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const shown = [showA && `red: ${pageLabel(all, a)}`, showB && `blue: ${pageLabel(all, b)}`].filter(Boolean).join("; ");
      const bytes = await engine().imagePdf(
        [
          {
            width: img.width,
            height: img.height,
            data: img.data,
            pageWidth: img.width / scale,
            pageHeight: img.height / scale,
            caption: [
              `OVERLAY (image-based, not vector content): ${shown}`,
              `Content on both pages is black. ${aligned ? "Aligned by two points." : "Not aligned."} Created ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} in Drawset.`,
            ],
          },
        ],
        `Overlay of ${pageLabel(all, a)} and ${pageLabel(all, b)}`,
      );
      ia.close();
      ib.close();
      await saveAs(`Overlay ${pageEntry(all, a)?.tab.name.replace(/\.pdf$/i, "")} p${a.page + 1}.pdf`, bytes);
    } catch (e) {
      flash(`Could not export the overlay: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  /** Clouds every changed area on the red page(s), compared with the blue; one undo step. */
  const cloudChanges = async (all: boolean) => {
    setBusy(true);
    try {
      const all_ = useApp.getState().tabs;
      const ta = all_.find((x) => x.key === a.key);
      const tb = all_.find((x) => x.key === b.key);
      if (!ta || !tb) return;
      const pairs = all ? [...Array(Math.min(ta.state.pages.length, tb.state.pages.length)).keys()].map((i) => [i, i]) : [[a.page, b.page]];
      const clouds: Markup[] = [];
      let skipped = 0;
      for (const [pa, pb] of pairs) {
        const ea = ta.state.pages[pa];
        const eb = tb.state.pages[pb];
        useApp.setState({ busy: `Comparing page ${pa + 1}…` });
        const scale = VIEW_PX / longest(all_, { key: a.key, page: pa });
        const [ia, ib] = await Promise.all([engine().render({ docId: ta.docId, page: ea.src, scale, rotate: 0 }), engine().render({ docId: tb.docId, page: eb.src, scale, rotate: 0 })]);
        if (!ia.image || !ib.image) continue;
        // the two-point alignment was found on the view; it carries over when neither page is turned
        const k = imgs ? scale / imgs.scale : 1;
        const m: Matrix = aligned && ea.rotation === 0 && eb.rotation === 0 ? [align[0], align[1], align[2], align[3], align[4] * k, align[5] * k] : IDENTITY;
        const pxA = pixels(ia.image, ia.width, ia.height);
        const pxB = pixels(ib.image, ia.width, ia.height, m);
        ia.image.close();
        ib.image.close();
        const regions = diffRegions(pxA.data, pxB.data, ia.width, ia.height);
        // so many changes means different sheets or a bad alignment, not a revision
        if (regions.length > 150) {
          skipped++;
          continue;
        }
        clouds.push(...compareClouds(ea.id, regions.map((r) => pixelRectToPage(r, ea.info.bounds, scale)), pageLabel(all_, { key: b.key, page: pb })));
      }
      if (clouds.length) commit(a.key, `Compare (${clouds.length} change${clouds.length === 1 ? "" : "s"})`, (st) => withMarkups(st, clouds));
      flash(
        `${clouds.length ? `Clouded ${clouds.length} changed area${clouds.length === 1 ? "" : "s"}` : "No changes found"}${skipped ? `; skipped ${skipped} page${skipped === 1 ? "" : "s"} that differ throughout (check they are revisions of the same sheet and aligned)` : ""}.`,
        skipped ? "error" : "info",
      );
      setCloudCount(clouds.length);
    } catch (e) {
      flash(`Could not compare: ${(e as Error).message}`, "error");
    } finally {
      useApp.setState({ busy: null });
      setBusy(false);
    }
  };

  const sidePicker = (s: Side, set: (s: Side) => void, colourName: string, testId: string) => {
    const t = tabs.find((x) => x.key === s.key);
    return (
      <div className="field-row">
        <span className={`overlay-swatch ${colourName}`} />
        <select value={s.key} onChange={(e) => set({ key: e.target.value, page: 0 })} data-testid={`${testId}-file`}>
          {tabs.map((x) => (
            <option key={x.key} value={x.key}>
              {x.name}
            </option>
          ))}
        </select>
        <label>
          Page{" "}
          <select value={s.page} onChange={(e) => set({ ...s, page: Number(e.target.value) })} data-testid={`${testId}-page`}>
            {t?.state.pages.map((p, i) => (
              <option key={p.id} value={i}>
                {p.info.label || i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  };

  const step = !phase ? null : phase.pts.length < 2 ? `Click point ${phase.pts.length + 1} of 2 on the red page.` : `Click the same point ${phase.pts.length - 1} of 2 on the blue page.`;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog overlay-dialog" aria-describedby={undefined} data-testid="overlay-dialog">
          <Dialog.Title>Overlay and compare</Dialog.Title>
          <div className="overlay-controls">
            <div>
              {sidePicker(a, (s) => { setA(s); setAligned(false); setAlign(IDENTITY); }, "red", "overlay-a")}
              {sidePicker(b, (s) => { setB(s); setAligned(false); setAlign(IDENTITY); }, "blue", "overlay-b")}
            </div>
            <div className="overlay-toggles">
              <label className="check">
                <input type="checkbox" checked={showA} onChange={(e) => setShowA(e.target.checked)} data-testid="overlay-show-a" /> Show red
              </label>
              <label className="check">
                <input type="checkbox" checked={showB} onChange={(e) => setShowB(e.target.checked)} data-testid="overlay-show-b" /> Show blue
              </label>
            </div>
            <div className="overlay-toggles">
              <button className="btn" onClick={() => setPhase(phase ? null : { pts: [] })} data-testid="overlay-align">
                {phase ? "Cancel alignment" : "Align by two points"}
              </button>
              <button className="btn" disabled={!aligned} onClick={() => { setAlign(IDENTITY); setAligned(false); }}>
                Reset alignment
              </button>
            </div>
          </div>
          <p className="muted" data-testid="overlay-status">
            {step ?? (colour < 0.0005 ? "No differences: everything shown is on both pages." : "Red is only on the red page, blue only on the blue page; black is on both.")}
          </p>
          <div className="overlay-view">
            {!imgs && <div className="muted">Drawing pages…</div>}
            <canvas ref={canvas} onClick={pickAt} className={phase ? "picking" : ""} data-testid="overlay-canvas" data-colour={colour.toFixed(5)} data-ready={imgs ? "1" : "0"} />
          </div>
          <div className="dialog-buttons">
            <span className="muted overlay-note" data-testid="overlay-cloud-count">
              {cloudCount !== null ? `${cloudCount} change${cloudCount === 1 ? "" : "s"} clouded on the red pages.` : "Clouds go on the red file, the newer revision. The export is an image of the overlay, labelled as such."}
            </span>
            <Dialog.Close className="btn">Close</Dialog.Close>
            <button className="btn" disabled={!imgs || busy || !!phase} onClick={() => cloudChanges(false)} data-testid="overlay-cloud">
              Cloud changes
            </button>
            <button className="btn" disabled={!imgs || busy || !!phase || a.key === b.key} onClick={() => cloudChanges(true)} data-testid="overlay-cloud-all">
              Cloud changes, all pages
            </button>
            <button className="btn primary" disabled={!imgs || busy || !!phase} onClick={exportPdf} data-testid="overlay-export">
              {busy ? "Exporting…" : "Export as PDF…"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
