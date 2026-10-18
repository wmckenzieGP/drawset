import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { create } from "zustand";
import { COMMANDS } from "./keymap";

const useOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openShortcuts = () => useOpen.setState({ open: true });

/** Every keyboard shortcut, grouped as in the menus, with a filter. */
export function ShortcutsDialog() {
  const open = useOpen((s) => s.open);
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const rows = COMMANDS.filter((c) => c.keys.length && (!f || c.label.toLowerCase().includes(f) || c.keys.some((k) => k.toLowerCase().includes(f))));
  const groups = [...new Set(rows.map((c) => c.group))];
  return (
    <Dialog.Root open={open} onOpenChange={(o) => useOpen.setState({ open: o })}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide shortcuts" aria-describedby={undefined} data-testid="shortcuts-dialog">
          <Dialog.Title>Keyboard shortcuts</Dialog.Title>
          <input className="shortcuts-filter" placeholder="Find a command or key" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus aria-label="Find a shortcut" />
          <div className="shortcuts-list">
            {groups.map((g) => (
              <section key={g}>
                <h3>{g}</h3>
                <table>
                  <tbody>
                    {rows
                      .filter((c) => c.group === g)
                      .map((c) => (
                        <tr key={c.id}>
                          <td>{c.label}</td>
                          <td className="keys">
                            {c.keys.map((k) => (
                              <kbd key={k}>{k.replace(/Plus$/, "+").replace(/Minus$/, "−")}</kbd>
                            ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <p className="muted">Hold Ctrl with the mouse wheel to zoom instead of scroll (or scroll instead of zoom). Hold Space, or drag with the middle button, to pan. Hold Shift while drawing for straight lines at 45° steps; hold Alt to draw without snapping.</p>
          <div className="dialog-buttons">
            <Dialog.Close className="btn primary">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
