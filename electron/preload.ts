import { contextBridge, ipcRenderer } from "electron";

interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

contextBridge.exposeInMainWorld("drawsetHost", {
  openDialog: (): Promise<OpenedFile[]> => ipcRenderer.invoke("open-dialog"),
  readFile: (p: string): Promise<OpenedFile> => ipcRenderer.invoke("read-file", p),
  saveFile: (p: string, bytes: Uint8Array): Promise<boolean> => ipcRenderer.invoke("save-file", p, bytes),
  saveDialog: (suggested: string): Promise<string | null> => ipcRenderer.invoke("save-dialog", suggested),
  saveFileAs: (suggested: string, bytes: Uint8Array, filterName: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke("save-file-as", suggested, bytes, filterName, ext),
  recentList: (): Promise<string[]> => ipcRenderer.invoke("recent-list"),
  recentClear: (): Promise<void> => ipcRenderer.invoke("recent-clear"),
  pendingPaths: (): Promise<string[]> => ipcRenderer.invoke("pending-paths"),
  setDirty: (dirty: boolean) => ipcRenderer.send("set-dirty", dirty),
  appVersion: (): Promise<string> => ipcRenderer.invoke("app-version"),
  journalWrite: (id: string, json: string): Promise<void> => ipcRenderer.invoke("journal-write", id, json),
  journalList: (): Promise<string[]> => ipcRenderer.invoke("journal-list"),
  journalRemove: (id: string): Promise<void> => ipcRenderer.invoke("journal-remove", id),
  onOpenPaths: (cb: (paths: string[]) => void) => {
    ipcRenderer.on("open-paths", (_e, paths: string[]) => cb(paths));
  },
});
