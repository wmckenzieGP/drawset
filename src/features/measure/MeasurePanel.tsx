import { useMemo } from "react";
import { KIND_LABELS, type Markup, type MarkupKind } from "../../markup/model";
import { convert, formatNumber, isMeasure, measureValue, scaleLabel } from "../../markup/measure";
import { nowIso } from "../../markup/model";
import { commit, withMarkups, type DocTab } from "../../state/store";
import { setVolumeDepth } from "../viewer/create";
import { openCalibrateDialog } from "./CalibrateDialog";

export interface Total {
  kind: MarkupKind;
  unit: string;
  count: number;
  total: number;
  precision: number;
}

/** Sums measurement values by type and unit (lengths in m and in ft stay separate). */
export function totalsByType(ms: Markup[]): Total[] {
  const map = new Map<string, Total>();
  for (const m of ms) {
    if (!isMeasure(m.kind)) continue;
    const v = measureValue(m);
    const key = `${m.kind}|${v.unit}`;
    const t = map.get(key) ?? { kind: m.kind, unit: v.unit, count: 0, total: 0, precision: m.measure?.scale?.precision ?? 0 };
    t.count++;
    t.total += v.value;
    t.precision = Math.max(t.precision, m.measure?.scale?.precision ?? 0);
    map.set(key, t);
  }
  const order: MarkupKind[] = ["length", "polylength", "dimension", "perimeter", "radius", "diameter", "area", "volume", "count", "angle"];
  return [...map.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.unit.localeCompare(b.unit));
}

export function formatTotal(t: Total): string {
  if (t.kind === "count") return `${t.total}`;
  if (t.kind === "angle") return `${formatNumber(t.total, Math.min(t.precision, 2) || 1)}°`;
  return `${formatNumber(t.total, t.precision)} ${t.unit}`;
}

export function MeasurePanel({ tab }: { tab: DocTab }) {
  const page = tab.state.pages[tab.currentPage];
  const selected = tab.selection.map((id) => tab.state.markups[id]).filter((m) => m && isMeasure(m.kind));
  const pageTotals = useMemo(() => totalsByType(Object.values(tab.state.markups).filter((m) => m.pageId === page?.id)), [tab.state.markups, page?.id]);
  return (
    <div className="panel-body measure-panel" data-testid="measure-panel">
      <div className="panel-title">Measurements</div>
      <div className="prop-row">
        <span>Page scale</span>
        <span data-testid="page-scale">{page?.scale ? scaleLabel(page.scale) : "Not set"}</span>
      </div>
      <button className="btn" onClick={openCalibrateDialog} data-testid="calibrate-open">
        Set scale…
      </button>
      {selected.length > 0 && (
        <>
          <div className="panel-subtitle">Selected</div>
          {selected.length === 1 ? (
            <div className="measure-value" data-testid="measure-value">
              {KIND_LABELS[selected[0].kind]}: {measureValue(selected[0]).text}
              {selected[0].kind === "area" && (selected[0].measure?.cutouts.length ?? 0) > 0 && <span className="muted"> ({selected[0].measure!.cutouts.length} cutout{selected[0].measure!.cutouts.length === 1 ? "" : "s"})</span>}
            </div>
          ) : (
            totalsByType(selected).map((t) => (
              <div key={t.kind + t.unit} className="prop-row">
                <span>{KIND_LABELS[t.kind]} ({t.count})</span>
                <span>{formatTotal(t)}</span>
              </div>
            ))
          )}
          {selected.length === 1 && selected[0].kind === "volume" && <VolumeDepth tab={tab} m={selected[0]} />}
        </>
      )}
      {pageTotals.length > 0 && (
        <>
          <div className="panel-subtitle">This page</div>
          {pageTotals.map((t) => (
            <div key={t.kind + t.unit} className="prop-row">
              <span>{KIND_LABELS[t.kind]} ({t.count})</span>
              <span>{formatTotal(t)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** The depth a volume is measured to, in the scale's display unit. */
function VolumeDepth({ tab, m }: { tab: DocTab; m: Markup }) {
  const unit = m.measure?.scale?.displayUnit ?? "m";
  const shown = Math.round(convert(m.measure?.depth ?? 1, "m", unit) * 1e6) / 1e6;
  return (
    <label className="prop-row">
      <span>Depth</span>
      <input
        type="number"
        min={0}
        step="any"
        value={shown}
        disabled={m.locked}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!(v > 0)) return;
          const depth = convert(v, unit, "m");
          setVolumeDepth(depth);
          commit(tab.key, "Set depth", (s) => withMarkups(s, [{ ...m, measure: { scale: m.measure?.scale ?? null, cutouts: m.measure?.cutouts ?? [], depth }, modified: nowIso() }]), `depth:${m.id}`);
        }}
        data-testid="volume-depth"
      />
      <span className="prop-value">{unit}</span>
    </label>
  );
}
