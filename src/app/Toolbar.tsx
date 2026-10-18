import * as Menu from "@radix-ui/react-dropdown-menu";
import { BUILTIN_STAMPS } from "../markup/appearance";
import { activeTab, togglePanel, useApp, type ToolId } from "../state/store";
import { keysOf } from "./keymap";
import { openPrintDialog } from "../features/print/PrintDialog";
import { cmd, setTool } from "./commands";
import { Icon } from "./icons";
import { chooseImageTool } from "./images";

/** Tool buttons: [tool, tip, icon]. The tip gets the tool's key from the key map. */
const GROUPS: [ToolId, string, string][][] = [
  [
    ["select", "Select", "select"],
    ["pan", "Pan (or hold Space)", "pan"],
    ["zoom", "Zoom: drag a box, or click", "zoom"],
    ["text", "Select text", "text"],
  ],
  [
    ["textbox", "Text box", "textbox"],
    ["callout", "Callout: press at the point, release where the text goes", "callout"],
    ["note", "Note", "note"],
    ["pen", "Pen", "pen"],
    ["highlighter", "Highlighter (freehand)", "highlighter"],
    ["highlight", "Highlight text", "highlight"],
    ["underline", "Underline", "underline"],
    ["strikeout", "Strikethrough", "strikeout"],
  ],
  [
    ["line", "Line", "line"],
    ["arrow", "Arrow", "arrow"],
    ["polyline", "Polyline: click points, double-click to finish", "polyline"],
    ["rectangle", "Rectangle", "rectangle"],
    ["ellipse", "Ellipse", "ellipse"],
    ["polygon", "Polygon: click points, double-click to finish", "polygon"],
    ["cloud", "Cloud: drag a box, or click points", "cloud"],
    ["link", "Hyperlink: drag an area that goes to a page, a file or a web address", "link"],
  ],
  [
    ["calibrate", "Calibrate: drag along a known dimension", "calibrate"],
    ["length", "Length", "length"],
    ["polylength", "Polylength: click points, double-click to finish", "polylength"],
    ["area", "Area: click points, double-click to finish", "area"],
    ["cutout", "Area cutout: select an area, then click the cutout's points", "cutout"],
    ["perimeter", "Perimeter: click points, double-click to finish", "perimeter"],
    ["count", "Count: click each item, Esc or double-click to finish", "count"],
    ["angle", "Angle: click a point, the vertex, then another point", "angle"],
  ],
  [
    ["erase", "Erase content: drag an area (removed when you apply redactions)", "erase"],
    ["redact", "Mark area for redaction (removed when you apply redactions)", "redact"],
  ],
];
const withKey = (tip: string, id: string) => {
  const k = keysOf(id);
  return k ? `${tip.replace(/:.*$/, "")} (${k})${tip.includes(":") ? tip.slice(tip.indexOf(":")) : ""}` : tip;
};

export function Toolbar() {
  const tool = useApp((s) => s.tools.tool);
  const bottomPanel = useApp((s) => s.bottomPanel);
  const stampId = useApp((s) => s.tools.stampId);
  const tab = useApp(activeTab);
  const disabled = !tab;
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <button className="tb" title={withKey("Open", "file.open")} onClick={cmd.open} data-testid="tb-open">
        <Icon name="open" />
      </button>
      <button className="tb" title={withKey("Save", "file.save")} onClick={cmd.save} disabled={disabled} data-testid="tb-save">
        <Icon name="save" />
      </button>
      <button className="tb" title={withKey("Print", "file.print")} onClick={openPrintDialog} disabled={disabled}>
        <Icon name="print" />
      </button>
      <span className="tb-sep" />
      <button className="tb" title={withKey("Undo", "edit.undo")} onClick={cmd.undo} disabled={!tab?.undo.length} data-testid="tb-undo">
        <Icon name="undo" />
      </button>
      <button className="tb" title={withKey("Redo", "edit.redo")} onClick={cmd.redo} disabled={!tab?.redo.length} data-testid="tb-redo">
        <Icon name="redo" />
      </button>
      {GROUPS.map((g, i) => (
        <span key={i} className="tb-group">
          <span className="tb-sep" />
          {g.map(([id, title, icon]) => (
            <button key={id} className={`tb ${tool === id ? "active" : ""}`} title={withKey(title, `tool.${id}`)} aria-pressed={tool === id} onClick={() => setTool(id)} disabled={disabled} data-testid={`tool-${id}`}>
              <Icon name={icon} />
            </button>
          ))}
        </span>
      ))}
      <span className="tb-sep" />
      <Menu.Root modal={false}>
        <Menu.Trigger className={`tb ${tool === "stamp" ? "active" : ""}`} title={withKey("Stamp", "tool.stamp")} disabled={disabled} data-testid="tool-stamp">
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
      <button className={`tb ${tool === "image" ? "active" : ""}`} title={withKey("Image", "tool.image")} onClick={() => chooseImageTool("image")} disabled={disabled} data-testid="tool-image">
        <Icon name="image" />
      </button>
      <span className="tb-spacer" />
      <button className={`tb ${bottomPanel ? "active" : ""}`} title={withKey("Markups List", "panel.markups")} onClick={() => useApp.setState((s) => ({ bottomPanel: !s.bottomPanel }))} disabled={disabled} data-testid="tb-markups-list">
        <Icon name="list" />
      </button>
      <button className="tb" title={withKey("Properties", "panel.properties")} onClick={() => togglePanel("properties")} disabled={disabled}>
        <Icon name="props" />
      </button>
    </div>
  );
}
