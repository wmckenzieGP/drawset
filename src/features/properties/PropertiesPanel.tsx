import { openLinkDialog } from "../links/LinkDialog";
import { describeTarget, followLink } from "../links/navigate";
import { ReplyThread } from "../replies/ReplyThread";
import { useEffect, useState } from "react";
import { colourHex, FONT_FAMILIES, formatDate, hexColour, KIND_LABELS, LINE_ENDS, nowIso, STATUSES, type Markup, type MarkupKind, type MarkupStyle, type ReviewStatus } from "../../markup/model";
import { textBoxHeight, textPadding } from "../../markup/appearance";
import { commit, defaultStyleFor, useApp, withMarkups, type DocTab } from "../../state/store";
import { cmd } from "../../app/commands";

const FILL_KINDS = new Set<MarkupKind>(["rectangle", "ellipse", "polygon", "cloud", "textbox", "callout", "line", "arrow", "polyline", "area", "count"]);
const WIDTH_KINDS = new Set<MarkupKind>(["link", "rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "pen", "highlighter", "textbox", "callout", "length", "polylength", "area", "perimeter", "angle"]);
const DASH_KINDS = new Set<MarkupKind>(["link", "rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "textbox", "callout", "length", "polylength", "area", "perimeter", "angle"]);
const END_KINDS = new Set<MarkupKind>(["line", "arrow", "polyline", "length", "polylength"]);
const MEASURE_KINDS = new Set<MarkupKind>(["length", "polylength", "area", "perimeter", "count", "angle"]);
const TEXT_KINDS = new Set<MarkupKind>(["textbox", "callout"]);
const COLOUR_KINDS = new Set<MarkupKind>(["link", "rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "pen", "highlighter", "textbox", "callout", "note", "highlight", "underline", "strikeout", "stamp", "length", "polylength", "area", "perimeter", "count", "angle"]);

const DASHES: { label: string; value: number[] | null }[] = [
  { label: "Solid", value: null },
  { label: "Dashed", value: [6, 3] },
  { label: "Long dash", value: [12, 4] },
  { label: "Dotted", value: [1.5, 2.5] },
  { label: "Dash dot", value: [8, 3, 1.5, 3] },
];

const dashLabel = (d: number[] | null) => DASHES.find((x) => JSON.stringify(x.value) === JSON.stringify(d))?.label ?? "Custom";

function ColourField({ label, value, allowNone, onChange, testId }: { label: string; value: [number, number, number] | null; allowNone?: boolean; onChange: (v: [number, number, number] | null) => void; testId?: string }) {
  return (
    <div className="prop-row">
      <span>{label}</span>
      <div className="prop-colour">
        <input type="color" value={value ? colourHex(value).toLowerCase() : "#ffffff"} onChange={(e) => onChange(hexColour(e.target.value))} data-testid={testId} aria-label={label} />
        {allowNone && (
          <label className="check small">
            <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? null : [1, 1, 1])} /> None
          </label>
        )}
      </div>
    </div>
  );
}

function TextField({ label, value, onCommit, multiline, testId }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => v !== value && onCommit(v);
  return (
    <label className="prop-row stacked">
      <span>{label}</span>
      {multiline ? (
        <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={done} rows={3} data-testid={testId} />
      ) : (
        <input value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} data-testid={testId} />
      )}
    </label>
  );
}

function StyleEditor({ kinds, style, onStyle }: { kinds: MarkupKind[]; style: MarkupStyle; onStyle: (patch: Partial<MarkupStyle>, tag: string) => void }) {
  const all = (set: Set<MarkupKind>) => kinds.every((k) => set.has(k));
  return (
    <>
      {all(COLOUR_KINDS) && <ColourField label={kinds.every((k) => TEXT_KINDS.has(k)) ? "Border colour" : "Colour"} value={style.color} allowNone={kinds.every((k) => TEXT_KINDS.has(k) || k === "rectangle" || k === "ellipse" || k === "polygon" || k === "link")} onChange={(v) => onStyle({ color: v }, "colour")} testId="prop-colour" />}
      {all(FILL_KINDS) && <ColourField label={kinds.every((k) => END_KINDS.has(k)) ? "Arrowhead fill" : "Fill"} value={style.fill} allowNone onChange={(v) => onStyle({ fill: v }, "fill")} testId="prop-fill" />}
      <label className="prop-row">
        <span>Opacity</span>
        <input type="range" min={5} max={100} value={Math.round(style.opacity * 100)} onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 }, "opacity")} data-testid="prop-opacity" />
        <span className="prop-value">{Math.round(style.opacity * 100)}%</span>
      </label>
      {all(WIDTH_KINDS) && (
        <label className="prop-row">
          <span>Line width</span>
          <input type="number" min={0} max={72} step={0.25} value={style.width} onChange={(e) => onStyle({ width: Math.max(0, Number(e.target.value)) }, "width")} data-testid="prop-width" />
          <span className="prop-value">pt</span>
        </label>
      )}
      {all(DASH_KINDS) && (
        <label className="prop-row">
          <span>Line style</span>
          <select value={dashLabel(style.dash)} onChange={(e) => onStyle({ dash: DASHES.find((d) => d.label === e.target.value)?.value ?? null }, "dash")} data-testid="prop-dash">
            {DASHES.map((d) => (
              <option key={d.label}>{d.label}</option>
            ))}
            {dashLabel(style.dash) === "Custom" && <option>Custom</option>}
          </select>
        </label>
      )}
      {(all(END_KINDS) || kinds.every((k) => k === "callout")) && (
        <label className="prop-row">
          <span>{kinds.every((k) => k === "callout") ? "Leader end" : "Start"}</span>
          <select value={style.lineStart} onChange={(e) => onStyle({ lineStart: e.target.value as MarkupStyle["lineStart"] }, "lineStart")} data-testid="prop-line-start">
            {LINE_ENDS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      {all(END_KINDS) && (
        <label className="prop-row">
          <span>End</span>
          <select value={style.lineEnd} onChange={(e) => onStyle({ lineEnd: e.target.value as MarkupStyle["lineEnd"] }, "lineEnd")} data-testid="prop-line-end">
            {LINE_ENDS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      {kinds.every((k) => k === "cloud") && (
        <label className="prop-row">
          <span>Cloud size</span>
          <input type="range" min={0.2} max={2} step={0.1} value={style.cloudIntensity} onChange={(e) => onStyle({ cloudIntensity: Number(e.target.value) }, "cloud")} />
        </label>
      )}
      {all(MEASURE_KINDS) && (
        <label className="prop-row">
          <span>Caption size</span>
          <input type="number" min={4} max={72} step={0.5} value={style.fontSize} onChange={(e) => onStyle({ fontSize: Math.max(4, Number(e.target.value)) }, "fontSize")} data-testid="prop-caption-size" />
          <span className="prop-value">pt</span>
        </label>
      )}
      {all(TEXT_KINDS) && (
        <>
          <label className="prop-row">
            <span>Font</span>
            <select value={style.fontFamily} onChange={(e) => onStyle({ fontFamily: e.target.value as MarkupStyle["fontFamily"] }, "font")} data-testid="prop-font">
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f === "Times-Roman" ? "Times" : f}
                </option>
              ))}
            </select>
          </label>
          <label className="prop-row">
            <span>Font size</span>
            <input type="number" min={4} max={144} step={0.5} value={style.fontSize} onChange={(e) => onStyle({ fontSize: Math.max(4, Number(e.target.value)) }, "fontSize")} data-testid="prop-font-size" />
            <span className="prop-value">pt</span>
          </label>
          <ColourField label="Text colour" value={style.textColor} onChange={(v) => v && onStyle({ textColor: v }, "textColour")} testId="prop-text-colour" />
          <label className="prop-row">
            <span>Align</span>
            <select value={style.align} onChange={(e) => onStyle({ align: Number(e.target.value) as 0 | 1 | 2 }, "align")}>
              <option value={0}>Left</option>
              <option value={1}>Centre</option>
              <option value={2}>Right</option>
            </select>
          </label>
        </>
      )}
    </>
  );
}

function fitText(m: Markup): Markup {
  if (m.kind !== "textbox" && m.kind !== "callout") return m;
  const s = m.style;
  const need = textBoxHeight(s.fontFamily, s.fontSize, m.contents || "Ag", m.rect[2] - m.rect[0], textPadding(m));
  return need > m.rect[3] - m.rect[1] ? { ...m, rect: [m.rect[0], m.rect[1], m.rect[2], m.rect[1] + need] } : m;
}

export function PropertiesPanel({ tab }: { tab: DocTab }) {
  const tool = useApp((s) => s.tools.tool);
  const defaults = useApp((s) => s.tools.defaults);
  const selected = tab.selection.map((id) => tab.state.markups[id]).filter(Boolean);

  if (selected.length) {
    const first = selected[0];
    const kinds = [...new Set(selected.map((m) => m.kind))];
    const editable = selected.filter((m) => !m.locked);
    const update = (label: string, fn: (m: Markup) => Markup, tag?: string, includeLocked = false) => {
      const targets = includeLocked ? selected : editable;
      if (!targets.length) return;
      commit(tab.key, label, (s) => withMarkups(s, targets.map((m) => ({ ...fn(m), modified: nowIso() }))), tag ? `${tag}:${targets.map((m) => m.id).join(",")}` : undefined);
    };
    const styleKinds = kinds.filter((k) => k !== "foreign" && k !== "image");
    return (
      <div className="panel-body props" data-testid="properties">
        <div className="panel-title">
          {selected.length === 1 ? KIND_LABELS[first.kind] + (first.kind === "foreign" ? ` (${first.subtype})` : "") : `${selected.length} markups`}
          {selected.some((m) => m.locked) && <span className="badge">Locked</span>}
        </div>
        {styleKinds.length === kinds.length && !first.keepAppearance && <StyleEditor kinds={styleKinds} style={first.style} onStyle={(patch, tag) => update("Change properties", (m) => fitText({ ...m, style: { ...m.style, ...patch } }), tag)} />}
        <div className="prop-sep" />
        {selected.length === 1 && first.kind === "link" && (
          <div className="prop-row link-target">
            <span>Goes to</span>
            <button className="link-go" onClick={() => first.link && followLink(tab, first.link)} title="Follow the link" data-testid="prop-link-target">
              {describeTarget(tab, first.link)}
            </button>
            <button className="btn small" onClick={() => openLinkDialog({ editId: first.id })} disabled={first.locked} data-testid="prop-link-edit">
              Change…
            </button>
          </div>
        )}
        {selected.length === 1 && (
          <>
            <TextField label={TEXT_KINDS.has(first.kind) ? "Text" : "Comment"} value={first.contents} multiline onCommit={(v) => update("Edit comment", (m) => fitText({ ...m, contents: v }))} testId="prop-comment" />
            <TextField label="Subject" value={first.subject} onCommit={(v) => update("Edit subject", (m) => ({ ...m, subject: v }))} testId="prop-subject" />
            <TextField label="Author" value={first.author} onCommit={(v) => update("Edit author", (m) => ({ ...m, author: v }))} testId="prop-author" />
            <div className="prop-row">
              <span>Created</span>
              <span className="prop-value">{formatDate(first.created)}</span>
            </div>
            <div className="prop-row">
              <span>Modified</span>
              <span className="prop-value">{formatDate(first.modified)}</span>
            </div>
          </>
        )}
        <label className="prop-row">
          <span>Status</span>
          <select value={selected.every((m) => m.status === first.status) ? first.status : ""} onChange={(e) => cmd.setStatus(selected.map((m) => m.id), e.target.value as ReviewStatus)} data-testid="prop-status">
            {!selected.every((m) => m.status === first.status) && <option value="">(mixed)</option>}
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {first.status === "Cancelled" && <option value="Cancelled">Cancelled</option>}
          </select>
        </label>
        <label className="check prop-row">
          <input type="checkbox" checked={selected.every((m) => m.locked)} onChange={(e) => cmd.setLocked(e.target.checked)} data-testid="prop-locked" /> Locked
        </label>
        {selected.length === 1 && <ReplyThread tabKey={tab.key} markup={first} />}
      </div>
    );
  }

  const isDrawTool = tool in KIND_LABELS && tool !== "foreign";
  if (isDrawTool) {
    const kind = tool as MarkupKind;
    const style = defaults[kind] ?? defaultStyleFor(kind);
    return (
      <div className="panel-body props">
        <div className="panel-title">{KIND_LABELS[kind]} tool</div>
        <p className="muted pad">New markups use these properties.</p>
        {kind !== "image" && <StyleEditor kinds={[kind]} style={style} onStyle={(patch) => useApp.setState((s) => ({ tools: { ...s.tools, defaults: { ...s.tools.defaults, [kind]: { ...style, ...patch } } } }))} />}
      </div>
    );
  }

  return (
    <div className="panel-body props">
      <div className="panel-title">Document</div>
      <div className="prop-row">
        <span>File</span>
        <span className="prop-value wrap">{tab.name}</span>
      </div>
      <div className="prop-row">
        <span>Pages</span>
        <span className="prop-value">{tab.state.pages.length}</span>
      </div>
      <div className="prop-row">
        <span>Markups</span>
        <span className="prop-value">{Object.keys(tab.state.markups).length}</span>
      </div>
      <p className="muted pad">Select a markup to edit its properties.</p>
    </div>
  );
}
