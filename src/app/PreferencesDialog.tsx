import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { setAuthor, useApp } from "../state/store";

const useOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openPreferences = () => useOpen.setState({ open: true });

export function PreferencesDialog() {
  const open = useOpen((s) => s.open);
  const author = useApp((s) => s.author);
  const [name, setName] = useState(author);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { useOpen.setState({ open: o }); if (o) setName(useApp.getState().author); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title>Preferences</Dialog.Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAuthor(name);
              useOpen.setState({ open: false });
            }}
          >
            <label className="field">
              <span>Author name for new markups</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="pref-author" />
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
