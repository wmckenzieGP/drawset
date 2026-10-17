import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mk } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

describe("crash recovery journal", () => {
  it("journals unsaved changes every minute, restores them onto a fresh copy of the file, and forgets them once saved", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, commit, setLoadedMarkups, updateTab, useApp, withMarkups, isDirty } = await import("../../src/state/store");
    const { buildPlan } = await import("../../src/state/documents");
    const J = await import("../../src/features/recovery/journal");
    const store = J.memoryStore();
    J.setJournalStore(store);
    const core = useNodeEngine();
    const bytes = read("annotated.pdf");
    const sha = await J.sha256Hex(bytes);

    const open = () => {
      const info = core.open(bytes, "annotated.pdf");
      const key = addTab(info, "annotated.pdf", "C:\\Jobs\\annotated.pdf");
      setLoadedMarkups(key, core.readMarkups(info.docId));
      updateTab(key, (t) => ({ ...t, fingerprint: sha }));
      return key;
    };
    const tab = (key: string) => useApp.getState().tabs.find((t) => t.key === key)!;

    const key = open();
    const existing = Object.values(tab(key).state.markups).find((m) => m.kind === "rectangle")!;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
    const p1 = tab(key).state.pages[1].id;
    commit(key, "edits", (s) =>
      withMarkups(s, [
        { ...existing, contents: "Changed after opening", style: { ...existing.style, width: 4 } },
        mk("cloud", { pageId: p1, points: [[10, 10], [80, 10], [80, 60]], contents: "New on page 2" }),
        mk("image", { pageId: s.pages[0].id, image: { data: png, mime: "image/png", width: 1, height: 1 } }),
        mk("length", { pageId: s.pages[0].id, points: [[0, 0], [100, 0]], replies: [{ id: "r1", author: "A", contents: "Check", created: "2026-10-16T00:00:00Z", modified: "2026-10-16T00:00:00Z" }] }),
      ]),
    );
    commit(key, "reorder and rotate", (s) => ({ ...s, pages: [{ ...s.pages[1], rotation: 90, label: "B-2" }, s.pages[0]], security: { userPassword: "secret", ownerPassword: "secret", permissions: { print: true, copy: true, edit: true, annotate: true, form: true, assemble: true } } }));
    expect(isDirty(tab(key))).toBe(true);

    await J.journalNow();
    const [json] = await store.list();
    expect(json).toBeTruthy();
    expect(json).not.toContain("secret");
    const j = JSON.parse(json) as import("../../src/features/recovery/journal").JournalEntry;
    expect(j).toMatchObject({ name: "annotated.pdf", path: "C:\\Jobs\\annotated.pdf", sha256: sha, securityDropped: true, skippedPages: 0 });
    // unchanged state is not rewritten
    await store.remove(j.id);
    await J.journalNow();
    expect(await store.list()).toHaveLength(0);

    // "after a crash": a fresh copy of the file gets the journal applied
    const key2 = open();
    const fresh = tab(key2);
    const restored = J.stateFromJournal(fresh, j);
    commit(key2, "Restore unsaved changes", () => restored);
    const a = tab(key);
    const b = tab(key2);
    expect(b.state.pages.map((p) => [p.src, p.rotation, p.label])).toEqual(a.state.pages.map((p) => [p.src, p.rotation, p.label]));
    const norm = (t: typeof a) =>
      Object.values(t.state.markups)
        .map((m) => ({ ...m, pageId: t.state.pages.find((p) => p.id === m.pageId)!.src }))
        .sort((x, y) => x.id.localeCompare(y.id));
    expect(norm(b)).toEqual(norm(a));
    // markups the user did not touch keep their identity, so the save writes only what changed
    const plan = buildPlan(b);
    expect(plan.upserts.map((u) => u.markup.kind).sort()).toEqual(["cloud", "image", "length", "rectangle"]);
    expect(plan.security).toBeUndefined();
    expect(b.state.markups[Object.values(b.state.markups).find((m) => m.kind === "image")!.id].image!.data).toEqual(png);

    // once saved (clean) the journal is removed
    await J.journalNow();
    expect((await store.list()).map((x) => JSON.parse(x).id)).toEqual([J.journalIdOf(tab(key2))]);
    updateTab(key2, (t) => ({ ...t, saved: t.state }));
    await J.journalNow();
    expect(await store.list()).toHaveLength(0);
  });
});
