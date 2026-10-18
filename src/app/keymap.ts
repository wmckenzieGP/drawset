/**
 * Every command with a keyboard shortcut, in one place: the shortcut handler, the menus and the shortcut list
 * all read from here, so a key shown in a menu is always the key that works. The keys follow the layout most
 * drawing reviewers already know (single letters for tools, Shift+Alt for measurements, Ctrl+4 to Ctrl+7 for
 * page layouts, Alt+letter for panels).
 */
import { goBack, goForward } from "../features/links/navigate";
import { openPrintDialog } from "../features/print/PrintDialog";
import { goToHit } from "../features/search/SearchPanel";
import { openSecurity } from "../features/security/SecurityDialog";
import { openOcr } from "../features/ocr/OcrDialog";
import { openRedactDialog } from "../features/redact/RedactDialog";
import { deletePages, insertBlankPage, pagesFromSelection, rotatePages } from "../features/pages/pageOps";
import { openPageDialog } from "../features/pages/PageDialogs";
import { addBookmark } from "../features/viewer/BookmarksPanel";
import { openPreferences } from "./PreferencesDialog";
import { openShortcuts } from "./ShortcutsDialog";
import { activeTab, focusPane, setChrome, setSnap, togglePanel, toggleSplit, useApp, type PanelId, type ToolId } from "../state/store";
import { cmd, setTool } from "./commands";

export interface Command {
  id: string;
  label: string;
  /** Shortcut keys, the first shown in menus: "Ctrl+Shift+F7", "Shift+Alt+Plus", "V". */
  keys: string[];
  group: string;
  run: () => unknown;
  /** Needs an open document. */
  doc?: boolean;
}

const tab = () => activeTab();
const tool = (id: ToolId, label: string, keys: string[], group: string): Command => ({ id: `tool.${id}`, label, keys, group, run: () => setTool(id), doc: true });
const panel = (id: PanelId, label: string, key: string): Command => ({ id: `panel.${id}`, label, keys: [key], group: "Window", run: () => togglePanel(id) });
const toggleChrome = (k: "menuBar" | "navBar" | "statusBar") => () => setChrome({ [k]: !useApp.getState().chrome[k] });
const searchStep = (d: 1 | -1) => () => {
  const t = tab();
  if (!t || !t.search.hits.length) return;
  const n = t.search.hits.length;
  goToHit(t.key, (((t.search.current < 0 ? (d > 0 ? -1 : 0) : t.search.current) + d) % n + n) % n);
};

