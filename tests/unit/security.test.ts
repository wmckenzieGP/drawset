import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { EngineCore } from "../../src/engine/core/engineCore";
import { permissionBits, securityOptions } from "../../src/engine/core/security";
import type { Permissions } from "../../src/engine/types";
import { identityPages, mk } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const NONE: Permissions = { print: false, copy: false, edit: false, annotate: false, form: false, assemble: false };

async function pdfjsOpen(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

describe("passwords and permissions", () => {
  it("asks for the open password, refuses a wrong one, and reports the file's permissions", () => {
    const e = new EngineCore();
    expect(() => e.open(read("secured.pdf"), "s.pdf")).toThrow("NEEDS_PASSWORD");
    expect(() => e.open(read("secured.pdf"), "s.pdf", undefined, "nope")).toThrow("WRONG_PASSWORD");
    const user = e.open(read("secured.pdf"), "s.pdf", undefined, "drawset");
    expect(user.security).toMatchObject({ encrypted: true, openPassword: true, owner: false, permissions: { ...NONE, print: true } });
    expect(user.security.method).toMatch(/AES/);
    expect(() => e.unlock(user.docId, "drawset")).toThrow("WRONG_PASSWORD");
    expect(e.unlock(user.docId, "owner-pw").security.owner).toBe(true);
    // the permissions password also opens it, with full rights
    expect(e.open(read("secured.pdf"), "s.pdf", undefined, "owner-pw").security.owner).toBe(true);
    // no open password: opens directly, restricted
    const r = e.open(read("restricted.pdf"), "r.pdf");
    expect(r.security).toMatchObject({ encrypted: true, openPassword: false, owner: false, permissions: { ...NONE, print: true, form: true } });
  });

  it("each permission bit means the same to MuPDF", () => {
    const base = mupdf.Document.openDocument(read("form.pdf"), "application/pdf").asPDF()!;
    for (const k of Object.keys(NONE) as (keyof Permissions)[]) {
      const bytes = base.saveToBuffer(`encrypt=aes-256,owner-password=o,permissions=${permissionBits({ ...NONE, [k]: true })}`).asUint8Array().slice();
      const d = mupdf.Document.openDocument(bytes, "application/pdf");
      for (const j of Object.keys(NONE) as (keyof Permissions)[]) expect([k, j, d.hasPermission(j)]).toEqual([k, j, j === k]);
    }
    expect(() => securityOptions({ userPassword: "a,b", ownerPassword: "", permissions: NONE })).toThrow(/commas/);
  });

  it("sets an open password and restrictions with a full save that MuPDF and pdf.js honour, keeps them on later saves, and removes them", async () => {
    const e = new EngineCore();
    const src = read("form.pdf");
    const info = e.open(src, "form.pdf");
    const perms = { ...NONE, print: true, copy: true };
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [{ markup: mk("rectangle"), page: 0 }], deletes: [], defaultAuthor: "T", security: { userPassword: "open-me", ownerPassword: "boss", permissions: perms } }, "incremental");
    // a full rewrite, not an increment of the unencrypted file
    expect(Buffer.from(res.bytes.subarray(0, 200)).equals(Buffer.from(src.subarray(0, 200)))).toBe(false);
    expect(res.info.security).toMatchObject({ encrypted: true, openPassword: true, owner: true });
    const raw = new TextDecoder("latin1").decode(res.bytes);
    expect(raw).not.toContain("Hospital Stage 2");
    expect(mupdf.Document.openDocument(res.bytes, "application/pdf").needsPassword()).toBe(true);
    await expect(pdfjsOpen(res.bytes)).rejects.toMatchObject({ name: "PasswordException" });
    const pj = await pdfjsOpen(res.bytes, "open-me");
    const F = pdfjs.PermissionFlag;
    expect([...((await pj.doc.getPermissions()) ?? [])].sort((a, b) => a - b)).toEqual([F.PRINT, F.COPY, F.COPY_FOR_ACCESSIBILITY, F.PRINT_HIGH_QUALITY]);
    expect((await (await pj.doc.getPage(1)).getAnnotations()).some((a) => a.subtype === "Square")).toBe(true);
    await pj.destroy();

    // the engine kept the password: a later incremental save stays encrypted and readable
    const again = e.save(res.info.docId, { pages: identityPages(res.info), upserts: [{ markup: mk("ellipse"), page: 0 }], deletes: [], defaultAuthor: "T" }, "incremental");
    expect(Buffer.from(again.bytes.subarray(0, res.bytes.length)).equals(Buffer.from(res.bytes))).toBe(true);
    const pj2 = await pdfjsOpen(again.bytes, "open-me");
    expect((await (await pj2.doc.getPage(1)).getAnnotations()).filter((a) => a.subtype === "Square" || a.subtype === "Circle")).toHaveLength(2);
    await pj2.destroy();

    const clear = e.save(again.info.docId, { pages: identityPages(again.info), upserts: [], deletes: [], defaultAuthor: "T", security: "none" }, "incremental");
    expect(clear.info.security.encrypted).toBe(false);
    expect(mupdf.Document.openDocument(clear.bytes, "application/pdf").needsPassword()).toBe(false);
    const pj3 = await pdfjsOpen(clear.bytes);
    expect(await pj3.doc.getPermissions()).toBeNull();
    await pj3.destroy();
  });

  it("only restrictions: opens without a password but needs the permissions password for changes", async () => {
    const e = new EngineCore();
    const info = e.open(read("form.pdf"), "form.pdf");
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T", security: { userPassword: "", ownerPassword: "boss", permissions: { ...NONE, print: true } } }, "full");
    const d = mupdf.Document.openDocument(res.bytes, "application/pdf");
    expect(d.needsPassword()).toBe(false);
    expect(d.hasPermission("annotate")).toBe(false);
    const pj = await pdfjsOpen(res.bytes);
    const F = pdfjs.PermissionFlag;
    expect([...((await pj.doc.getPermissions()) ?? [])].sort((a, b) => a - b)).toEqual([F.PRINT, F.COPY_FOR_ACCESSIBILITY, F.PRINT_HIGH_QUALITY]);
    await pj.destroy();
  });
});

describe("restricted files in the app", () => {
  it("saving markups on a restricted file is blocked until the permissions password is given; form filling is allowed", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, useApp, commit, withMarkups } = await import("../../src/state/store");
    const { buildPlan, rightsBlock } = await import("../../src/state/documents");
    const core = useNodeEngine();
    const info = core.open(read("restricted.pdf"), "restricted.pdf");
    const key = addTab(info, "restricted.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    commit(key, "fill", (s) => ({ ...s, fields: { project_name: "X" } }));
    expect(rightsBlock(tab(), buildPlan(tab()))).toBeNull();
    commit(key, "add", (s) => withMarkups(s, [mk("rectangle", { pageId: s.pages[0].id })]));
    expect(rightsBlock(tab(), buildPlan(tab()))).toMatch(/markups/);
    commit(key, "secure", (s) => ({ ...s, security: "none" }));
    expect(rightsBlock(tab(), buildPlan(tab()))).toMatch(/permissions password/);
    const unlocked = core.unlock(info.docId, "owner-pw");
    useApp.setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, info: unlocked } : t)) }));
    expect(rightsBlock(tab(), buildPlan(tab()))).toBeNull();
  });
});
