import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import type { HFPosition } from "../../engine/types";
import { activeTab, commit, flash, useApp } from "../../state/store";
import { POSITIONS, POSITION_LABELS, VARIABLES, currentSpec, defaultSpec, fillVariables, formatDate, type HFSpec } from "./hf";

export const useHFDialog = create<{ open: boolean }>(() => ({ open: false }));

export function openHeaderFooter() {
  if (activeTab()) useHFDialog.setState({ open: true });
}

const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Applies settings (null removes them) as one undo step. */
export function applyHeaderFooter(key: string, spec: HFSpec | null) {
  commit(key, spec ? "Headers and footers" : "Remove headers and footers", (s) => ({ ...s, headerFooter: spec }));
}

export function HeaderFooterDialog() {
  const open = useHFDialog((s) => s.open);
  const tab = useApp(activeTab);
  const [spec, setSpec] = useState<HFSpec>(defaultSpec);
  const [wmOn, setWmOn] = useState(false);
  const lastInput = useRef<{ el: HTMLInputElement; pos: HFPosition | "wm" } | null>(null);

  useEffect(() => {
    if (!open || !tab) return;
    const cur = currentSpec(tab);
    setSpec(cur ? { ...cur, text: { ...cur.text } } : defaultSpec());
    setWmOn(!!cur?.watermark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !tab) return null;
  const close = () => useHFDialog.setState({ open: false });
  const existing = currentSpec(tab);
  const n = tab.state.pages.length;
  const wm = spec.watermark ?? { text: "DRAFT", fontSize: 0, colour: [0.85, 0.1, 0.1] as [number, number, number], opacity: 0.2, angle: 45 };
  const setWm = (patch: Partial<typeof wm>) => setSpec((s) => ({ ...s, watermark: { ...wm, ...patch } }));
  const first = tab.state.pages[spec.range ? Math.max(0, spec.range.from - 1) : 0];
  const sample = (t: string) => fillVariables(t, { page: (spec.range?.from ?? 1), pages: n, label: first?.label ?? "1", file: tab.name, date: formatDate(new Date()) });

  const insert = (token: string) => {
    const li = lastInput.current;
    if (!li) return;
    const { el, pos } = li;
    const at = el.selectionStart ?? el.value.length;
    const v = el.value.slice(0, at) + token + el.value.slice(el.selectionEnd ?? at);
    if (pos === "wm") setWm({ text: v });
    else setSpec((s) => ({ ...s, text: { ...s.text, [pos]: v } }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const apply = () => {
    const out: HFSpec = { ...spec, date: formatDate(new Date()), watermark: wmOn && wm.text.trim() ? wm : null };
    const hasText = POSITIONS.some((p) => out.text[p]?.trim());
    if (!hasText && !out.watermark) {
      flash("Type a header, a footer or a watermark first.", "error");
      return;
    }
    applyHeaderFooter(tab.key, out);
    flash("Headers and footers applied. Save to keep them.");
    close();
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide hf-dialog" aria-describedby={undefined} data-testid="hf-dialog">
          <Dialog.Title>Headers, footers and watermark</Dialog.Title>
          <div className="hf-grid">
            {POSITIONS.map((pos) => (
              <label key={pos} className="field">
                <span>{POSITION_LABELS[pos]}</span>
                <input
                  value={spec.text[pos] ?? ""}
                  onFocus={(e) => (lastInput.current = { el: e.target, pos })}
                  onChange={(e) => setSpec((s) => ({ ...s, text: { ...s.text, [pos]: e.target.value } }))}
                  data-testid={`hf-${pos}`}
                />
                {spec.text[pos]?.includes("{") && <span className="muted hf-sample">{sample(spec.text[pos]!)}</span>}
              </label>
            ))}
          </div>
          <div className="hf-vars">
            <span className="muted">Insert:</span>
            {VARIABLES.map((v) => (
              <button key={v.token} className="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v.token)} title={v.label} data-testid={`hf-var-${v.token.slice(1, -1)}`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="hf-row">
            <label>
              Size <input className="small" type="number" min={4} max={72} step={0.5} value={spec.fontSize} onChange={(e) => setSpec((s) => ({ ...s, fontSize: Math.max(4, Number(e.target.value) || 9) }))} data-testid="hf-size" /> pt
            </label>
            <label>
              Colour <input type="color" value={hex(spec.colour)} onChange={(e) => setSpec((s) => ({ ...s, colour: rgb(e.target.value) }))} />
            </label>
            <label>
              Margin <input className="small" type="number" min={0} max={100} step={1} value={spec.marginMm} onChange={(e) => setSpec((s) => ({ ...s, marginMm: Math.max(0, Number(e.target.value) || 0) }))} data-testid="hf-margin" /> mm
            </label>
          </div>
          <fieldset className="hf-wm">
            <legend>
              <label className="check">
                <input type="checkbox" checked={wmOn} onChange={(e) => setWmOn(e.target.checked)} data-testid="hf-wm-on" /> Watermark
              </label>
            </legend>
            {wmOn && (
              <>
                <label className="field">
                  <span>Text</span>
                  <input value={wm.text} onFocus={(e) => (lastInput.current = { el: e.target, pos: "wm" })} onChange={(e) => setWm({ text: e.target.value })} data-testid="hf-wm-text" />
                </label>
                <div className="hf-row">
                  <label>
                    Size <input className="small" type="number" min={0} max={400} value={wm.fontSize} onChange={(e) => setWm({ fontSize: Math.max(0, Number(e.target.value) || 0) })} title="0 fits the text across the page" /> pt (0 fits the page)
                  </label>
                  <label>
                    Angle <input className="small" type="number" min={-90} max={90} value={wm.angle} onChange={(e) => setWm({ angle: Math.max(-90, Math.min(90, Number(e.target.value) || 0)) })} />°
                  </label>
                  <label>
                    Colour <input type="color" value={hex(wm.colour)} onChange={(e) => setWm({ colour: rgb(e.target.value) })} />
                  </label>
                  <label>
                    Opacity <input className="small" type="number" min={5} max={100} step={5} value={Math.round(wm.opacity * 100)} onChange={(e) => setWm({ opacity: Math.max(0.05, Math.min(1, (Number(e.target.value) || 20) / 100)) })} data-testid="hf-wm-opacity" />%
                  </label>
                </div>
              </>
            )}
          </fieldset>
          <div className="field">
            <label className="check">
              <input type="radio" checked={!spec.range} onChange={() => setSpec((s) => ({ ...s, range: null }))} /> All pages ({n})
            </label>
            <label className="check">
              <input type="radio" checked={!!spec.range} onChange={() => setSpec((s) => ({ ...s, range: { from: 1, to: n } }))} data-testid="hf-range" /> Pages
              <input className="small" type="number" min={1} max={n} value={spec.range?.from ?? 1} onChange={(e) => setSpec((s) => ({ ...s, range: { from: Number(e.target.value) || 1, to: s.range?.to ?? n } }))} aria-label="First page" data-testid="hf-from" />
              to
              <input className="small" type="number" min={1} max={n} value={spec.range?.to ?? n} onChange={(e) => setSpec((s) => ({ ...s, range: { from: s.range?.from ?? 1, to: Number(e.target.value) || n } }))} aria-label="Last page" data-testid="hf-to" />
            </label>
          </div>
          <p className="muted">They are added to the page content when you save, and can be changed or removed here later. The date is today's date when you apply.</p>
          <div className="dialog-buttons">
            {existing && (
              <button
                className="btn"
                onClick={() => {
                  applyHeaderFooter(tab.key, null);
                  flash("Headers and footers removed. Save to keep the change.");
                  close();
                }}
                data-testid="hf-remove"
              >
                Remove all
              </button>
            )}
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" onClick={apply} data-testid="hf-apply">
              Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
