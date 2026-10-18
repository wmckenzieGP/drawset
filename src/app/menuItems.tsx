/** Menu rows shared by the menu bar and the right-click menus; command rows read their label and keys from the key map. */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useApp } from "../state/store";
import { commandById } from "./keymap";

export function Item({ label, shortcut, onSelect, disabled, testId }: { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; testId?: string }) {
  return (
    <Menu.Item className="menu-item" onSelect={onSelect} disabled={disabled} data-testid={testId}>
      <span>{label}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </Menu.Item>
  );
}

export const Sep = () => <Menu.Separator className="menu-sep" />;

const shown = (k: string | undefined) => k?.replace(/Plus$/, "+").replace(/Minus$/, "-");

/** A key-map command. `run` replaces what it does (for example pasting where a menu was opened) but keeps its keys. */
export function C({ id, label, disabled, checked, run }: { id: string; label?: string; disabled?: boolean; checked?: boolean; run?: () => void }) {
  const c = commandById.get(id)!;
  const has = useApp((s) => s.tabs.length > 0);
  return <Item label={`${checked ? "✓ " : ""}${label ?? c.label}`} shortcut={shown(c.keys[0])} onSelect={run ?? (() => void c.run())} disabled={disabled || (c.doc && !has)} testId={`cm-${id}`} />;
}

export function Sub({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className="menu-item" disabled={disabled}>
        <span>{label}</span>
        <span className="menu-shortcut">▸</span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className="menu" sideOffset={4}>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}
