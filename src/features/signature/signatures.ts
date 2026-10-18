/**
 * Your signatures: pictures of your handwritten signature (drawn, typed or from a scan) that the Signature tool
 * places on pages. Kept on this computer only, in the app's local storage; nothing is sent anywhere.
 */
import { create } from "zustand";
import { newId, nowIso, type MarkupImage } from "../../markup/model";
import { fromBase64, toBase64 } from "../../platform/base64";
import { flash, useApp } from "../../state/store";

export interface SavedSignature {
  id: string;
  name: string;
  image: MarkupImage;
  created: string;
}

interface SignatureState {
  list: SavedSignature[];
  /** The one the Signature tool places. */
  current: string | null;
  /** Put the signer's name and the date under the signature. */
  caption: boolean;
  /** The signatures dialog is open. */
  dialog: boolean;
}

const STORE_KEY = "drawset.signatures";

function load(): SignatureState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (raw && Array.isArray(raw.list)) {
      const list: SavedSignature[] = raw.list
        .filter((x: any) => x && typeof x.id === "string" && x.image && typeof x.image.data === "string")
        .map((x: any) => ({
          id: x.id,
          name: String(x.name ?? "Signature"),
          created: String(x.created ?? ""),
          image: { data: fromBase64(x.image.data), mime: x.image.mime === "image/jpeg" ? "image/jpeg" : "image/png", width: Number(x.image.width) || 1, height: Number(x.image.height) || 1 },
        }));
      const current = list.some((x) => x.id === raw.current) ? raw.current : (list[0]?.id ?? null);
      return { list, current, caption: raw.caption !== false, dialog: false };
    }
  } catch {
    // unreadable: start with none
  }
  return { list: [], current: null, caption: true, dialog: false };
}

export const useSignatures = create<SignatureState>(() => load());

useSignatures.subscribe((s, prev) => {
  if (s.list === prev.list && s.current === prev.current && s.caption === prev.caption) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ list: s.list.map((x) => ({ ...x, image: { ...x.image, data: toBase64(x.image.data) } })), current: s.current, caption: s.caption }));
  } catch {
    // storage full or unavailable: the signature still works for this session
  }
});

export function addSignature(name: string, image: MarkupImage): string {
  const id = newId();
  useSignatures.setState((s) => ({ list: [...s.list, { id, name: name.trim() || "Signature", image, created: nowIso() }], current: id }));
  return id;
}

export function removeSignature(id: string) {
  useSignatures.setState((s) => {
    const list = s.list.filter((x) => x.id !== id);
    return { list, current: s.current === id ? (list[0]?.id ?? null) : s.current };
  });
}

export function currentSignature(): SavedSignature | null {
  const s = useSignatures.getState();
  return s.list.find((x) => x.id === s.current) ?? null;
}

export const openSignatures = () => useSignatures.setState({ dialog: true });

/** Picks up the Signature tool with signature `id` (or the current one); with none saved yet, opens the dialog to make one. */
export function signWith(id?: string) {
  const s = useSignatures.getState();
  const pick = id ?? s.current;
  if (!pick || !s.list.some((x) => x.id === pick)) {
    useSignatures.setState({ dialog: true });
    return;
  }
  useSignatures.setState({ current: pick, dialog: false });
  useApp.setState((st) => ({ tools: { ...st.tools, tool: "signature", chest: null } }));
  flash("Click where you want to sign, or drag a box to size it.");
}

/** "Name  18/10/2026": who signed and when, for under the signature. */
export function signatureCaption(name: string, when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${name.trim()}  ${p(when.getDate())}/${p(when.getMonth() + 1)}/${when.getFullYear()}`.trim();
}
