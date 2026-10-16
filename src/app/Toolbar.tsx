import * as Menu from "@radix-ui/react-dropdown-menu";
import { BUILTIN_STAMPS } from "../markup/appearance";
import { activeTab, flash, useApp, type ToolId } from "../state/store";
import { pickLocalFiles } from "../platform/host";
import { openPrintDialog } from "../features/print/PrintDialog";
import { cmd, setTool } from "./commands";
import { Icon } from "./icons";
import type { MarkupImage } from "../markup/model";

const GROUPS: [ToolId, string, string][][] = [
  [
    ["select", "Select (V)", "select"],
    ["pan", "Pan (H, or hold Space)", "pan"],
    ["zoom", "Marquee zoom (Z)", "zoom"],
    ["text", "Select text (T)", "text"],
  ],
  [
    ["rectangle", "Rectangle (R)", "rectangle"],
    ["ellipse", "Ellipse (E)", "ellipse"],
    ["line", "Line (L)", "line"],
    ["arrow", "Arrow (A)", "arrow"],
    ["polyline", "Polyline (N) — click points, double-click to finish", "polyline"],
    ["polygon", "Polygon (P) — click points, double-click to finish", "polygon"],
    ["cloud", "Cloud (C) — drag a box, or click points", "cloud"],
  ],
  [
    ["pen", "Pen (F)", "pen"],
    ["highlighter", "Highlighter (G)", "highlighter"],
  ],
  [
    ["textbox", "Text box (X)", "textbox"],
    ["callout", "Callout (Q) — press at the point, release where the text goes", "callout"],
    ["note", "Note (O)", "note"],
    ["highlight", "Text highlight (I)", "highlight"],
    ["underline", "Underline (U)", "underline"],
    ["strikeout", "Strikethrough (K)", "strikeout"],
  ],
  [
    ["calibrate", "Calibrate: drag along a known dimension (Shift+K)", "calibrate"],
    ["length", "Length (Shift+L)", "length"],
    ["polylength", "Polylength (Shift+N): click points, double-click to finish", "polylength"],
    ["area", "Area (Shift+A): click points, double-click to finish", "area"],
    ["cutout", "Area cutout: select an area, then click the cutout's points", "cutout"],
    ["perimeter", "Perimeter (Shift+P): click points, double-click to finish", "perimeter"],
    ["count", "Count (Shift+C): click each item, Esc or double-click to finish", "count"],
    ["angle", "Angle (Shift+G): click a point, the vertex, then another point", "angle"],
  ],
];

/** Reads an image file into the form markups store (PNG/JPEG only; other formats are converted to PNG). */
export async function loadImageFile(): Promise<MarkupImage | null> {
  const [f] = await pickLocalFiles("image/png,image/jpeg,image/gif,image/bmp,image/webp");
  if (!f) return null;
  const lower = f.name.toLowerCase();
  const isJpeg = lower.endsWith(".jpg") || lower.endsWith(".jpeg");
  const isPng = lower.endsWith(".png");
  const blob = new Blob([f.bytes as Uint8Array<ArrayBuffer>]);
  const bmp = await createImageBitmap(blob);
  if (isJpeg || isPng) return { data: f.bytes, mime: isJpeg ? "image/jpeg" : "image/png", width: bmp.width, height: bmp.height };
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { data: png, mime: "image/png", width: bmp.width, height: bmp.height };
}

async function chooseImageTool(tool: "image" | "stamp") {
  const img = await loadImageFile();
  if (!img) return;
  useApp.setState((s) => ({ tools: { ...s.tools, pendingImage: img, tool, stampId: tool === "stamp" ? "custom" : s.tools.stampId } }));
  flash("Click on the page to place the image, or drag to size it.");
}

