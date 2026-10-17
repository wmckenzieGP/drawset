/**
 * Host services: the Electron shell when running as the desktop app, browser fallbacks otherwise
 * (the web build is used for development and tests).
 */
export interface OpenedFile {
  path: string | null;
  name: string;
  bytes: Uint8Array;
}

interface DesktopHost {
  openDialog(): Promise<{ path: string; name: string; bytes: Uint8Array }[]>;
  readFile(p: string): Promise<{ path: string; name: string; bytes: Uint8Array }>;
  saveFile(p: string, bytes: Uint8Array): Promise<boolean>;
  saveDialog(suggested: string): Promise<string | null>;
  saveFilesInFolder(suggestedDir: string | null, files: { name: string; bytes: Uint8Array }[]): Promise<string[] | null>;
  pathForFile(f: File): string;
  saveFileAs(suggested: string, bytes: Uint8Array, filterName: string, ext: string): Promise<string | null>;
  recentList(): Promise<string[]>;
  recentClear(): Promise<void>;
  pendingPaths(): Promise<string[]>;
  setDirty(dirty: boolean): void;
  appVersion(): Promise<string>;
  onOpenPaths(cb: (paths: string[]) => void): void;
  journalWrite(id: string, json: string): Promise<void>;
  journalList(): Promise<string[]>;
  journalRemove(id: string): Promise<void>;
}

declare global {
  interface Window {
    drawsetHost?: DesktopHost;
  }
}

export const desktop: DesktopHost | undefined = typeof window !== "undefined" ? window.drawsetHost : undefined;
export const isDesktop = !!desktop;

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files ? [...input.files] : []);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function fileToOpened(f: File): Promise<OpenedFile> {
  // a file dropped from Explorer has a path on the desktop: open it through the shell so it can be saved in place
  const p = desktop ? desktop.pathForFile(f) : "";
  if (desktop && p && /\.pdf$/i.test(p)) return desktop.readFile(p);
  return { path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export async function openPdfDialog(): Promise<OpenedFile[]> {
  if (desktop) return desktop.openDialog();
  const files = await pickFiles("application/pdf,.pdf", true);
  return Promise.all(files.map(fileToOpened));
}

/** Picks any local files (images for stamps, PDFs for inserting pages) without adding them to recent files. */
export async function pickLocalFiles(accept: string, multiple = false): Promise<OpenedFile[]> {
  const files = await pickFiles(accept, multiple);
  return Promise.all(files.map(fileToOpened));
}

export async function readPath(p: string): Promise<OpenedFile> {
  if (!desktop) throw new Error("Opening by path needs the desktop app.");
  return desktop.readFile(p);
}

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Where a save will go, asked before anything is written: the file's own path, or (on the desktop, for a file
 * without one) a path chosen in a dialog. Returns undefined when the user cancels; null in the browser, which
 * downloads instead.
 */
export async function savePathFor(path: string | null, name: string): Promise<string | null | undefined> {
  if (!desktop) return null;
  if (path) return path;
  return (await desktop.saveDialog(name)) ?? undefined;
}

/** Writes the bytes to a path from savePathFor (null downloads them in the browser). */
export async function writeSaved(path: string | null, name: string, bytes: Uint8Array): Promise<void> {
  if (desktop && path) await desktop.saveFile(path, bytes);
  else download(bytes, name, "application/pdf");
}

/**
 * Saves several new files. The desktop app asks for a folder once and never replaces a file already there;
 * the browser downloads each. Returns the number written, or null when cancelled.
 */
export async function saveMany(nearPath: string | null, files: { name: string; bytes: Uint8Array }[]): Promise<number | null> {
  if (desktop) {
    const dir = nearPath ? nearPath.replace(/[\\/][^\\/]*$/, "") : null;
    const written = await desktop.saveFilesInFolder(dir, files);
    return written ? written.length : null;
  }
  for (const f of files) download(f.bytes, f.name, "application/pdf");
  return files.length;
}

/** Asks where to save and writes there. Returns the chosen path (null in the browser or if cancelled). */
export async function saveAs(suggested: string, bytes: Uint8Array, filterName = "PDF documents", ext = "pdf", mime = "application/pdf"): Promise<string | null> {
  if (desktop) return desktop.saveFileAs(suggested, bytes, filterName, ext);
  download(bytes, suggested, mime);
  return null;
}

const RECENT_KEY = "drawset.recent";
export async function recentFiles(): Promise<string[]> {
  if (desktop) return desktop.recentList();
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function rememberRecentName(name: string) {
  if (desktop) return;
  try {
    const list = [name, ...JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").filter((n: string) => n !== name)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export async function clearRecent() {
  if (desktop) return desktop.recentClear();
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function setDirty(d: boolean) {
  desktop?.setDirty(d);
}
