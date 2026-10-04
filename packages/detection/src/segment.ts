import type { Rect } from "../../contracts/src/observation.ts";

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * True when `next` reads on from `prev`: more of the same line, or the next
 * line or paragraph directly below in the same column.
 */
function continues(prev: Rect, next: Rect): boolean {
  const line = Math.min(prev.height, next.height, 40);
  const sameLine =
    overlap(prev.y, prev.y + prev.height, next.y, next.y + next.height) >= line / 2;
  if (sameLine) return true;
  const sameColumn =
    overlap(prev.x, prev.x + prev.width, next.x, next.x + next.width) > 0;
  const gap = next.y - (prev.y + prev.height);
  return sameColumn && gap > -line / 2 && gap <= Math.max(12, line * 1.5);
}

/**
 * Splits a page into units of text that belong together, so words from one
 * email cannot combine with words from the email listed next to it. Spans
 * arrive in document order; a list row ends at its rightmost column and the
 * next row starts back at the left, which breaks the chain.
 * Returns the unit number of each span.
 */
export function segment(rects: Rect[]): number[] {
  let unit = 0;
  return rects.map((rect, i) => {
    if (i > 0 && !continues(rects[i - 1]!, rect)) unit++;
    return unit;
  });
}
