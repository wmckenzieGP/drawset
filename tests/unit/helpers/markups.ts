import { DEFAULT_STYLE, newId, type Markup, type MarkupKind } from "../../../src/markup/model";
import type { SavePlan } from "../../../src/engine/types";
import type { DocInfo } from "../../../src/engine/types";

export function mk(kind: MarkupKind, over: Partial<Markup> = {}): Markup {
  const now = "2026-10-16T01:02:03.000Z";
  return {
    id: newId(),
    pageId: "p0",
    kind,
    subtype: "",
    rect: [100, 100, 200, 160],
    points: [],
    inks: [],
    quads: [],
    style: { ...DEFAULT_STYLE },
    contents: "",
    author: "Test Author",
    subject: kind,
    created: now,
    modified: now,
    status: "None",
    locked: false,
    icon: "Comment",
    replies: [],
    ...over,
  };
}

export function identityPages(info: DocInfo): SavePlan["pages"] {
  return info.pages.map((p) => ({ index: p.index, rotate: p.rotate }));
}

export function plan(info: DocInfo, upserts: Markup[], deletes: number[] = [], extra: Partial<SavePlan> = {}): SavePlan {
  return { pages: identityPages(info), upserts: upserts.map((m) => ({ markup: m, page: 0 })), deletes, defaultAuthor: "Test Author", ...extra };
}
