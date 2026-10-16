import { MeasurePanel } from "../features/measure/MeasurePanel";
import { RedactDialog, openRedactDialog } from "../features/redact/RedactDialog";
import { ToolChestPanel, addSelectionToChest } from "../features/toolchest/ToolChestPanel";
import { LabelRegionDialog, startLabelRegion } from "../features/pages/LabelRegionDialog";
import { bookmarksFromLabels } from "../features/pages/labelRegion";
import { OverlayDialog, openOverlayDialog } from "../features/overlay/OverlayDialog";
import { CalibrateDialog, openCalibrateDialog } from "../features/measure/CalibrateDialog";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { activeTab, commit, isDirty, toggleSplit, useApp, type SplitState, type ToolId } from "../state/store";
import { closeTab, openFiles, openPath } from "../state/documents";
import { clearRecent, desktop, fileToOpened, isDesktop, recentFiles } from "../platform/host";
import { Viewer } from "../features/viewer/Viewer";
import { ThumbnailsPanel } from "../features/pages/ThumbnailsPanel";
import { BookmarksPanel } from "../features/viewer/BookmarksPanel";
import { SearchPanel } from "../features/search/SearchPanel";
import { PropertiesPanel } from "../features/properties/PropertiesPanel";
import { MarkupsList } from "../features/markupsList/MarkupsList";
import { PageDialogs, openPageDialog } from "../features/pages/PageDialogs";
import { PrintDialog, openPrintDialog } from "../features/print/PrintDialog";
import { PreferencesDialog, openPreferences } from "./PreferencesDialog";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { cmd, setTool } from "./commands";
import { Icon } from "./icons";
import { useShortcuts } from "./shortcuts";
import { pagesFromSelection, rotatePages, deletePages, insertBlankPage } from "../features/pages/pageOps";

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

const TOOL_MENU: { group: string; tools: [ToolId, string, string?][] }[] = [
  { group: "Navigate", tools: [["select", "Select", "V"], ["pan", "Pan", "H"], ["zoom", "Marquee zoom", "Z"], ["text", "Select text", "T"]] },
  { group: "Shapes", tools: [["rectangle", "Rectangle", "R"], ["ellipse", "Ellipse", "E"], ["line", "Line", "L"], ["arrow", "Arrow", "A"], ["polyline", "Polyline", "N"], ["polygon", "Polygon", "P"], ["cloud", "Cloud", "C"]] },
  { group: "Freehand", tools: [["pen", "Pen", "F"], ["highlighter", "Highlighter", "G"]] },
  { group: "Text", tools: [["textbox", "Text box", "X"], ["callout", "Callout", "Q"], ["note", "Note", "O"], ["highlight", "Text highlight", "I"], ["underline", "Underline", "U"], ["strikeout", "Strikethrough", "K"]] },
  { group: "Stamps", tools: [["stamp", "Stamp", "S"], ["image", "Image"]] },
  {
    group: "Measure",
    tools: [["calibrate", "Calibrate", "Shift+K"], ["length", "Length", "Shift+L"], ["polylength", "Polylength", "Shift+N"], ["area", "Area", "Shift+A"], ["cutout", "Area cutout"], ["perimeter", "Perimeter", "Shift+P"], ["count", "Count", "Shift+C"], ["angle", "Angle", "Shift+G"]],
  },
  { group: "Redact", tools: [["erase", "Erase area"], ["redact", "Redact area"]] },
];

