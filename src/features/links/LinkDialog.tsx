import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import type { Rect } from "../../markup/geometry";
import { nowIso, type LinkTarget, type Markup } from "../../markup/model";
import { isDesktop, pickLocalFiles } from "../../platform/host";
import { activeTab, commit, flash, updateTab, useApp, withMarkups } from "../../state/store";
import { findPage } from "../../app/findPage";
import { baseMarkup } from "../viewer/create";
import { SAFE_URL } from "./navigate";

interface Pending {
  /** New link: where it goes on the page. */
  pageId?: string;
  rect?: Rect;
  /** Existing link being changed. */
  editId?: string;
}

export const useLinkDialog = create<{ pending: Pending | null }>(() => ({ pending: null }));

export const openLinkDialog = (p: Pending) => useLinkDialog.setState({ pending: p });

const BORDER: [number, number, number] = [0, 0.35, 0.9];

export function LinkDialog() {
  const pending = useLinkDialog((s) => s.pending);
  const tab = useApp(activeTab);
  const [type, setType] = useState<LinkTarget["type"]>("page");
  const [page, setPage] = useState("");
  const [url, setUrl] = useState("https://");
  const [file, setFile] = useState("");
  const [filePage, setFilePage] = useState("");
  const [note, setNote] = useState("");
  const [border, setBorder] = useState(false);

  useEffect(() => {
    if (!pending || !tab) return;
    const m = pending.editId ? tab.state.markups[pending.editId] : undefined;
    const t = m?.link;
    setType(t?.type ?? "page");
    const idx = t?.type === "page" ? tab.state.pages.findIndex((p) => p.src === t.page) : Math.min(tab.currentPage + 1, tab.state.pages.length - 1);
    setPage(idx >= 0 ? tab.state.pages[idx].label : "");
    setUrl(t?.type === "url" ? t.url : "https://");
    setFile(t?.type === "file" ? t.path : "");
    setFilePage(t?.type === "file" && t.page !== undefined ? String(t.page + 1) : "");
    setNote(m?.contents ?? "");
    setBorder(!!m?.style.color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending || !tab) return null;
  const close = () => useLinkDialog.setState({ pending: null });

  const target = (): LinkTarget | string => {
    if (type === "page") {
      const i = findPage(page, tab.state.pages.map((p) => p.label));
      return i < 0 ? `No page "${page}" in this document.` : { type: "page", page: tab.state.pages[i].src };
    }
    if (type === "url") {
      let u = url.trim();
      if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = (u.includes("@") && !u.includes("/") ? "mailto:" : "https://") + u;
      return SAFE_URL.test(u) && u.length > 8 ? { type: "url", url: u } : "Type a web address (https://…) or an email address.";
    }
    const f = file.trim();
    if (!f) return "Choose the file to link to.";
    const n = parseInt(filePage, 10);
    return n > 0 ? { type: "file", path: f, page: n - 1 } : { type: "file", path: f };
  };

  const ok = () => {
    const t = target();
    if (typeof t === "string") {
      flash(t, "error");
      return;
    }
    const style = (m: Markup) => ({ ...m.style, color: border ? (m.style.color ?? BORDER) : null, width: m.style.width > 0 ? m.style.width : 1 });
    if (pending.editId) {
      const m = tab.state.markups[pending.editId];
      if (m) commit(tab.key, "Change link", (s) => withMarkups(s, [{ ...m, link: t, contents: note, style: style(m), modified: nowIso() }]));
    } else if (pending.pageId && pending.rect) {
      const b = baseMarkup("link", pending.pageId);
      const m: Markup = { ...b, rect: pending.rect, link: t, contents: note, subject: "Hyperlink", style: style(b) };
      commit(tab.key, "Add link", (s) => withMarkups(s, [m]));
      updateTab(tab.key, (x) => ({ ...x, selection: [m.id] }));
      if (!useApp.getState().tools.reuse) useApp.setState((s) => ({ tools: { ...s.tools, tool: "select", chest: null } }));
    }
    close();
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined} data-testid="link-dialog">
          <Dialog.Title>{pending.editId ? "Change link" : "Add link"}</Dialog.Title>
          <div className="field link-kinds">
            <label className="check">
              <input type="radio" checked={type === "page"} onChange={() => setType("page")} data-testid="link-type-page" /> A page in this document
            </label>
            {type === "page" && <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="Page number or label, e.g. M-012" aria-label="Page" data-testid="link-page" autoFocus />}
            <label className="check">
              <input type="radio" checked={type === "url"} onChange={() => setType("url")} data-testid="link-type-url" /> A web or email address
            </label>
            {type === "url" && <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" data-testid="link-url" autoFocus />}
            <label className="check">
              <input type="radio" checked={type === "file"} onChange={() => setType("file")} data-testid="link-type-file" /> Another file
            </label>
            {type === "file" && (
              <div className="link-file">
                <input value={file} onChange={(e) => setFile(e.target.value)} placeholder="Path, e.g. ..\\Structural\\S-101.pdf" aria-label="File" data-testid="link-file" />
                <button
                  className="btn"
                  onClick={async () => {
                    const [f] = await pickLocalFiles("application/pdf,.pdf");
                    if (f) setFile(f.path ?? f.name);
                  }}
                >
                  Browse…
                </button>
                <label>
                  Page <input className="small" value={filePage} onChange={(e) => setFilePage(e.target.value)} placeholder="1" aria-label="Page in that file" />
                </label>
              </div>
            )}
            {type === "file" && !isDesktop && <span className="muted">Linked files open in the desktop app.</span>}
          </div>
          <label className="field">
            <span>Description (shown as a tooltip and in the Markups List)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="link-note" />
          </label>
          <label className="check">
            <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} data-testid="link-border" /> Show a border
          </label>
          <div className="dialog-buttons">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" onClick={ok} data-testid="link-ok">
              OK
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
