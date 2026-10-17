/**
 * Drawset desktop shell. Deliberately thin: windows, file dialogs, reading and writing files,
 * recent files, PDF file association and printing. All PDF work happens in the renderer's worker.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from "electron";
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
/** Crash-recovery journals: one JSON file per open document with unsaved changes. */
const recoveryDir = () => path.join(app.getPath("userData"), "recovery");
const journalPath = (id: string) => path.join(recoveryDir(), `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

const APP_ORIGIN = `${APP_SCHEME}://drawset/`;

let mainWindow: BrowserWindow | null = null;
/**
 * Files the renderer may write: ones it opened (dialog, recent list, file association, drag and drop) or that
 * the user chose in a save dialog. Anything else is refused, so a page can never write where it likes.
 */
const writable = new Set<string>();
const key = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");
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
  if (!isPdf(p)) throw new Error("Drawset only opens PDF files.");
  const buf = await fs.readFile(p);
  writable.add(key(p));
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
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // the window only ever shows Drawset itself: a dropped link or a stray navigation must not load another page
  // (which would then see the preload's file functions)
  const stay = (e: Electron.Event, url: string) => {
    if (!url.startsWith(APP_ORIGIN)) e.preventDefault();
  };
  mainWindow.webContents.on("will-navigate", stay);
  mainWindow.webContents.on("will-redirect", stay);
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
    // closing without saving on purpose: nothing to recover next time
    else fs.rm(recoveryDir(), { recursive: true, force: true }).catch(() => undefined);
  });
  mainWindow.on("closed", () => (mainWindow = null));
}

/** IPC handlers answer only Drawset's own page. */
function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame?.url.startsWith(APP_ORIGIN)) throw new Error("Not allowed.");
    return fn(e, ...args);
  });
}

/** `name` in `dir`, or "name (2).pdf" and so on when a file of that name is already there. */
function freeName(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
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

    handle("open-dialog", async () => {
      if (!mainWindow) return [];
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Open PDF",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });
      if (res.canceled) return [];
      return Promise.all(res.filePaths.map(readPdf));
    });
    handle("read-file", (_e, p: string) => readPdf(p));
    handle("save-file", async (_e, p: string, bytes: Uint8Array) => {
      if (!isPdf(p) || !writable.has(key(p))) throw new Error("Drawset can only save over a file it opened or one you chose.");
      await writeAtomic(p, bytes);
      addRecent(p);
      return true;
    });
    handle("save-dialog", async (_e, suggested: string) => {
      if (!mainWindow) return null;
      const res = await dialog.showSaveDialog(mainWindow, {
        title: "Save a copy",
        defaultPath: suggested,
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });
      if (res.canceled || !res.filePath) return null;
      writable.add(key(res.filePath));
      return res.filePath;
    });
    handle("save-files-in-folder", async (_e, suggestedDir: string | null, files: { name: string; bytes: Uint8Array }[]) => {
      if (!mainWindow) return null;
      const res = await dialog.showOpenDialog(mainWindow, {
        title: `Choose a folder for ${files.length} files`,
        defaultPath: suggestedDir ?? undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      const dir = res.filePaths[0];
      const written: string[] = [];
      // never replace a file that is already there
      for (const f of files) {
        const target = freeName(dir, path.basename(f.name));
        await writeAtomic(target, f.bytes);
        written.push(target);
      }
      return written;
    });
    handle("save-file-as", async (_e, suggested: string, bytes: Uint8Array, filterName: string, ext: string) => {
      if (!mainWindow) return null;
      const res = await dialog.showSaveDialog(mainWindow, { defaultPath: suggested, filters: [{ name: filterName, extensions: [ext] }] });
      if (res.canceled || !res.filePath) return null;
      await writeAtomic(res.filePath, bytes);
      writable.add(key(res.filePath));
      return res.filePath;
    });
    handle("recent-list", () => readRecent().filter((p) => existsSync(p)));
    handle("recent-clear", () => writeRecent([]));
    handle("pending-paths", () => {
      const p = pendingPaths;
      pendingPaths = [];
      return p;
    });
    ipcMain.on("set-dirty", (_e, value: boolean) => {
      dirty = value;
    });
    handle("app-version", () => app.getVersion());
    handle("journal-write", async (_e, id: string, json: string) => {
      await fs.mkdir(recoveryDir(), { recursive: true });
      await writeAtomic(journalPath(id), new TextEncoder().encode(json));
    });
    handle("journal-list", async () => {
      const names = await fs.readdir(recoveryDir()).catch(() => [] as string[]);
      const out: string[] = [];
      for (const n of names) if (n.endsWith(".json")) out.push(await fs.readFile(path.join(recoveryDir(), n), "utf8").catch(() => ""));
      return out.filter(Boolean);
    });
    handle("journal-remove", (_e, id: string) => fs.rm(journalPath(id), { force: true }));

    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
