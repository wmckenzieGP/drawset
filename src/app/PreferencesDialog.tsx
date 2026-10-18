import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { setAuthor, setNavPrefs, useApp, type NavPrefs } from "../state/store";

const useOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openPreferences = () => useOpen.setState({ open: true });

export function PreferencesDialog() {
  const open = useOpen((s) => s.open);
  const author = useApp((s) => s.author);
  const [name, setName] = useState(author);
  const navNow = useApp((s) => s.nav);
  const [nav, setNav] = useState<NavPrefs>(navNow);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { useOpen.setState({ open: o }); if (o) { setName(useApp.getState().author); setNav(useApp.getState().nav); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title>Preferences</Dialog.Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAuthor(name);
              setNavPrefs(nav);
              useOpen.setState({ open: false });
            }}
          >
            <label className="field">
              <span>Author name for new markups</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="pref-author" />
            </label>
            <label className="field">
              <span>Mouse wheel in single page and side by side layouts</span>
              <select value={nav.wheelSingle} onChange={(e) => setNav({ ...nav, wheelSingle: e.target.value as NavPrefs["wheelSingle"] })} data-testid="pref-wheel-single">
                <option value="zoom">Zoom</option>
                <option value="scroll">Scroll</option>
              </select>
            </label>
            <label className="field">
              <span>Mouse wheel in continuous layouts</span>
              <select value={nav.wheelContinuous} onChange={(e) => setNav({ ...nav, wheelContinuous: e.target.value as NavPrefs["wheelContinuous"] })} data-testid="pref-wheel-continuous">
                <option value="scroll">Scroll</option>
                <option value="zoom">Zoom</option>
              </select>
            </label>
            <p className="muted">Hold Ctrl with the wheel to do the other.</p>
            <label className="field">
              <span>Page layout for files you open</span>
              <select value={nav.openMode} onChange={(e) => setNav({ ...nav, openMode: e.target.value as NavPrefs["openMode"] })} data-testid="pref-open-mode">
                <option value="document">By document (several pages continuous, one page single)</option>
                <option value="single">Single page</option>
                <option value="continuous">Continuous</option>
                <option value="sideBySide">Side by side</option>
                <option value="continuousSideBySide">Continuous side by side</option>
              </select>
            </label>
            <div className="dialog-buttons">
              <Dialog.Close className="btn">Cancel</Dialog.Close>
              <button type="submit" className="btn primary">Save</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