export function Toolbar() {
  const tool = useApp((s) => s.tools.tool);
  const reuse = useApp((s) => s.tools.reuse);
  const stampId = useApp((s) => s.tools.stampId);
  const tab = useApp(activeTab);
  const disabled = !tab;
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <button className="tb" title="Open (Ctrl+O)" onClick={cmd.open} data-testid="tb-open">
        <Icon name="open" />
      </button>
      <button className="tb" title="Save (Ctrl+S)" onClick={cmd.save} disabled={disabled} data-testid="tb-save">
        <Icon name="save" />
      </button>
      <button className="tb" title="Print (Ctrl+P)" onClick={openPrintDialog} disabled={disabled}>
        <Icon name="print" />
      </button>
      <span className="tb-sep" />
      <button className="tb" title="Undo (Ctrl+Z)" onClick={cmd.undo} disabled={!tab?.undo.length} data-testid="tb-undo">
        <Icon name="undo" />
      </button>
      <button className="tb" title="Redo (Ctrl+Y)" onClick={cmd.redo} disabled={!tab?.redo.length} data-testid="tb-redo">
        <Icon name="redo" />
      </button>
      {GROUPS.map((g, i) => (
        <span key={i} className="tb-group">
          <span className="tb-sep" />
          {g.map(([id, title, icon]) => (
            <button key={id} className={`tb ${tool === id ? "active" : ""}`} title={title} aria-pressed={tool === id} onClick={() => setTool(id)} disabled={disabled} data-testid={`tool-${id}`}>
              <Icon name={icon} />
            </button>
          ))}
        </span>
      ))}
      <span className="tb-sep" />
      <Menu.Root modal={false}>
        <Menu.Trigger className={`tb ${tool === "stamp" ? "active" : ""}`} title="Stamp (S)" disabled={disabled} data-testid="tool-stamp">
          <Icon name="stamp" />
          <span className="tb-caret">▾</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="start" sideOffset={2}>
            {BUILTIN_STAMPS.map((s) => (
              <Menu.Item
                key={s.id}
                className="menu-item"
                data-testid={`stamp-${s.id}`}
                onSelect={() => useApp.setState((st) => ({ tools: { ...st.tools, stampId: s.id, tool: "stamp" } }))}
              >
                <span className="stamp-swatch" style={{ color: `rgb(${s.color.map((v) => Math.round(v * 255)).join(",")})` }}>
                  {s.label}
                </span>
                {stampId === s.id && <span className="menu-shortcut">✓</span>}
              </Menu.Item>
            ))}
            <Menu.Separator className="menu-sep" />
            <Menu.Item className="menu-item" onSelect={() => chooseImageTool("stamp")}>
              Custom image stamp…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <button className={`tb ${tool === "image" ? "active" : ""}`} title="Image" onClick={() => chooseImageTool("image")} disabled={disabled} data-testid="tool-image">
        <Icon name="image" />
      </button>
      <span className="tb-sep" />
      <button
        className={`tb ${reuse ? "active" : ""}`}
        title="Reuse mode: keep the drawing tool active after each markup (Ctrl+R)"
        aria-pressed={reuse}
        onClick={() => useApp.setState((s) => ({ tools: { ...s.tools, reuse: !s.tools.reuse } }))}
        data-testid="tb-reuse"
      >
        <Icon name="reuse" />
      </button>
      <span className="tb-spacer" />
      <button className="tb" title="Fit page (Ctrl+0)" onClick={cmd.fitPage} disabled={disabled}>
        <Icon name="fitPage" />
      </button>
      <button className="tb" title="Fit width (Ctrl+2)" onClick={cmd.fitWidth} disabled={disabled}>
        <Icon name="fitWidth" />
      </button>
      <button className="tb" title="Rotate view clockwise" onClick={() => cmd.rotateView(90)} disabled={disabled}>
        <Icon name="rotate" />
      </button>
      <button className={`tb ${useApp.getState().bottomPanel ? "active" : ""}`} title="Markups List (Alt+L)" onClick={() => useApp.setState((s) => ({ bottomPanel: !s.bottomPanel }))} disabled={disabled} data-testid="tb-markups-list">
        <Icon name="list" />
      </button>
      <button className="tb" title="Properties" onClick={() => useApp.setState((s) => ({ rightPanel: !s.rightPanel }))} disabled={disabled}>
        <Icon name="props" />
      </button>
    </div>
  );
}
