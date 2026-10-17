import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import type { Permissions, SecuritySpec } from "../../engine/types";
import { ensureRights } from "../../state/documents";
import { activeTab, commit, flash, useApp, type DocTab } from "../../state/store";

export const useSecurityDialog = create<{ open: boolean }>(() => ({ open: false }));

export async function openSecurity() {
  const t = activeTab();
  if (!t) return;
  if (t.info.security.encrypted && !(await ensureRights(t.key, "Changing security needs the permissions password."))) return;
  useSecurityDialog.setState({ open: true });
}

const ALL: Permissions = { print: true, copy: true, edit: true, annotate: true, form: true, assemble: true };
const LABELS: [keyof Permissions, string][] = [
  ["print", "Printing"],
  ["copy", "Copying text and images"],
  ["annotate", "Adding and changing markups"],
  ["form", "Filling in form fields"],
  ["assemble", "Inserting, deleting and rotating pages"],
  ["edit", "Other changes to the document"],
];

/** A short description of a document's security, as the status bar and dialog show it. */
export function securitySummary(t: DocTab): string {
  const pending = t.state.security;
  if (pending === "none") return "Security will be removed when you save";
  if (pending) return `New security will be applied when you save${pending.userPassword ? " (password to open)" : ""}`;
  const s = t.info.security;
  if (!s.encrypted) return "Not secured";
  const parts = [s.openPassword ? "Password to open" : "No password to open"];
  const denied = LABELS.filter(([k]) => !s.permissions[k]).map(([, l]) => l.toLowerCase());
  parts.push(denied.length ? `restricted: no ${denied.join(", no ")}` : "no restrictions");
  if (!s.owner) parts.push("permissions password not entered");
  return `${s.method || "Encrypted"}. ${parts.join("; ")}.`;
}

/** Validates and records new security as one undo step (written when the file is saved). */
export function applySecurity(key: string, spec: SecuritySpec | "none" | undefined) {
  commit(key, spec === "none" ? "Remove security" : spec ? "Set security" : "Discard security change", (s) => ({ ...s, security: spec }));
}

export function validateSecurity(o: { open: boolean; pw: string; pw2: string; restrict: boolean; owner: string; owner2: string }): string | null {
  if (!o.open && !o.restrict) return "Choose a password to open, restrictions, or both.";
  if (o.open && !o.pw) return "Type the password to open the file.";
  if (o.open && o.pw !== o.pw2) return "The two open passwords are different.";
  if (o.restrict && !o.owner) return "Type a permissions password.";
  if (o.restrict && o.owner !== o.owner2) return "The two permissions passwords are different.";
  if (o.open && o.restrict && o.pw === o.owner) return "Use a different password for permissions than for opening the file.";
  if ([o.pw, o.owner].some((p) => p.includes(","))) return "Passwords cannot contain commas.";
  return null;
}

export function SecurityDialog() {
  const open = useSecurityDialog((s) => s.open);
  const tab = useApp(activeTab);
  const [needOpen, setNeedOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [restrict, setRestrict] = useState(false);
  const [owner, setOwner] = useState("");
  const [owner2, setOwner2] = useState("");
  const [perms, setPerms] = useState<Permissions>(ALL);

  useEffect(() => {
    if (!open || !tab) return;
    const s = tab.info.security;
    setNeedOpen(s.openPassword);
    setRestrict(s.encrypted && LABELS.some(([k]) => !s.permissions[k]));
    setPerms(s.encrypted ? { ...s.permissions } : { ...ALL, edit: false, assemble: false });
    setPw("");
    setPw2("");
    setOwner("");
    setOwner2("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !tab) return null;
  const close = () => useSecurityDialog.setState({ open: false });
  const apply = () => {
    const err = validateSecurity({ open: needOpen, pw, pw2, restrict, owner, owner2 });
    if (err) {
      flash(err, "error");
      return;
    }
    applySecurity(tab.key, { userPassword: needOpen ? pw : "", ownerPassword: restrict ? owner : pw, permissions: restrict ? perms : ALL });
    flash("Security set. Save to apply it; the file is then rewritten in full.");
    close();
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog security-dialog" aria-describedby={undefined} data-testid="security-dialog">
          <Dialog.Title>Security</Dialog.Title>
          <p className="muted" data-testid="security-current">
            {securitySummary(tab)}
          </p>
          <label className="check">
            <input type="checkbox" checked={needOpen} onChange={(e) => setNeedOpen(e.target.checked)} data-testid="sec-open" /> Require a password to open the file
          </label>
          {needOpen && (
            <div className="sec-pw">
              <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Open password" data-testid="sec-pw" autoComplete="new-password" />
              <input type="password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Confirm open password" data-testid="sec-pw2" autoComplete="new-password" />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} data-testid="sec-restrict" /> Restrict printing and changes
          </label>
          {restrict && (
            <>
              <div className="sec-pw">
                <input type="password" placeholder="Permissions password" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Permissions password" data-testid="sec-owner" autoComplete="new-password" />
                <input type="password" placeholder="Type it again" value={owner2} onChange={(e) => setOwner2(e.target.value)} aria-label="Confirm permissions password" data-testid="sec-owner2" autoComplete="new-password" />
              </div>
              <div className="sec-perms">
                <span className="muted">Allow:</span>
                {LABELS.map(([k, l]) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))} data-testid={`sec-allow-${k}`} /> {l}
                  </label>
                ))}
              </div>
            </>
          )}
          <p className="muted">Files are encrypted with 256-bit AES. Keep the passwords safe: a lost password cannot be recovered.</p>
          <div className="dialog-buttons">
            {(tab.info.security.encrypted || tab.state.security) && (
              <button
                className="btn"
                onClick={() => {
                  applySecurity(tab.key, tab.info.security.encrypted ? "none" : undefined);
                  flash(tab.info.security.encrypted ? "Security will be removed when you save." : "Security change discarded.");
                  close();
                }}
                data-testid="sec-remove"
              >
                Remove security
              </button>
            )}
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" onClick={apply} data-testid="sec-apply">
              Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
