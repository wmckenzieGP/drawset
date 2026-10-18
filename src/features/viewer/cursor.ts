import { create } from "zustand";
import type { Pt } from "../../markup/geometry";

/** Where the pointer is: the tab and page under it and the point on that page (page space), or nulls off the pages. */
export const useCursor = create<{ tabKey: string | null; pageId: string | null; pt: Pt | null }>(() => ({ tabKey: null, pageId: null, pt: null }));