export const COMMANDS: Command[] = [
  // File
  { id: "file.open", label: "Open…", keys: ["Ctrl+O"], group: "File", run: () => cmd.open() },
  { id: "file.save", label: "Save", keys: ["Ctrl+S"], group: "File", run: () => cmd.save(), doc: true },
  { id: "file.saveCopy", label: "Save a copy…", keys: ["Ctrl+Shift+S"], group: "File", run: () => cmd.saveCopy(), doc: true },
  { id: "file.print", label: "Print…", keys: ["Ctrl+P"], group: "File", run: () => openPrintDialog(), doc: true },
  { id: "file.close", label: "Close", keys: ["Ctrl+F4", "Ctrl+W"], group: "File", run: () => cmd.close(), doc: true },
  { id: "file.closeAll", label: "Close all", keys: ["Ctrl+Shift+W"], group: "File", run: () => cmd.closeAll(), doc: true },
  { id: "file.preferences", label: "Preferences…", keys: ["Ctrl+K"], group: "File", run: () => openPreferences() },

  // Edit
  { id: "edit.undo", label: "Undo", keys: ["Ctrl+Z"], group: "Edit", run: () => cmd.undo(), doc: true },
  { id: "edit.redo", label: "Redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"], group: "Edit", run: () => cmd.redo(), doc: true },
  { id: "edit.cut", label: "Cut", keys: ["Ctrl+X"], group: "Edit", run: () => cmd.cut(), doc: true },
  { id: "edit.copy", label: "Copy", keys: ["Ctrl+C"], group: "Edit", run: () => cmd.copy(), doc: true },
  { id: "edit.paste", label: "Paste", keys: ["Ctrl+V"], group: "Edit", run: () => cmd.paste(), doc: true },
  { id: "edit.pasteInPlace", label: "Paste in place", keys: ["Ctrl+Shift+V"], group: "Edit", run: () => cmd.pasteInPlace(), doc: true },
  { id: "edit.duplicate", label: "Duplicate", keys: ["Ctrl+D"], group: "Edit", run: () => cmd.duplicate(), doc: true },
  { id: "edit.delete", label: "Delete", keys: ["Delete", "Backspace"], group: "Edit", run: () => cmd.deleteSelection(), doc: true },
  { id: "edit.selectAll", label: "Select all markups on the page", keys: ["Ctrl+A"], group: "Edit", run: () => cmd.selectAllOnPage(), doc: true },
  { id: "edit.lock", label: "Lock or unlock", keys: ["Ctrl+Shift+L"], group: "Edit", run: () => cmd.toggleLocked(), doc: true },
  { id: "edit.autosize", label: "Autosize text box", keys: ["Alt+Z"], group: "Edit", run: () => cmd.autosize(), doc: true },
  { id: "edit.bringForward", label: "Bring forward", keys: ["Ctrl+J"], group: "Edit", run: () => cmd.arrange("forward"), doc: true },
  { id: "edit.bringToFront", label: "Bring to front", keys: ["Ctrl+Shift+J"], group: "Edit", run: () => cmd.arrange("front"), doc: true },
  { id: "edit.sendBackward", label: "Send backward", keys: ["Ctrl+["], group: "Edit", run: () => cmd.arrange("backward"), doc: true },
  { id: "edit.sendToBack", label: "Send to back", keys: ["Ctrl+Shift+["], group: "Edit", run: () => cmd.arrange("back"), doc: true },

  // View
  { id: "view.single", label: "Single page", keys: ["Ctrl+4"], group: "View", run: () => cmd.setMode("single"), doc: true },
  { id: "view.continuous", label: "Continuous", keys: ["Ctrl+5"], group: "View", run: () => cmd.setMode("continuous"), doc: true },
  { id: "view.sideBySide", label: "Side by side", keys: ["Ctrl+6"], group: "View", run: () => cmd.setMode("sideBySide"), doc: true },
  { id: "view.continuousSideBySide", label: "Continuous side by side", keys: ["Ctrl+7"], group: "View", run: () => cmd.setMode("continuousSideBySide"), doc: true },
  { id: "view.zoomIn", label: "Zoom in", keys: ["Plus", "Ctrl+Plus"], group: "View", run: () => cmd.zoomIn(), doc: true },
  { id: "view.zoomOut", label: "Zoom out", keys: ["Minus", "Ctrl+Minus"], group: "View", run: () => cmd.zoomOut(), doc: true },
  { id: "view.actualSize", label: "Actual size", keys: ["Ctrl+8"], group: "View", run: () => cmd.actualSize(), doc: true },
  { id: "view.fitPage", label: "Fit page", keys: ["Ctrl+9"], group: "View", run: () => cmd.fitPage(), doc: true },
  { id: "view.fitWidth", label: "Fit width", keys: ["Ctrl+0"], group: "View", run: () => cmd.fitWidth(), doc: true },
  { id: "view.firstPage", label: "First page", keys: ["Home"], group: "View", run: () => cmd.firstPage(), doc: true },
  { id: "view.prevPage", label: "Previous page", keys: ["Ctrl+Left", "PageUp"], group: "View", run: () => cmd.pageBy(-1), doc: true },
  { id: "view.nextPage", label: "Next page", keys: ["Ctrl+Right", "PageDown"], group: "View", run: () => cmd.pageBy(1), doc: true },
  { id: "view.lastPage", label: "Last page", keys: ["End"], group: "View", run: () => cmd.lastPage(), doc: true },
  { id: "view.prevView", label: "Previous view", keys: ["Alt+Left"], group: "View", run: () => goBack(), doc: true },
  { id: "view.nextView", label: "Next view", keys: ["Alt+Right"], group: "View", run: () => goForward(), doc: true },
  { id: "view.rotateCw", label: "Rotate view clockwise", keys: ["Ctrl+Shift+Plus"], group: "View", run: () => cmd.rotateView(90), doc: true },
  { id: "view.rotateCcw", label: "Rotate view anticlockwise", keys: ["Ctrl+Shift+Minus"], group: "View", run: () => cmd.rotateView(-90), doc: true },
  { id: "view.split", label: "Split view", keys: ["Ctrl+2", "Ctrl+H"], group: "View", run: () => !useApp.getState().split && toggleSplit(), doc: true },
  { id: "view.unsplit", label: "Close split view", keys: ["Ctrl+Shift+2"], group: "View", run: () => useApp.getState().split && toggleSplit(), doc: true },
  { id: "view.toggleSplit", label: "Split or unsplit", keys: ["Ctrl+I"], group: "View", run: () => toggleSplit(), doc: true },
  { id: "view.switchPane", label: "Switch split pane", keys: ["Ctrl+1"], group: "View", run: () => { const sp = useApp.getState().split; if (sp) focusPane(sp.focus === "left" ? "right" : "left"); }, doc: true },
  { id: "view.showGrid", label: "Show grid", keys: ["Shift+F9"], group: "View", run: () => setSnap({ showGrid: !useApp.getState().snap.showGrid }) },
  { id: "view.snapGrid", label: "Snap to grid", keys: ["Ctrl+Shift+F9"], group: "View", run: () => setSnap({ grid: !useApp.getState().snap.grid }) },
  { id: "view.snapContent", label: "Snap to content", keys: ["Ctrl+Shift+F8"], group: "View", run: () => setSnap({ content: !useApp.getState().snap.content }) },
  { id: "view.snapMarkup", label: "Snap to markup", keys: ["Ctrl+Shift+F7"], group: "View", run: () => setSnap({ markups: !useApp.getState().snap.markups }) },
  { id: "view.search", label: "Search", keys: ["Ctrl+F"], group: "View", run: () => cmd.openSearch(), doc: true },
  { id: "view.nextResult", label: "Next search result", keys: ["F3"], group: "View", run: searchStep(1), doc: true },
  { id: "view.prevResult", label: "Previous search result", keys: ["Shift+F3"], group: "View", run: searchStep(-1), doc: true },

  // Tools: selection
  tool("select", "Select", ["V"], "Select"),
  tool("pan", "Pan", ["Shift+V"], "Select"),
  tool("zoom", "Zoom", ["Z"], "Select"),
  tool("text", "Select text", ["Shift+T"], "Select"),
  // markup
  tool("textbox", "Text box", ["T"], "Markup"),
  tool("callout", "Callout", ["Q"], "Markup"),
  tool("note", "Note", ["N"], "Markup"),
  tool("pen", "Pen", ["P"], "Markup"),
  tool("highlighter", "Highlighter (freehand)", [], "Markup"),
  tool("highlight", "Highlight text", ["H"], "Markup"),
  tool("underline", "Underline", ["U"], "Markup"),
  tool("strikeout", "Strikethrough", ["D"], "Markup"),
  tool("line", "Line", ["L"], "Markup"),
  tool("arrow", "Arrow", ["A"], "Markup"),
  tool("polyline", "Polyline", ["Shift+N"], "Markup"),
  tool("rectangle", "Rectangle", ["R"], "Markup"),
  tool("ellipse", "Ellipse", ["E"], "Markup"),
  tool("polygon", "Polygon", ["Shift+P"], "Markup"),
  tool("cloud", "Cloud", ["C"], "Markup"),
  tool("stamp", "Stamp", ["S"], "Markup"),
  { id: "tool.image", label: "Image", keys: ["I"], group: "Markup", run: () => cmd.chooseImage(), doc: true },
  tool("link", "Hyperlink", ["Shift+H"], "Markup"),
  // measure
  tool("calibrate", "Calibrate", [], "Measure"),
  tool("length", "Length", ["Shift+Alt+L"], "Measure"),
  tool("polylength", "Polylength", ["Shift+Alt+Q"], "Measure"),
  tool("area", "Area", ["Shift+Alt+A"], "Measure"),
  tool("cutout", "Area cutout", [], "Measure"),
  tool("perimeter", "Perimeter", ["Shift+Alt+P"], "Measure"),
  tool("count", "Count", ["Shift+Alt+C"], "Measure"),
  tool("angle", "Angle", ["Shift+Alt+G"], "Measure"),
  // redaction
  tool("redact", "Mark area for redaction", ["Shift+R"], "Redact"),
  tool("erase", "Erase content", [], "Redact"),
  { id: "doc.applyRedactions", label: "Review and apply redactions…", keys: ["Shift+A"], group: "Redact", run: () => openRedactDialog(), doc: true },

  // Document
  { id: "doc.rotateCw", label: "Rotate pages clockwise", keys: ["Shift+Alt+Plus", "Ctrl+Shift+R"], group: "Document", run: () => { const t = tab(); if (t) rotatePages(t.key, pagesFromSelection(t), 90); }, doc: true },
  { id: "doc.rotateCcw", label: "Rotate pages anticlockwise", keys: ["Shift+Alt+Minus"], group: "Document", run: () => { const t = tab(); if (t) rotatePages(t.key, pagesFromSelection(t), 270); }, doc: true },
  { id: "doc.deletePages", label: "Delete pages", keys: ["Ctrl+Shift+D"], group: "Document", run: () => { const t = tab(); if (t) deletePages(t.key, pagesFromSelection(t)); }, doc: true },
  { id: "doc.insertBlank", label: "Insert blank page", keys: ["Ctrl+Shift+N"], group: "Document", run: () => { const t = tab(); if (t) void insertBlankPage(t.key); }, doc: true },
  { id: "doc.insertPages", label: "Insert pages from file…", keys: ["Ctrl+Shift+I"], group: "Document", run: () => openPageDialog("insert"), doc: true },
  { id: "doc.extract", label: "Extract pages…", keys: ["Ctrl+Shift+X"], group: "Document", run: () => openPageDialog("extract"), doc: true },
  { id: "doc.flatten", label: "Flatten markups…", keys: ["Ctrl+Shift+M"], group: "Document", run: () => cmd.flatten(), doc: true },
  { id: "doc.ocr", label: "Recognise text (OCR)…", keys: ["Ctrl+Shift+O"], group: "Document", run: () => void openOcr(), doc: true },
  { id: "doc.addBookmark", label: "Add bookmark", keys: ["Ctrl+B"], group: "Document", run: () => addBookmark(), doc: true },
  { id: "doc.security", label: "Security…", keys: ["Ctrl+L"], group: "Document", run: () => openSecurity(), doc: true },

  // Window
  panel("thumbnails", "Thumbnails", "Alt+T"),
  panel("bookmarks", "Bookmarks", "Alt+B"),
  panel("search", "Search", "Alt+1"),
  panel("toolchest", "Tool Chest", "Alt+X"),
  panel("properties", "Properties", "Alt+P"),
  panel("measurements", "Measurements", "Alt+U"),
  panel("forms", "Form fields", "Alt+Q"),
  { id: "panel.markups", label: "Markups List", keys: ["Alt+L"], group: "Window", run: () => useApp.setState((s) => ({ bottomPanel: !s.bottomPanel })) },
  { id: "window.hidePanels", label: "Hide or show side panels", keys: ["Shift+F4"], group: "Window", run: () => cmd.toggleSidePanels() },
  { id: "window.menuBar", label: "Menu bar", keys: ["F9"], group: "Window", run: toggleChrome("menuBar") },
  { id: "window.navBar", label: "Navigation bar", keys: ["F4"], group: "Window", run: toggleChrome("navBar") },
  { id: "window.statusBar", label: "Status bar", keys: ["F8"], group: "Window", run: toggleChrome("statusBar") },
  { id: "window.fullScreen", label: "Full screen", keys: ["F11"], group: "Window", run: () => cmd.fullScreen() },
  { id: "window.nextDoc", label: "Next document", keys: ["Ctrl+Tab"], group: "Window", run: () => cmd.cycleTab(1), doc: true },
  { id: "window.prevDoc", label: "Previous document", keys: ["Ctrl+Shift+Tab"], group: "Window", run: () => cmd.cycleTab(-1), doc: true },

  // Help
  { id: "help.shortcuts", label: "Keyboard shortcuts", keys: ["F1"], group: "Help", run: () => openShortcuts() },
];

