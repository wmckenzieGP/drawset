/**
 * Bitmap cache and render queue for page previews, tiles and thumbnails.
 * Requests are re-made every frame by the views that need them; anything not asked for again
 * within a short time is dropped from the queue, so fast scrolling never builds a backlog.
 */
import { engine } from "../../engine/client";
import type { RenderRequest } from "../../engine/types";

export type Priority = 0 | 1 | 2 | 3; // 0 = most urgent

interface Entry {
  key: string;
  req: RenderRequest;
  priority: Priority;
  lastWanted: number;
}

const MAX_BITMAPS = 260;
const MAX_IN_FLIGHT = 2;
const STALE_MS = 400;

class RenderCache {
  private bitmaps = new Map<string, ImageBitmap>();
  private queue = new Map<string, Entry>();
  private inFlight = new Set<string>();
  private listeners = new Set<() => void>();
  private notifyScheduled = false;

  get(key: string): ImageBitmap | undefined {
    const b = this.bitmaps.get(key);
    if (b) {
      this.bitmaps.delete(key);
      this.bitmaps.set(key, b);
    }
    return b;
  }

  /** Returns the bitmap if cached; otherwise queues it and returns undefined. */
  request(key: string, req: RenderRequest, priority: Priority): ImageBitmap | undefined {
    const hit = this.get(key);
    if (hit) return hit;
    if (this.inFlight.has(key)) return undefined;
    const now = performance.now();
    const e = this.queue.get(key);
    if (e) {
      e.lastWanted = now;
      e.priority = Math.min(e.priority, priority) as Priority;
    } else this.queue.set(key, { key, req, priority, lastWanted: now });
    queueMicrotask(() => this.pump());
    return undefined;
  }

  /** Drops everything belonging to a document (after save or close). */
  invalidateDoc(docId: string) {
    for (const k of [...this.bitmaps.keys()]) {
      if (k.startsWith(docId + ":")) {
        this.bitmaps.get(k)?.close();
        this.bitmaps.delete(k);
      }
    }
    for (const k of [...this.queue.keys()]) if (k.startsWith(docId + ":")) this.queue.delete(k);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  private pump() {
    const now = performance.now();
    while (this.inFlight.size < MAX_IN_FLIGHT && this.queue.size) {
      let best: Entry | null = null;
      for (const e of this.queue.values()) {
        if (now - e.lastWanted > STALE_MS) {
          this.queue.delete(e.key);
          continue;
        }
        if (!best || e.priority < best.priority || (e.priority === best.priority && e.lastWanted > best.lastWanted)) best = e;
      }
      if (!best) return;
      this.queue.delete(best.key);
      this.inFlight.add(best.key);
      const key = best.key;
      engine()
        .render(best.req)
        .then((bmp) => {
          if (bmp.image) {
            this.bitmaps.set(key, bmp.image);
            while (this.bitmaps.size > MAX_BITMAPS) {
              const [oldK, oldB] = this.bitmaps.entries().next().value as [string, ImageBitmap];
              this.bitmaps.delete(oldK);
              oldB.close();
            }
          }
          this.notify();
        })
        .catch(() => undefined)
        .finally(() => {
          this.inFlight.delete(key);
          this.pump();
        });
    }
  }
}

export const renderCache = new RenderCache();

export const TILE = 512;

/** Preview scale so the longest side of the page is about 900 device pixels. */
export function previewScale(w: number, h: number): number {
  return Math.min(1.5, 900 / Math.max(w, h));
}

export function thumbScale(w: number, h: number): number {
  return 220 / Math.max(w, h);
}
