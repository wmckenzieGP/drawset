import { MeasurePanel } from "../features/measure/MeasurePanel";
import { RedactDialog } from "../features/redact/RedactDialog";
import { FormsPanel } from "../features/forms/FormsPanel";
import { flattenForms } from "../features/forms/forms";
import { ToolChestPanel, addSelectionToChest } from "../features/toolchest/ToolChestPanel";
import { AskDialog } from "./AskDialog";
import { RecoveryDialog } from "../features/recovery/RecoveryDialog";
import { SecurityDialog } from "../features/security/SecurityDialog";
import { LinkDialog } from "../features/links/LinkDialog";
import { HeaderFooterDialog, openHeaderFooter } from "../features/headerFooter/HeaderFooterDialog";
import { OcrDialog } from "../features/ocr/OcrDialog";
import { LabelRegionDialog, startLabelRegion } from "../features/pages/LabelRegionDialog";
import { bookmarksFromLabels } from "../features/pages/labelRegion";
import { OverlayDialog, openOverlayDialog } from "../features/overlay/OverlayDialog";
import { CalibrateDialog, openCalibrateDialog } from "../features/measure/CalibrateDialog";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { activeTab, commit, isDirty, movePanel, PANELS, togglePanel, useApp, type DocTab, type PanelId, type Side, type SplitState } from "../state/store";
import { COMMANDS, commandById, keysOf } from "./keymap";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { NavigationBar } from "./NavigationBar";
import { closeTab, openFiles, openPath } from "../state/documents";
import { clearRecent, desktop, fileToOpened, isDesktop, recentFiles } from "../platform/host";
import { Viewer } from "../features/viewer/Viewer";
import { ThumbnailsPanel } from "../features/pages/ThumbnailsPanel";
import { BookmarksPanel } from "../features/viewer/BookmarksPanel";
import { SearchPanel } from "../features/search/SearchPanel";
import { PropertiesPanel } from "../features/properties/PropertiesPanel";
import { MarkupsList } from "../features/markupsList/MarkupsList";
import { PageDialogs, openPageDialog } from "../features/pages/PageDialogs";
import { PrintDialog } from "../features/print/PrintDialog";
import { PreferencesDialog } from "./PreferencesDialog";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { cmd } from "./commands";
import { Icon } from "./icons";
import { useShortcuts } from "./shortcuts";

function Item({ label, shortcut, onSelect, disabled }: { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean }) {
  return (
    <Menu.Item className="menu-item" onSelect={onSelect} disabled={disabled}>
      <span>{label}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </Menu.Item>
  );
}

function TopMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="menubar-trigger" data-testid={`menu-${label.toLowerCase()}`}>
        {label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={2}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const Sep = () => <Menu.Separator className="menu-sep" />;

function RecentMenu() {
  const [items, setItems] = useState<string[]>([]);
  return (
    <Menu.Sub onOpenChange={(o) => o && recentFiles().then(setItems)}>
      <Menu.SubTrigger className="menu-item">
        <span>Open recent</span>
        <span className="menu-shortcut">▸</span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className="menu" sideOffset={4}>
          {!isDesktop && <div className="menu-note">Recent files are available in the desktop app.</div>}
          {isDesktop && items.length === 0 && <div className="menu-note">No recent files</div>}
          {isDesktop && items.map((p) => <Item key={p} label={p} onSelect={() => openPath(p)} />)}
          {isDesktop && items.length > 0 && (
            <>
              <Sep />
              <Item label="Clear recent files" onSelect={() => clearRecent().then(() => setItems([]))} />
            </>
          )}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

/** A menu item for a command in the key map: its label and shortcut come from there. */
function C({ id, label, disabled, checked }: { id: string; label?: string; disabled?: boolean; checked?: boolean }) {
  const c = commandById.get(id)!;
  const has = useApp((s) => s.tabs.length > 0);
  return <Item label={`${checked ? "✓ " : ""}${label ?? c.label}`} shortcut={c.keys[0]?.replace(/Plus$/, "+").replace(/Minus$/, "-")} onSelect={() => void c.run()} disabled={disabled || (c.doc && !has)} />;
}

const TOOL_GROUPS = ["Select", "Markup", "Measure", "Redact"];

function MenuBar() {
  const tab = useApp(activeTab);
  const has = !!tab;
  const sel = tab ? tab.selection.length : 0;
  const split = useApp((s) => s.split);
  const snap = useApp((s) => s.snap);
  const chrome = useApp((s) => s.chrome);
  const left = useApp((s) => s.leftPanel);
  const right = useApp((s) => s.rightPanel);
  const bottom = useApp((s) => s.bottomPanel);
  const reuse = useApp((s) => s.tools.reuse);
  const mode = tab?.view.mode;
  return (
    <div className="menubar" role="menubar">
      <div className="brand">
        <img src="./icon.png" alt="" width={18} height={18} />
        Drawset
      </div>
      <TopMenu label="File">
        <C id="file.open" />
        <RecentMenu />
        <Sep />
        <C id="file.save" />
        <C id="file.saveCopy" />
        <Sep />
        <C id="file.print" />
        <Sep />
        <C id="file.preferences" />
        <Sep />
        <C id="file.close" />
        <C id="file.closeAll" />
      </TopMenu>
      <TopMenu label="Edit">
        <C id="edit.undo" disabled={!tab?.undo.length} />
        <C id="edit.redo" disabled={!tab?.redo.length} />
        <Sep />
        <C id="edit.cut" disabled={!sel} />
        <C id="edit.copy" />
        <C id="edit.paste" />
        <C id="edit.pasteInPlace" />
        <C id="edit.duplicate" disabled={!sel} />
        <C id="edit.delete" disabled={!sel} />
        <C id="edit.selectAll" />
        <Sep />
        <C id="edit.lock" disabled={!sel} />
        <C id="edit.autosize" disabled={!sel} />
        <Menu.Sub>
          <Menu.SubTrigger className="menu-item" disabled={!sel}>
            <span>Arrange</span>
            <span className="menu-shortcut">▸</span>
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent className="menu" sideOffset={4}>
              <C id="edit.bringToFront" disabled={!sel} />
              <C id="edit.bringForward" disabled={!sel} />
              <C id="edit.sendBackward" disabled={!sel} />
              <C id="edit.sendToBack" disabled={!sel} />
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
        <Sep />
        <Item label="Add to Tool Chest" onSelect={() => tab && addSelectionToChest(tab)} disabled={!sel} />
      </TopMenu>
      <TopMenu label="View">
        <C id="view.single" checked={mode === "single"} />
        <C id="view.continuous" checked={mode === "continuous"} />
        <C id="view.sideBySide" checked={mode === "sideBySide"} />
        <C id="view.continuousSideBySide" checked={mode === "continuousSideBySide"} />
        <Sep />
        <C id="view.zoomIn" />
        <C id="view.zoomOut" />
        <C id="view.actualSize" />
        <C id="view.fitPage" />
        <C id="view.fitWidth" />
        <Sep />
        <C id="view.firstPage" />
        <C id="view.prevPage" />
        <C id="view.nextPage" />
        <C id="view.lastPage" />
        <C id="view.prevView" disabled={!tab?.nav.back.length} />
        <C id="view.nextView" disabled={!tab?.nav.fwd.length} />
        <Sep />
        <C id="view.rotateCw" />
        <C id="view.rotateCcw" />
        <Sep />
        <C id={split ? "view.unsplit" : "view.split"} />
        <C id="view.switchPane" disabled={!split} />
        <Item label={split?.sync === false ? "Sync split panes" : "Stop syncing split panes"} onSelect={() => split && useApp.setState({ split: { ...split, sync: !split.sync } })} disabled={!split} />
        <Sep />
        <C id="view.showGrid" checked={snap.showGrid} />
        <C id="view.snapGrid" checked={snap.grid} />
        <C id="view.snapContent" checked={snap.content} />
        <C id="view.snapMarkup" checked={snap.markups} />
        <Sep />
        <C id="view.search" />
        <C id="view.nextResult" />
        <C id="view.prevResult" />
      </TopMenu>
      <TopMenu label="Document">
        <C id="doc.rotateCw" />
        <C id="doc.rotateCcw" />
        <C id="doc.deletePages" />
        <Sep />
        <C id="doc.insertBlank" />
        <C id="doc.insertPages" />
        <Item label="Combine files…" onSelect={() => openPageDialog("combine")} disabled={!has} />
        <Sep />
        <C id="doc.extract" />
        <Item label="Split document…" onSelect={() => openPageDialog("split")} disabled={!has} />
        <Sep />
        <Item label="Set page scale…" onSelect={openCalibrateDialog} disabled={!has} />
        <Item label="Label pages from title block…" onSelect={startLabelRegion} disabled={!has} />
        <C id="doc.addBookmark" />
        <Item label="Make bookmarks from page labels" onSelect={() => tab && commit(tab.key, "Make bookmarks", (s) => ({ ...s, outline: bookmarksFromLabels(s) }))} disabled={!has} />
        <Item label="Headers, footers and watermark…" onSelect={openHeaderFooter} disabled={!has} />
        <Sep />
        <C id="doc.ocr" />
        <C id="doc.applyRedactions" />
        <Item label="Overlay pages…" onSelect={openOverlayDialog} disabled={!has} />
        <Item label="Compare documents…" onSelect={openOverlayDialog} disabled={!has} />
        <Sep />
        <C id="doc.flatten" />
        <Item label="Flatten form fields…" onSelect={() => tab && flattenForms(tab)} disabled={!tab?.fields?.length} />
        <C id="doc.security" />
      </TopMenu>
      <TopMenu label="Tools">
        {TOOL_GROUPS.map((g, i) => (
          <div key={g}>
            {i > 0 && <Sep />}
            <div className="menu-label">{g}</div>
            {COMMANDS.filter((c) => c.group === g).map((c) => (
              <C key={c.id} id={c.id} />
            ))}
          </div>
        ))}
        <Sep />
        <Item label={reuse ? "Turn reuse off" : "Turn reuse on"} onSelect={() => useApp.setState((s) => ({ tools: { ...s.tools, reuse: !s.tools.reuse } }))} />
      </TopMenu>
      <TopMenu label="Window">
        {PANELS.filter((p) => p !== "forms" || tab?.info.hasForm || tab?.fields?.length).map((p) => (
          <C key={p} id={`panel.${p}`} checked={left === p || right === p} />
        ))}
        <C id="panel.markups" checked={bottom} />
        <C id="window.hidePanels" />
        <Sep />
        <C id="window.menuBar" checked={chrome.menuBar} />
        <C id="window.navBar" checked={chrome.navBar} />
        <C id="window.statusBar" checked={chrome.statusBar} />
        <C id="window.fullScreen" />
        <Sep />
        <C id="window.nextDoc" />
        <C id="window.prevDoc" />
      </TopMenu>
      <TopMenu label="Help">
        <C id="help.shortcuts" />
      </TopMenu>
    </div>
  );
}

function Tabs() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  if (!tabs.length) return <div className="tabs empty" />;
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <div key={t.key} role="tab" aria-selected={t.key === active} className={`tab ${t.key === active ? "active" : ""}`} onClick={() => useApp.setState({ active: t.key })} title={t.path ?? t.name}>
          <span className="tab-name">
            {t.name}
            {isDirty(t) ? " •" : ""}
          </span>
          <button
            className="tab-close"
            aria-label={`Close ${t.name}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.key);
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Welcome() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (isDesktop) recentFiles().then(setRecent);
  }, []);
  return (
    <div className="welcome">
      <img src="./icon.png" alt="" width={72} height={72} />
      <h1>Drawset</h1>
      <p>Open a drawing set to start. You can also drop PDF files anywhere in this window.</p>
      <button className="primary" onClick={cmd.open} data-testid="welcome-open">
        Open PDF…
      </button>
      {recent.length > 0 && (
        <div className="welcome-recent">
          <h2>Recent files</h2>
          {recent.slice(0, 8).map((p) => (
            <button key={p} className="link" onClick={() => openPath(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toast() {
  const message = useApp((s) => s.message);
  const busy = useApp((s) => s.busy);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => useApp.setState({ message: null }), message.kind === "error" ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <>
      {busy && <div className="busy" role="status">{busy}</div>}
      {message && (
        <div className={`toast ${message.kind}`} role="status" data-testid="toast">
          {message.text}
        </div>
      )}
    </>
  );
}

const PANEL_INFO: Record<PanelId, { title: string; icon: string }> = {
  thumbnails: { title: "Thumbnails", icon: "pages" },
  bookmarks: { title: "Bookmarks", icon: "bookmark" },
  search: { title: "Search", icon: "search" },
  toolchest: { title: "Tool Chest", icon: "chest" },
  forms: { title: "Form fields", icon: "form" },
  properties: { title: "Properties", icon: "props" },
  measurements: { title: "Measurements", icon: "length" },
};

/**
 * One side of the window: a bar of panel buttons that is always there, and the open panel next to it.
 * Right-click a button to move that panel to the other side.
 */
function SidePanel({ tab, side }: { tab: DocTab; side: Side }) {
  const open = useApp((s) => (side === "left" ? s.leftPanel : s.rightPanel));
  const sides = useApp((s) => s.chrome.side);
  const [menu, setMenu] = useState<{ id: PanelId; x: number; y: number } | null>(null);
  // the form fields panel appears for files with a form (and stays while open, e.g. after flattening)
  const ids = PANELS.filter((p) => sides[p] === side && (p !== "forms" || tab.info.hasForm || !!tab.fields?.length || open === "forms"));
  if (!ids.length) return null;
  const shown = open && ids.includes(open) ? open : null;
  const bar = (
    <div className="panel-bar" role="tablist" aria-label={`${side === "left" ? "Left" : "Right"} panels`}>
      {ids.map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={shown === p}
          className={shown === p ? "active" : ""}
          onClick={() => togglePanel(p)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: p, x: e.clientX, y: e.clientY });
          }}
          title={`${PANEL_INFO[p].title} (${keysOf(`panel.${p}`)})`}
          data-testid={`panel-${p}`}
        >
          <Icon name={PANEL_INFO[p].icon} size={16} />
        </button>
      ))}
    </div>
  );
  return (
    <>
      {side === "left" && bar}
      {shown && (
        <aside className={`panel ${side}`} aria-label={PANEL_INFO[shown].title} data-testid={`side-${side}`}>
          {shown === "thumbnails" && <ThumbnailsPanel tab={tab} />}
          {shown === "bookmarks" && <BookmarksPanel tab={tab} />}
          {shown === "search" && <SearchPanel tab={tab} />}
          {shown === "toolchest" && <ToolChestPanel tab={tab} />}
          {shown === "forms" && <FormsPanel tab={tab} />}
          {shown === "properties" && <PropertiesPanel tab={tab} />}
          {shown === "measurements" && <MeasurePanel tab={tab} />}
        </aside>
      )}
      {side === "right" && bar}
      {menu && (
        <div className="context-backdrop" onPointerDown={() => setMenu(null)}>
          <div className="menu context" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="menu-item"
              onClick={() => {
                movePanel(menu.id, side === "left" ? "right" : "left");
                setMenu(null);
              }}
              data-testid="panel-move"
            >
              Move {PANEL_INFO[menu.id].title} to the {side === "left" ? "right" : "left"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SplitPanes({ split }: { split: SplitState }) {
  const tabs = useApp((s) => s.tabs);
  return (
    <div className="split" data-testid="split">
      {(["left", "right"] as const).map((pane) => {
        const t = tabs.find((x) => x.key === split[pane]);
        return (
          <div key={pane} className={`split-pane ${split.focus === pane ? "focused" : ""}`} data-testid={`split-${pane}`}>
            <div className="split-title">{t?.name}</div>
            {t && <Viewer key={`${pane}:${t.key}`} tab={t} pane={pane} />}
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const tab = useApp(activeTab);
  const bottomPanel = useApp((s) => s.bottomPanel);
  const chrome = useApp((s) => s.chrome);
  const split = useApp((s) => s.split);
  const [dragOver, setDragOver] = useState(false);
  useShortcuts();

  // files from the shell (double-clicked PDFs, second instance)
  useEffect(() => {
    if (!desktop) return;
    desktop.pendingPaths().then((paths) => paths.forEach(openPath));
    desktop.onOpenPaths((paths) => paths.forEach(openPath));
  }, []);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!isDesktop && useApp.getState().tabs.some(isDirty)) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        const pdfs = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
        await openFiles(await Promise.all(pdfs.map(fileToOpened)));
      }}
    >
      {chrome.menuBar && <MenuBar />}
      <Toolbar />
      <Tabs />
      <div className="main">
        {tab && <SidePanel tab={tab} side="left" />}
        <section className="center">
          {tab && split ? <SplitPanes split={split} /> : tab ? <Viewer key={tab.key} tab={tab} /> : <Welcome />}
          {tab && chrome.navBar && <NavigationBar tab={tab} />}
          {tab && bottomPanel && <MarkupsList tab={tab} />}
        </section>
        {tab && <SidePanel tab={tab} side="right" />}
      </div>
      {chrome.statusBar && <StatusBar />}
      <Toast />
      <PageDialogs />
      <PrintDialog />
      <CalibrateDialog />
      <RedactDialog />
      <OverlayDialog />
      <LabelRegionDialog />
      <HeaderFooterDialog />
      <OcrDialog />
      <LinkDialog />
      <AskDialog />
      <SecurityDialog />
      <RecoveryDialog />
      <PreferencesDialog />
      <ShortcutsDialog />
      {dragOver && <div className="drop-hint">Drop PDF files to open them</div>}
    </div>
  );
}

