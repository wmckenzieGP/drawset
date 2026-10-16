import { EngineCore } from "../../../src/engine/core/engineCore";
import type { PdfEngine } from "../../../src/engine/types";
import { setEngine } from "../../../src/engine/client";

/** The engine core run in-process, behind the same async interface the app uses. */
export function useNodeEngine(): EngineCore {
  const core = new EngineCore();
  const e: PdfEngine = {
    open: async (b, n) => core.open(b, n),
    close: async (id) => core.close(id),
    render: async (r) => {
      const raw = core.render(r);
      return { width: raw.width, height: raw.height, image: null } as never;
    },
    renderAnnotation: async (d, p, o, s) => {
      const raw = core.renderAnnotation(d, p, o, s);
      return { width: raw.width, height: raw.height, image: null, rect: raw.rect } as never;
    },
    readMarkups: async (d, p) => core.readMarkups(d, p),
    search: async (d, n, a, b) => core.search(d, n, a, b),
    selectText: async (d, p, a, b) => core.selectText(d, p, a, b),
    importPages: async (d, b, p) => core.importPages(d, b, p),
    addBlankPage: async (d, w, h) => core.addBlankPage(d, w, h),
    save: async (d, p, m) => core.save(d, p, m),
    saveCopy: async (d, p) => core.saveCopy(d, p),
  };
  setEngine(e);
  return core;
}