export const commandById = new Map(COMMANDS.map((c) => [c.id, c]));
export const keysOf = (id: string) => commandById.get(id)?.keys[0];

// ---------- matching ----------

interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseKeys(s: string): Chord {
  const parts = s.split("+");
  // "Ctrl+Shift+Plus" splits cleanly; a trailing "+" is never used (Plus is spelled out)
  const key = parts.pop()!;
  return { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), key };
}

/** The key of an event in the names used above, independent of keyboard layout for letters and digits. */
function eventKey(e: KeyboardEvent): string {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (c === "NumpadAdd" || c === "Equal" || e.key === "+") return "Plus";
  if (c === "NumpadSubtract" || c === "Minus" || e.key === "-") return "Minus";
  if (c === "BracketLeft") return "[";
  if (c === "BracketRight") return "]";
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  const named: Record<string, string> = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Del: "Delete" };
  return named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
}

export function matches(e: KeyboardEvent, keys: string): boolean {
  const k = parseKeys(keys);
  return k.ctrl === (e.ctrlKey || e.metaKey) && k.shift === e.shiftKey && k.alt === e.altKey && k.key === eventKey(e);
}

export function commandFor(e: KeyboardEvent): Command | undefined {
  return COMMANDS.find((c) => c.keys.some((k) => matches(e, k)));
}
