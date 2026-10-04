import {
  assessLink,
  linkMessage,
  type LinkAssessment,
} from "../../../../packages/detection/src/link.ts";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}
/** A risky link as the overlay draws it. `rect` is in screen DIPs. */
export interface LinkView {
  state: "caution" | "high_risk";
  host: string;
  message: string;
  rect: Rect;
  /** Clicks on the link are held until the user answers. */
  guarded: boolean;
  /** Only web pages are offered; a script link is never opened. */
  canOpen: boolean;
}
export type LinkChoice = "ask" | "back" | "open";
interface Options {
  /** Converts the observer's physical-pixel rect to screen DIPs. */
  toDip: (rect: Rect) => Rect;
  /** Cursor position in screen DIPs. */
  cursor: () => Point;
  show: (view: LinkView | undefined) => void;
  say: (text: string, ms: number) => void;
  speak: (text: string) => void;
  open: (url: string) => void;
  now?: () => number;
}
interface Hovered {
  url: string;
  text: string;
  rect: Rect;
  result: LinkAssessment;
}
// The ring drawn around a link is this much larger than the link on every side.
const RING_PAD = 4;
// Hovering back and forth over the same link should not repeat the voice.
const REPEAT_MS = 30000;
const SAFE_BUBBLE_MS = 3000;
const RISK_BUBBLE_MS = 8000;

function inside(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}
function webPage(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Says what a hovered link is, and holds clicks on risky ones until the user confirms. */
export class LinkGuard {
  private readonly options: Options;
  private hovered: Hovered | undefined;
  private confirming = false;
  private card: Rect | undefined;
  private last: { host: string; result: LinkAssessment; at: number } | undefined;
  private readonly allowed = new Set<string>();
  private readonly announced = new Map<string, number>();
  constructor(options: Options) {
    this.options = options;
  }

  get view(): LinkView | undefined {
    const hovered = this.hovered;
    if (!hovered) return undefined;
    const { state, host } = hovered.result;
    if (state !== "caution" && state !== "high_risk") return undefined;
    return {
      state,
      host,
      message: linkMessage(hovered.result),
      rect: hovered.rect,
      guarded: !this.allowed.has(hovered.url),
      canOpen: webPage(hovered.url),
    };
  }

  hover(link: { url: string; text: string; rect: Rect } | undefined): void {
    if (!link) {
      // While the overlay holds the click, the browser no longer reports the link under the
      // cursor. Keep the warning until the cursor actually leaves it or the user answers.
      if (
        this.hovered &&
        this.view?.guarded &&
        (this.confirming || inside(this.options.cursor(), this.hovered.rect))
      )
        return;
      this.clear();
      return;
    }
    const rect = this.options.toDip(link.rect);
    if (this.hovered?.url === link.url && this.hovered.text === link.text) {
      if (!this.confirming) {
        this.hovered.rect = rect;
        this.options.show(this.view);
      }
      return;
    }
    const result = assessLink(link.url, link.text);
    this.hovered = { url: link.url, text: link.text, rect, result };
    this.confirming = false;
    this.options.show(this.view);
    const now = (this.options.now ?? Date.now)();
    this.last = { host: result.host, result, at: now };
    const risky = result.state === "caution" || result.state === "high_risk";
    const message = linkMessage(result);
    this.options.say(message, risky ? RISK_BUBBLE_MS : SAFE_BUBBLE_MS);
    // Every link is spoken, safe ones too, so the user hears where it goes.
    if (now - (this.announced.get(link.url) ?? -Infinity) >= REPEAT_MS) {
      this.announced.set(link.url, now);
      this.options.speak(message);
    }
  }

  /**
   * The most recently hovered link, for the ghost to talk about: its site and
   * verdict only, never the full address. Forgotten after two minutes.
   */
  recent(): { host: string; state: LinkAssessment["state"]; reasons: string[] } | undefined {
    const last = this.last;
    if (!last || (this.options.now ?? Date.now)() - last.at > 120000) return undefined;
    return {
      host: last.host,
      state: last.result.state,
      reasons: last.result.reasons.map((reason) => reason.message),
    };
  }

  /** Where the confirmation card is on screen (DIPs), or undefined when it is closed. */
  setCard(rect: Rect | undefined): void {
    this.card = this.confirming ? rect : undefined;
  }

  /**
   * Whether the overlay should take the click at this cursor position: only on a
   * guarded link's ring, or on the open confirmation card. Everywhere else clicks
   * pass straight through to the page.
   */
  holdsClick(point: Point): boolean {
    const hovered = this.hovered;
    if (!hovered || !this.view?.guarded) return false;
    const ring = {
      x: hovered.rect.x - RING_PAD,
      y: hovered.rect.y - RING_PAD,
      width: hovered.rect.width + RING_PAD * 2,
      height: hovered.rect.height + RING_PAD * 2,
    };
    return inside(point, ring) || (!!this.card && inside(point, this.card));
  }

  /** Returns false when the choice no longer applies (the link went away). */
  choose(choice: LinkChoice): boolean {
    const hovered = this.hovered,
      view = this.view;
    if (!hovered || !view?.guarded) return false;
    if (choice === "ask") {
      this.confirming = true;
      return true;
    }
    if (choice === "back") {
      this.confirming = false;
      this.card = undefined;
      if (!inside(this.options.cursor(), hovered.rect)) this.clear();
      return true;
    }
    if (!this.confirming || !view.canOpen) return false;
    this.allowed.add(hovered.url);
    this.clear();
    this.options.open(hovered.url);
    return true;
  }

  reset(): void {
    this.last = undefined;
    this.allowed.clear();
    this.announced.clear();
    this.clear();
  }

  private clear(): void {
    const had = this.hovered !== undefined;
    this.hovered = undefined;
    this.confirming = false;
    this.card = undefined;
    if (had) this.options.show(undefined);
  }
}