function MenuBar() {
  const tab = useApp(activeTab);
  const has = !!tab;
  const sel = tab ? tab.selection.length : 0;
  const split = useApp((s) => s.split);
  return (
    <div className="menubar" role="menubar">
      <div className="brand">
        <img src="./icon.png" alt="" width={18} height={18} />
        Drawset
      </div>
      <TopMenu label="File">
        <Item label="Open…" shortcut="Ctrl+O" onSelect={cmd.open} />
        <RecentMenu />
        <Sep />
        <Item label="Save" shortcut="Ctrl+S" onSelect={cmd.save} disabled={!has} />
        <Item label="Save a copy…" shortcut="Ctrl+Shift+S" onSelect={cmd.saveCopy} disabled={!has} />
        <Sep />
        <Item label="Print…" shortcut="Ctrl+P" onSelect={openPrintDialog} disabled={!has} />
        <Item label="Flatten markups…" onSelect={cmd.flatten} disabled={!has} />
        <Sep />
        <Item label="Preferences…" onSelect={openPreferences} />
        <Item label="Close" shortcut="Ctrl+W" onSelect={cmd.close} disabled={!has} />
      </TopMenu>
      <TopMenu label="Edit">
        <Item label="Undo" shortcut="Ctrl+Z" onSelect={cmd.undo} disabled={!tab?.undo.length} />
        <Item label="Redo" shortcut="Ctrl+Y" onSelect={cmd.redo} disabled={!tab?.redo.length} />
        <Sep />
        <Item label="Copy" shortcut="Ctrl+C" onSelect={cmd.copy} disabled={!has} />
        <Item label="Paste" shortcut="Ctrl+V" onSelect={cmd.paste} disabled={!has} />
        <Item label="Duplicate" shortcut="Ctrl+D" onSelect={cmd.duplicate} disabled={!sel} />
        <Item label="Delete" shortcut="Del" onSelect={cmd.deleteSelection} disabled={!sel} />
        <Item label="Select all on page" shortcut="Ctrl+A" onSelect={cmd.selectAllOnPage} disabled={!has} />
        <Sep />
        <Item label="Lock" shortcut="Ctrl+L" onSelect={() => cmd.setLocked(true)} disabled={!sel} />
        <Item label="Unlock" shortcut="Ctrl+Shift+L" onSelect={() => cmd.setLocked(false)} disabled={!sel} />
        <Sep />
        <Item label="Add to Tool Chest" onSelect={() => tab && addSelectionToChest(tab)} disabled={!sel} />
      </TopMenu>
      <TopMenu label="View">
        <Item label="Zoom in" shortcut="Ctrl++" onSelect={cmd.zoomIn} disabled={!has} />
        <Item label="Zoom out" shortcut="Ctrl+-" onSelect={cmd.zoomOut} disabled={!has} />
        <Item label="Actual size" shortcut="Ctrl+1" onSelect={cmd.actualSize} disabled={!has} />
        <Item label="Fit page" shortcut="Ctrl+0" onSelect={cmd.fitPage} disabled={!has} />
        <Item label="Fit width" shortcut="Ctrl+2" onSelect={cmd.fitWidth} disabled={!has} />
        <Sep />
        <Item label="Rotate view clockwise" shortcut="Ctrl+Shift++" onSelect={() => cmd.rotateView(90)} disabled={!has} />
        <Item label="Rotate view anticlockwise" shortcut="Ctrl+Shift+-" onSelect={() => cmd.rotateView(-90)} disabled={!has} />
        <Sep />
        <Item label="Thumbnails" onSelect={() => useApp.setState((s) => ({ leftPanel: s.leftPanel === "thumbnails" ? null : "thumbnails" }))} />
        <Item label="Bookmarks" onSelect={() => useApp.setState((s) => ({ leftPanel: s.leftPanel === "bookmarks" ? null : "bookmarks" }))} />
        <Item label="Search" shortcut="Ctrl+F" onSelect={() => useApp.setState({ leftPanel: "search" })} />
        <Item label="Tool Chest" onSelect={() => useApp.setState((s) => ({ leftPanel: s.leftPanel === "toolchest" ? null : "toolchest" }))} />
        <Item label={split ? "Close split view" : "Split view"} onSelect={toggleSplit} disabled={!has} />
        <Item label={split?.sync === false ? "Sync split panes" : "Stop syncing split panes"} onSelect={() => split && useApp.setState({ split: { ...split, sync: !split.sync } })} disabled={!split} />
        <Sep />
        <Item label="Properties" onSelect={() => useApp.setState((s) => ({ rightPanel: !s.rightPanel }))} />
        <Item label="Markups List" shortcut="Alt+L" onSelect={() => useApp.setState((s) => ({ bottomPanel: !s.bottomPanel }))} />
      </TopMenu>
      <TopMenu label="Tools">
        {TOOL_MENU.map((g, i) => (
          <div key={g.group}>
            {i > 0 && <Sep />}
            <div className="menu-label">{g.group}</div>
            {g.tools.map(([id, label, key]) => (
              <Item key={id} label={label} shortcut={key} onSelect={() => setTool(id)} disabled={!has} />
            ))}
          </div>
        ))}
        <Item label="Review and apply redactions…" onSelect={openRedactDialog} disabled={!has} />
        <Sep />
        <Item label="Overlay pages…" onSelect={openOverlayDialog} disabled={!has} />
        <Item label="Compare documents…" onSelect={openOverlayDialog} disabled={!has} />
        <Sep />
        <Item label={useApp.getState().tools.reuse ? "Turn reuse mode off" : "Turn reuse mode on"} shortcut="Ctrl+R" onSelect={() => useApp.setState((s) => ({ tools: { ...s.tools, reuse: !s.tools.reuse } }))} />
      </TopMenu>
      <TopMenu label="Page">
        <Item label="Rotate pages clockwise" onSelect={() => tab && rotatePages(tab.key, pagesFromSelection(tab), 90)} disabled={!has} />
        <Item label="Rotate pages anticlockwise" onSelect={() => tab && rotatePages(tab.key, pagesFromSelection(tab), 270)} disabled={!has} />
        <Item label="Delete pages" onSelect={() => tab && deletePages(tab.key, pagesFromSelection(tab))} disabled={!has} />
        <Sep />
        <Item label="Insert blank page" onSelect={() => tab && insertBlankPage(tab.key)} disabled={!has} />
        <Item label="Insert pages from file…" onSelect={() => openPageDialog("insert")} disabled={!has} />
        <Item label="Combine files…" onSelect={() => openPageDialog("combine")} disabled={!has} />
        <Sep />
        <Item label="Extract pages…" onSelect={() => openPageDialog("extract")} disabled={!has} />
        <Item label="Split document…" onSelect={() => openPageDialog("split")} disabled={!has} />
        <Sep />
        <Item label="Set page scale…" onSelect={openCalibrateDialog} disabled={!has} />
        <Sep />
        <Item label="Label pages from title block…" onSelect={startLabelRegion} disabled={!has} />
        <Item label="Make bookmarks from page labels" onSelect={() => tab && commit(tab.key, "Make bookmarks", (s) => ({ ...s, outline: bookmarksFromLabels(s) }))} disabled={!has} />
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
  const leftPanel = useApp((s) => s.leftPanel);
  const rightPanel = useApp((s) => s.rightPanel);
  const bottomPanel = useApp((s) => s.bottomPanel);
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
      <MenuBar />
      <Toolbar />
      <Tabs />
      <div className="main">
        {tab && leftPanel && (
          <aside className="panel left" aria-label="Side panel">
            <div className="panel-tabs">
              {(["thumbnails", "bookmarks", "search", "toolchest"] as const).map((p) => (
                <button key={p} className={leftPanel === p ? "active" : ""} onClick={() => useApp.setState({ leftPanel: p })} title={p === "toolchest" ? "Tool Chest" : p[0].toUpperCase() + p.slice(1)} data-testid={`panel-${p}`}>
                  <Icon name={p === "thumbnails" ? "pages" : p === "bookmarks" ? "bookmark" : p === "toolchest" ? "chest" : "search"} size={16} />
                </button>
              ))}
            </div>
            {leftPanel === "thumbnails" && <ThumbnailsPanel tab={tab} />}
            {leftPanel === "bookmarks" && <BookmarksPanel tab={tab} />}
            {leftPanel === "search" && <SearchPanel tab={tab} />}
            {leftPanel === "toolchest" && <ToolChestPanel tab={tab} />}
          </aside>
        )}
        <section className="center">
          {tab && split ? <SplitPanes split={split} /> : tab ? <Viewer key={tab.key} tab={tab} /> : <Welcome />}
          {tab && bottomPanel && <MarkupsList tab={tab} />}
        </section>
        {tab && rightPanel && (
          <aside className="panel right" aria-label="Properties">
            <MeasurePanel tab={tab} />
            <PropertiesPanel tab={tab} />
          </aside>
        )}
      </div>
      <StatusBar />
      <Toast />
      <PageDialogs />
      <PrintDialog />
      <CalibrateDialog />
      <RedactDialog />
      <OverlayDialog />
      <LabelRegionDialog />
      <PreferencesDialog />
      {dragOver && <div className="drop-hint">Drop PDF files to open them</div>}
    </div>
  );
}

