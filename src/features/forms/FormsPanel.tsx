import { useEffect, useRef, useState } from "react";
import type { FormField } from "../../engine/types";
import { scrollToPage, type DocTab } from "../../state/store";
import { fieldValue, flattenForms, isChecked, setField, toggleField } from "./forms";

/** Text input that commits on every keystroke (consecutive keystrokes share an undo step). */
function TextField({ tab, f, value }: { tab: DocTab; f: FormField; value: string }) {
  const props = {
    id: `field-${f.name}`,
    value,
    disabled: f.readOnly,
    maxLength: f.maxLen > 0 ? f.maxLen : undefined,
    onChange: (e: { target: { value: string } }) => setField(tab.key, f, e.target.value),
    "data-testid": "form-input",
    "data-field": f.name,
  };
  return f.multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />;
}

function FieldInput({ tab, f }: { tab: DocTab; f: FormField }) {
  const value = fieldValue(tab, f);
  switch (f.type) {
    case "text":
      return <TextField tab={tab} f={f} value={value} />;
    case "checkbox":
      return <input id={`field-${f.name}`} type="checkbox" checked={isChecked(value)} disabled={f.readOnly} onChange={() => toggleField(tab.key, f, value)} data-testid="form-input" data-field={f.name} />;
    case "radio":
      return (
        <span className="form-radios" id={`field-${f.name}`}>
          {[...new Set(f.widgets.map((w) => w.on).filter((x): x is string => !!x))].map((on) => (
            <label key={on}>
              <input type="radio" name={`radio-${tab.key}-${f.name}`} checked={value === on} disabled={f.readOnly} onChange={() => toggleField(tab.key, f, value, on)} data-testid="form-input" data-field={f.name} value={on} />
              {on}
            </label>
          ))}
        </span>
      );
    case "choice":
      return (
        <select id={`field-${f.name}`} value={value} disabled={f.readOnly} onChange={(e) => setField(tab.key, f, e.target.value)} data-testid="form-input" data-field={f.name}>
          {!f.options.includes(value) && <option value={value}>{value}</option>}
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    default:
      return <span className="muted">{f.type === "signature" ? "Signature field (not filled here)" : "Button"}</span>;
  }
}

export function FormsPanel({ tab }: { tab: DocTab }) {
  const [filter, setFilter] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const focus = tab.formFocus;
  useEffect(() => {
    if (!focus) return;
    const el = body.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focus.name)}"]`);
    el?.scrollIntoView({ block: "nearest" });
    el?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [focus]);

  const fields = tab.fields;
  if (!fields) return <div className="panel-body" data-testid="forms-panel"><div className="panel-title">Form</div><p className="muted">{tab.info.hasForm ? "Reading the form…" : "This document has no form fields."}</p></div>;
  const pageOf = new Map(tab.state.pages.map((p, i) => [p.src, i]));
  const q = filter.trim().toLowerCase();
  const shown = fields
    .filter((f) => !q || f.name.toLowerCase().includes(q) || fieldValue(tab, f).toLowerCase().includes(q))
    .map((f) => ({ f, at: f.widgets.map((w) => ({ w, i: pageOf.get(w.page) ?? Infinity })).sort((a, b) => a.i - b.i || a.w.rect[1] - b.w.rect[1])[0] }))
    // page order, then top to bottom (page space runs down the page)
    .sort((a, b) => (a.at?.i ?? Infinity) - (b.at?.i ?? Infinity) || (a.at?.w.rect[1] ?? 0) - (b.at?.w.rect[1] ?? 0));
  const changed = Object.keys(tab.state.fields ?? {}).length;

  return (
    <div className="panel-body forms" data-testid="forms-panel" ref={body}>
      <div className="panel-title">Form</div>
      <div className="form-actions">
        <input type="search" placeholder="Filter fields" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter fields" />
        <button className="btn" onClick={() => flattenForms(tab)} disabled={!fields.length} data-testid="form-flatten">
          Flatten…
        </button>
      </div>
      <p className="muted form-summary" data-testid="form-summary">
        {fields.length} field{fields.length === 1 ? "" : "s"}
        {changed ? `, ${changed} unsaved` : ""}
      </p>
      <ul className="form-list">
        {shown.map(({ f, at }) => (
          <li key={f.name} data-row={f.name} data-testid="form-field" className={tab.formFocus?.name === f.name ? "focus" : ""}>
            <label htmlFor={`field-${f.name}`}>
              <button
                className="form-name"
                title="Show on the page"
                onClick={() => at && Number.isFinite(at.i) && scrollToPage(tab.key, at.i, at.w.rect)}
              >
                {f.name}
              </button>
              {at && Number.isFinite(at.i) && <span className="muted"> p. {tab.state.pages[at.i].label}</span>}
              {f.readOnly && <span className="muted"> (read-only)</span>}
            </label>
            <FieldInput tab={tab} f={f} />
          </li>
        ))}
      </ul>
    </div>
  );
}
