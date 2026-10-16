/** Keeps the two split panes together: the pane being used leads, the other follows its page, position and zoom. */
import type { Pane } from "../../state/store";
import { useApp } from "../../state/store";

export interface PanePosition {
  /** Page index at the centre of the pane. */
  page: number;
  /** Position of the pane's centre within that page, 0–1. */
  px: number;
  py: number;
  scale: number;
}

const followers = new Map<Pane, (p: PanePosition) => void>();
let leader: Pane | null = null;

export function followPane(pane: Pane, fn: (p: PanePosition) => void): () => void {
  followers.set(pane, fn);
  return () => {
    if (followers.get(pane) === fn) followers.delete(pane);
  };
}

/** The pane under the pointer (or being scrolled) leads. */
export function leadPane(pane: Pane) {
  leader = pane;
}

export function publishPosition(from: Pane, p: PanePosition) {
  const sp = useApp.getState().split;
  if (!sp?.sync || leader !== from) return;
  followers.get(from === "left" ? "right" : "left")?.(p);
}
