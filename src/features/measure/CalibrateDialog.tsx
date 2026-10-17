import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { dist } from "../../markup/geometry";
import { convert, IMPERIAL_PRESETS, METRIC_PRESETS, scaleFromPoints, scaleLabel, UNIT_LABELS, UNITS, unitsPerPoint, type PageScale, type Unit } from "../../markup/measure";
import { activeTab, flash, setPageScale, useApp } from "../../state/store";
import { parsePageRange } from "../pages/pageOps";
import { useCalibrationPick } from "../viewer/controller";
import { setTool } from "../../app/commands";

const useDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openCalibrateDialog = () => activeTab() && useDialog.setState({ open: true });

// a calibration pick opens the dialog
useCalibrationPick.subscribe((s) => {
  if (s.pick) useDialog.setState({ open: true });
});

export function CalibrateDialog() {
  const open = useDialog((s) => s.open);
  const pick = useCalibrationPick((s) => s.pick);
  const tab = useApp(activeTab);
  const n = tab?.state.pages.length ?? 0;
  const current = tab?.state.pages[tab.currentPage];
  const [mode, setMode] = useState<"preset" | "points">("preset");
  const [preset, setPreset] = useState("1:100");
  const [known, setKnown] = useState("");
  const [knownUnit, setKnownUnit] = useState<Unit>("m");
  const [display, setDisplay] = useState<Unit>("m");
  const [precision, setPrecision] = useState(2);
  const [which, setWhich] = useState<"current" | "all" | "range">("current");
  const [range, setRange] = useState("1");

  useEffect(() => {
    if (!open) return;
    if (pick) setMode("points");
    const s = current?.scale;
    if (s) {
      setDisplay(s.displayUnit);
      setPrecision(s.precision);
    }
  }, [open, pick, current?.scale]);

  const close = () => {
    useDialog.setState({ open: false });
    useCalibrationPick.setState({ pick: null });
  };

  if (!tab) return null;
  const allPresets = [...METRIC_PRESETS, ...IMPERIAL_PRESETS];
  const pickPts = pick ? dist(pick.a, pick.b) : 0;
  const knownVal = parseFloat(known.replace(",", "."));
  let scale: PageScale | null = null;
  if (mode === "preset") {
    const p = allPresets.find((x) => x.label === preset);
    if (p) scale = { ...p.scale, displayUnit: display, precision };
  } else if (pick && knownVal > 0) {
    const s = scaleFromPoints(pickPts, knownVal, knownUnit, precision);
    // metric lengths keep the ratio in millimetres so it reads 1:NNN
    scale = knownUnit === "in" || knownUnit === "ft" ? { ...s, displayUnit: display } : { paper: 1, paperUnit: "mm", real: convert(s.real, knownUnit, "mm"), realUnit: "mm", displayUnit: display, precision };
  }
  const pageIds =
    which === "current" ? (current ? [current.id] : []) : which === "all" ? tab.state.pages.map((p) => p.id) : (parsePageRange(range, n) ?? []).map((i) => tab.state.pages[i].id);
  const apply = () => {
    if (!scale || !pageIds.length) return;
    setPageScale(tab.key, pageIds, scale);
    flash(`Scale ${scaleLabel(scale)} set on ${pageIds.length} page${pageIds.length === 1 ? "" : "s"}.`);
    close();
    setTool("select");
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined} data-testid="calibrate-dialog">
          <Dialog.Title>Page scale</Dialog.Title>
          <p className="muted">Current page: {current?.scale ? scaleLabel(current.scale) : "not calibrated (measures at full size)"}</p>
          <label className="check">
            <input type="radio" checked={mode === "preset"} onChange={() => setMode("preset")} /> Preset scale
            <select value={preset} onChange={(e) => { setPreset(e.target.value); setMode("preset"); }} data-testid="cal-preset">
              <optgroup label="Metric">
                {METRIC_PRESETS.map((p) => (
                  <option key={p.label}>{p.label}</option>
                ))}
              </optgroup>
              <optgroup label="Imperial">
                {IMPERIAL_PRESETS.map((p) => (
                  <option key={p.label}>{p.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="check">
            <input type="radio" checked={mode === "points"} onChange={() => setMode("points")} disabled={!pick} /> Two points
            {pick ? <span className="muted"> ({(pickPts * 25.4 / 72).toFixed(1)} mm apart on paper) are</span> : <span className="muted"> (use the Calibrate tool to pick them)</span>}
          </label>
          {pick && (
            <div className="field-row">
              <input className="small" value={known} onChange={(e) => { setKnown(e.target.value); setMode("points"); }} placeholder="Length" autoFocus data-testid="cal-known" />
              <select value={knownUnit} onChange={(e) => setKnownUnit(e.target.value as Unit)} data-testid="cal-known-unit">
                {UNITS.map((u) => (
                  <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field-row">
            <label>
              Show in{" "}
              <select value={display} onChange={(e) => setDisplay(e.target.value as Unit)} data-testid="cal-display">
                {UNITS.map((u) => (
                  <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                ))}
              </select>
            </label>
            <label>
              Decimal places{" "}
              <select value={precision} onChange={(e) => setPrecision(Number(e.target.value))} data-testid="cal-precision">
                {[0, 1, 2, 3, 4].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span>Apply to</span>
            <label className="check">
              <input type="radio" checked={which === "current"} onChange={() => setWhich("current")} /> This page
            </label>
            <label className="check">
              <input type="radio" checked={which === "all"} onChange={() => setWhich("all")} data-testid="cal-all" /> All pages ({n})
            </label>
            <label className="check">
              <input type="radio" checked={which === "range"} onChange={() => setWhich("range")} /> Pages
              <input className="small" value={range} onChange={(e) => { setRange(e.target.value); setWhich("range"); }} />
            </label>
          </div>
          {scale && <p className="muted" data-testid="cal-summary">Scale {scaleLabel(scale)}: 10 mm on paper measures {(unitsPerPoint(scale) * 72 / 2.54).toFixed(precision)} {display}.</p>}
          <div className="dialog-buttons">
            {current?.scale && (
              <button className="btn" onClick={() => { setPageScale(tab.key, pageIds, null); close(); }}>
                Remove scale
              </button>
            )}
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" disabled={!scale || !pageIds.length} onClick={apply} data-testid="cal-ok">
              Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
