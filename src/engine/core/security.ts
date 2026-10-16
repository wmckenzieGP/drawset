/** Passwords and permissions: reading a document's security and the save options that set it. */
import * as mupdf from "mupdf";
import type { DocSecurity, Permissions, SecuritySpec } from "../types";

export const PERMISSION_KEYS: (keyof Permissions)[] = ["print", "copy", "edit", "annotate", "form", "assemble"];

/** Messages the engine throws so the app can ask for a password. */
export const NEEDS_PASSWORD = "NEEDS_PASSWORD";
export const WRONG_PASSWORD = "WRONG_PASSWORD";

/** /P bits (ISO 32000-2 table 22). Bits 7–8 and 13–32 must be 1; accessibility (bit 10) is always allowed. */
const BITS: Record<keyof Permissions, number> = { print: (1 << 2) | (1 << 11), edit: 1 << 3, copy: 1 << 4, annotate: 1 << 5, form: 1 << 8, assemble: 1 << 10 };
const RESERVED = ~0xf3f & ~0x3;

export function permissionBits(p: Permissions): number {
  let v = RESERVED | (1 << 9);
  for (const k of PERMISSION_KEYS) if (p[k]) v |= BITS[k];
  return v | 0;
}

export function readSecurity(doc: mupdf.PDFDocument, openPassword: boolean, owner: boolean): DocSecurity {
  const enc = doc.getTrailer().get("Encrypt");
  const encrypted = !enc.isNull();
  const permissions = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, doc.hasPermission(k === "form" ? "form" : k)])) as unknown as Permissions;
  const all = PERMISSION_KEYS.every((k) => permissions[k]);
  return { encrypted, method: encrypted ? doc.getMetaData(mupdf.Document.META_ENCRYPTION) || "Standard" : "", openPassword, owner: !encrypted || owner || all, permissions };
}

/** Save options for new security (null leaves the file's as it is). */
export function securityOptions(spec: SecuritySpec | "none" | undefined): string | null {
  if (spec === undefined) return null;
  if (spec === "none") return "encrypt=none";
  for (const p of [spec.userPassword, spec.ownerPassword]) if (/[,\0]/.test(p)) throw new Error("Passwords cannot contain commas.");
  const owner = spec.ownerPassword || spec.userPassword;
  if (!owner) throw new Error("Set an open password or a permissions password.");
  const parts = ["encrypt=aes-256", `owner-password=${owner}`, `permissions=${permissionBits(spec.permissions)}`];
  if (spec.userPassword) parts.push(`user-password=${spec.userPassword}`);
  return parts.join(",");
}
