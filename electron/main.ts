/**
 * Drawset desktop shell. Deliberately thin: windows, file dialogs, reading and writing files,
 * recent files, PDF file association and printing. All PDF work happens in the renderer's worker.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_SCHEME = "app";
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const distDir = path.join(__dirname, "..", "dist");
const recentFile = () => path.join(app.getPath("userData"), "recent.json");
const MAX_RECENT = 15;

let mainWindow: BrowserWindow | null = null;
let pendingPaths: string[] = [];
let dirty = false;

function pdfArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => a.toLowerCase().endsWith(".pdf") && existsSync(a));
}

function readRecent(): string[] {
  try {
    const list = JSON.parse(readFileSync(recentFile(), "utf8"));
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  mkdirSync(path.dirname(recentFile()), { recursive: true });
  writeFileSync(recentFile(), JSON.stringify(list.slice(0, MAX_RECENT)));
}

function addRecent(p: string) {
  const list = [p, ...readRecent().filter((x) => x.toLowerCase() !== p.toLowerCase())];
  writeRecent(list);
  app.addRecentDocument(p);
}

async function readPdf(p: string) {
  const buf = await fs.readFile(p);
  addRecent(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

/** Writes via a temporary file then renames, so a failed save never corrupts the original. */
async function writeAtomic(p: string, bytes: Uint8Array) {
  const tmp = `${p}.drawset-tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, p);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#11161c",
    title: "Drawset",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.loadURL(`${APP_SCHEME}://drawset/index.html`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") mainWindow?.webContents.toggleDevTools();
  });
  mainWindow.on("close", (e) => {
    if (!dirty || !mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Close without saving", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "Some documents have unsaved changes. Close Drawset anyway?",
    });
    if (choice !== 0) e.preventDefault();
  });
  mainWindow.on("closed", () => (mainWindow = null));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingPaths = pdfArgs(process.argv);
  app.on("second-instance", (_e, argv) => {
    const paths = pdfArgs(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (paths.length) mainWindow.webContents.send("open-paths", paths);
    }
  });
  app.on("open-file", (e, p) => {
    e.preventDefault();
    if (mainWindow) mainWindow.webContents.send("open-paths", [p]);
    else pendingPaths.push(p);
  });

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
      const full = path.normalize(path.join(distDir, rel));
      if (!full.startsWith(distDir)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(full).toString());
    });

    ipcMain.handle("open-dialog", async () => {
      if (!mainWindow) return [];
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Open PDF",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });
      if (res.canceled) return [];
      return Promise.all(res.filePaths.map(readPdf));
    });
    ipcMain.handle("read-file", (_e, p: string) => readPdf(p));
    ipcMain.handle("save-file", async (_e, p: string, bytes: Uint8Array) => {
      await writeAtomic(p, bytes);
      addRecent(p);
      return true;
    });
    ipcMain.handle("save-dialog", async (_e, suggested: string) => {
      if (!mainWindow) return null;
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Save a copy",
        defaultPath: suggested,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });
      return res.canceled || !res.filePath ? null : res.filePath;
    });
    ipcMain.handle("save-file-as", async (_e, suggested: string, bytes: Uint8Array, filterName: string, ext: string) => {
      if (!mainWindow) return null;
      const res = await dialog.showSaveDialog(mainWindow, { defaultPath: suggested, filters: [{ name: filterName, extensions: [ext] }] });
      if (res.canceled || !res.filePath) return null;
      await writeAtomic(res.filePath, bytes);
      return res.filePath;
    });
    ipcMain.handle("recent-list", () => readRecent().filter((p) => existsSync(p)));
    ipcMain.handle("recent-clear", () => writeRecent([]));
    ipcMain.handle("pending-paths", () => {
      const p = pendingPaths;
      pendingPaths = [];
      return p;
    });
    ipcMain.on("set-dirty", (_e, value: boolean) => {
      dirty = value;
    });
    ipcMain.handle("app-version", () => app.getVersion());

    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
