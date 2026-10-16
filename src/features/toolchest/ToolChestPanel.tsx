import { useRef } from "react";
import { Icon } from "../../app/icons";
import { KIND_LABELS, type RGB } from "../../markup/model";
import { saveAs } from "../../platform/host";
import { flash, useApp, type DocTab } from "../../state/store";
import { addSet, addTools, importSet, noteRecent, removeSet, removeTool, renameSet, setToJson, updateTool, useChest, type ChestTool } from "./chest";

const css = (c: RGB | null | undefined) => (c ? `rgb(${c.map((v) => Math.round(v * 255)).join(",")})` : "transparent");

export function activateChestTool(tool: ChestTool) {
  noteRecent(tool);
  useApp.setState((s) => ({ tools: { ...s.tools, chest: tool, tool: tool.mode === "copy" ? "chest" : tool.template.kind } }));
}

/** Adds the selected markups of `tab` to the current set. */
export function addSelectionToChest(tab: DocTab) {
  const ms = tab.selection.map((id) => tab.state.markups[id]).filter(Boolean);
  const n = addTools(ms);
  if (n) flash(`${n} tool${n === 1 ? "" : "s"} added to the Tool Chest.`);
  else flash("Select a markup to add. Text highlights and redactions cannot be tools.", "error");
}

function ToolRow({ tool, active }: { tool: ChestTool; active: boolean }) {
  const s = tool.template.style;
  return (
    <li className={`tc-tool ${active ? "active" : ""}`} data-testid="tc-tool">
      <button className="tc-use" onClick={() => activateChestTool(tool)} title={`${KIND_LABELS[tool.template.kind]}: ${tool.mode === "copy" ? "click to place a copy" : "draw with these properties"}`}>
        <span className="tc-swatch" style={{ borderColor: css(s.color), background: css(s.fill) }}>
          <Icon name={tool.template.kind} size={14} />
        </span>
        <span className="tc-name">{tool.name}</span>
      </button>
      <button
        className="tc-mode"
        onClick={() => updateTool(tool.id, { mode: tool.mode === "copy" ? "draw" : "copy" })}
        title={tool.mode === "copy" ? "Places a copy; switch to drawing with these properties" : "Draws with these properties; switch to placing a copy"}
        data-testid="tc-mode"
      >
        {tool.mode === "copy" ? "Copy" : "Draw"}
      </button>
      <button
        className="icon-btn"
        title="Rename"
        onClick={() => {
          const name = window.prompt("Tool name", tool.name);
          if (name?.trim()) updateTool(tool.id, { name: name.trim() });
        }}
      >
        <Icon name="edit" size={13} />
      </button>
      <button className="icon-btn" title="Remove from the Tool Chest" onClick={() => removeTool(tool.id)}>
        <Icon name="close" size={13} />
      </button>
    </li>
  );
}

export function ToolChestPanel({ tab }: { tab: DocTab }) {
  const sets = useChest((s) => s.sets);
  const recents = useChest((s) => s.recents);
  const currentSet = useChest((s) => s.currentSet);
  const active = useApp((s) => s.tools.chest?.id);
  const file = useRef<HTMLInputElement>(null);

  const exportSet = async (id: string) => {
    const set = sets.find((x) => x.id === id);
    if (!set) return;
    await saveAs(`${set.name}.json`, new TextEncoder().encode(setToJson(set)), "Drawset tool sets", "json", "application/json");
  };

  return (
    <div className="panel-body toolchest" data-testid="toolchest-panel">
      <div className="panel-title">Tool Chest</div>
      <div className="tc-actions">
        <button className="btn" onClick={() => addSelectionToChest(tab)} disabled={!tab.selection.length} data-testid="tc-add">
          Add selected
        </button>
        <select value={currentSet} onChange={(e) => useChest.setState({ currentSet: e.target.value })} title="Set that new tools go into" data-testid="tc-current-set">
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="tc-actions">
        <button
          className="btn"
          onClick={() => {
            const name = window.prompt("Name of the new set", "New set");
            if (name?.trim()) addSet(name.trim());
          }}
          data-testid="tc-new-set"
        >
          New set
        </button>
        <button className="btn" onClick={() => file.current?.click()} data-testid="tc-import">
          Import…
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="tc-import-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const set = importSet(await f.text());
              flash(`Imported ${set.tools.length} tool${set.tools.length === 1 ? "" : "s"} as "${set.name}".`);
            } catch (err) {
              flash(`Could not import ${f.name}: ${(err as Error).message}`, "error");
            }
          }}
        />
      </div>

      {recents.length > 0 && (
        <section>
          <div className="panel-subtitle">Recent</div>
          <ul className="tc-list" data-testid="tc-recents">
            {recents.map((t) => (
              <ToolRow key={t.id} tool={t} active={active === t.id} />
            ))}
          </ul>
        </section>
      )}

      {sets.map((set) => (
        <section key={set.id} data-testid="tc-set">
          <div className="tc-set-head">
            <span className="panel-subtitle">{set.name}</span>
            <button
              className="icon-btn"
              title="Rename set"
              onClick={() => {
                const name = window.prompt("Set name", set.name);
                if (name?.trim()) renameSet(set.id, name.trim());
              }}
            >
              <Icon name="edit" size={13} />
            </button>
            <button className="icon-btn" title="Export set as JSON" onClick={() => exportSet(set.id)} data-testid="tc-export-set">
              <Icon name="save" size={13} />
            </button>
            <button
              className="icon-btn"
              title="Delete set"
              onClick={() => {
                if (!set.tools.length || window.confirm(`Delete the set "${set.name}" and its ${set.tools.length} tools?`)) removeSet(set.id);
              }}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
          {set.tools.length === 0 ? (
            <p className="muted">Select a markup and choose Add selected.</p>
          ) : (
            <ul className="tc-list">
              {set.tools.map((t) => (
                <ToolRow key={t.id} tool={t} active={active === t.id} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
