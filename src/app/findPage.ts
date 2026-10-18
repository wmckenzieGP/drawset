/** Finds a page by number ("12") or by label ("M-012"); returns the page index or -1. */
export function findPage(input: string, labels: string[]): number {
  const q = input.trim();
  if (!q) return -1;
  const exact = labels.findIndex((l) => l === q);
  if (exact >= 0) return exact;
  const ci = labels.findIndex((l) => l.toLowerCase() === q.toLowerCase());
  if (ci >= 0) return ci;
  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10);
    if (n >= 1 && n <= labels.length) return n - 1;
  }
  return -1;
}
