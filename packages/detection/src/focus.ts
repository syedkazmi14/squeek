import type { Observation, Rect } from "../../contracts/src/observation.ts";
import { segment } from "./segment.ts";

export interface Point { x: number; y: number }
interface Row { spans: number[]; box: Rect }

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** A list row: one or two lines tall, with columns side by side (sender, subject, date). */
function isRow(rects: Rect[], box: Rect): boolean {
  if (box.height > 90) return false;
  return rects.some((a, i) => rects.slice(i + 1).some(b =>
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= Math.min(a.height, b.height) / 2 &&
    (a.x + a.width <= b.x || b.x + b.width <= a.x)));
}

function rows(observation: Observation): Row[] {
  const units = segment(observation.spans.map(s => s.rect));
  const grouped = new Map<number, number[]>();
  units.forEach((unit, i) => grouped.set(unit, [...(grouped.get(unit) ?? []), i]));
  const found: Row[] = [];
  for (const spans of grouped.values()) {
    const rects = spans.map(i => observation.spans[i]!.rect);
    const box = rects.reduce(union);
    if (isRow(rects, box)) found.push({ spans, box });
  }
  // A list is at least three rows sharing a left edge; a lone two-column line
  // (a sidebar label and its count) is not a message preview.
  const list = found.filter(row => found.filter(other => Math.abs(other.box.x - row.box.x) <= 10).length >= 3);
  // A message list dates its rows ("3:17 AM", "Oct 3"); a table in an article does not.
  const dated = list.filter(row => row.spans.some(i => DATE.test(observation.spans[i]!.text.trim())));
  return dated.length * 2 >= list.length ? list : [];
}

const DATE = /^(?:\d{1,2}:\d{2}\s?(?:[ap]\.?m\.?)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?(?:\s+\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\s+\d{1,2}:\d{2}\s?(?:[ap]m)?)?|yesterday|today)$/i;

// Hovering a row's checkbox or the action icons that replace its date still counts.
const LEFT_SLACK = 80, RIGHT_SLACK = 250, VERTICAL_SLACK = 30;

function distance(row: Row, cursor: Point): number {
  const { x, y, width, height } = row.box;
  if (cursor.x < x - LEFT_SLACK || cursor.x > x + width + RIGHT_SLACK) return Infinity;
  return Math.max(0, y - cursor.y, cursor.y - (y + height));
}

/**
 * On a page that lists messages (an inbox), only the row under the cursor is
 * worth judging; the other rows are previews of messages the user is not
 * looking at. Pages without a list come back unchanged.
 * `key` changes exactly when the hovered row changes. Coordinates are the
 * observer's physical screen pixels.
 */
export function focusObservation(observation: Observation, cursor: Point | undefined): { observation: Observation; key: string; row?: string[] } {
  const list = rows(observation);
  if (!list.length) return { observation, key: "page" };
  let hovered: Row | undefined;
  let best = VERTICAL_SLACK;
  if (cursor) for (const row of list) {
    const d = distance(row, cursor);
    if (d <= best) { best = d; hovered = row; }
  }
  const hidden = new Set(list.filter(row => row !== hovered).flatMap(row => row.spans));
  return {
    observation: { ...observation, spans: observation.spans.filter((_, i) => !hidden.has(i)) },
    key: hovered ? `row:${hovered.spans[0]}` : "none",
    ...(hovered ? { row: hovered.spans.map(i => observation.spans[i]!.text) } : {}),
  };
}
