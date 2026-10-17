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
  const withPath = f as File & { path?: string };
  return { path: withPath.path || null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
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

/** Saves over the original file. In the browser this downloads the file instead. */
export async function saveInPlace(path: string | null, name: string, bytes: Uint8Array): Promise<string | null> {
  if (desktop && path) {
    await desktop.saveFile(path, bytes);
    return path;
  }
  if (desktop) return saveAs(name, bytes);
  download(bytes, name, "application/pdf");
  return null;
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
