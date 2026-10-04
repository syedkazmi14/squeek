import { createHash } from "node:crypto";
import { incidentKey } from "../renderer/incident.ts";
interface Point {
  x: number;
  y: number;
}
interface Area extends Point {
  width: number;
  height: number;
}
interface WindowPort {
  hide(): void;
  showInactive(): void;
  show(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  setBounds(bounds: Area): void;
  getBounds(): Area;
}
export interface Pointer extends Point {
  /** True when the overlay moved or reappeared, so the ghost should snap instead of fly. */
  reset: boolean;
}
interface Options {
  panel: WindowPort;
  halo: WindowPort;
  cursor: () => Point;
  workArea: (point: Point) => Area;
  /** Receives the cursor relative to the overlay; the renderer animates toward it. */
  pointer: (value: Pointer) => void;
  /** Called once per incident, at the moment the sidebar opens for it. */
  alert?: (state: string) => void;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  now?: () => number;
}
function sameArea(a: Area | undefined, b: Area) {
  return (
    !!a &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}
export function sidebarBounds(area: Area): Area {
  const width = Math.max(1, Math.min(360, area.width - 24)),
    height = Math.max(1, Math.min(520, area.height - 24));
  return {
    x: area.x + area.width - width - Math.min(12, area.width - width),
    y: area.y + Math.min(12, area.height - height),
    width,
    height,
  };
}
export function clampSidebarBounds(bounds: Area, area: Area): Area {
  const width = Math.max(1, Math.min(bounds.width, area.width));
  const height = Math.max(1, Math.min(bounds.height, area.height));
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height,
  };
}
/** Window lifecycle is independent of observation. Closing a review never changes consent. */
export class Companion {
  private readonly options: Options;
  private timer: unknown;
  private visible = true;
  private area: Area | undefined;
  private sidebarArea: Area | undefined;
  private position: Point | undefined;
  private alertKey: string | undefined;
  private alertedAt = 0;
  constructor(options: Options) {
    this.options = options;
  }
  start() {
    if (this.timer !== undefined) return;
    this.tick();
    this.timer = (this.options.setInterval ?? setInterval)(
      () => this.tick(),
      16,
    );
  }
  stop() {
    if (this.timer !== undefined)
      (
        this.options.clearInterval ??
        ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
      )(this.timer);
    this.timer = undefined;
    if (!this.options.halo.isDestroyed()) this.options.halo.hide();
    this.resetAlert();
  }
  setVisible(value: boolean) {
    this.visible = value;
    this.tick();
  }
  get isVisible() {
    return this.visible;
  }
  showSidebar(focus = false) {
    const { panel } = this.options;
    if (panel.isDestroyed()) return;
    const area = this.options.workArea(this.options.cursor());
    const previous = this.sidebarArea ? panel.getBounds() : undefined;
    const fixed = sidebarBounds(area);
    panel.setBounds(
      previous && sameArea(this.sidebarArea, area)
        ? clampSidebarBounds({ ...fixed, x: previous.x, y: previous.y }, area)
        : fixed,
    );
    this.sidebarArea = area;
    if (focus) panel.show();
    else panel.showInactive();
  }
  hideSidebar() {
    if (!this.options.panel.isDestroyed()) this.options.panel.hide();
  }
  resetAlert() {
    this.alertKey = undefined;
  }
  assessment(value: Parameters<typeof incidentKey>[0]) {
    if (!value) return;
    if (value.state === "no_detected_signal") {
      this.resetAlert();
      return;
    }
    if (!["caution", "high_risk"].includes(value.state)) return;
    const key = createHash("sha256").update(incidentKey(value)).digest("hex"),
      now = (this.options.now ?? Date.now)();
    if (key === this.alertKey && now - this.alertedAt < 60000) return;
    this.alertKey = key;
    this.alertedAt = now;
    this.showSidebar();
    this.options.alert?.(value.state);
  }
  private tick() {
    const { halo } = this.options;
    if (halo.isDestroyed()) return;
    if (!this.visible) {
      halo.hide();
      return;
    }
    const point = this.options.cursor(),
      area = this.options.workArea(point);
    let reset = !halo.isVisible();
    if (!sameArea(this.area, area)) {
      // The overlay spans the cursor's display and only moves when the cursor changes display.
      halo.setBounds({ ...area });
      this.area = area;
      reset = true;
    }
    const position = { x: point.x - area.x, y: point.y - area.y };
    if (
      reset ||
      !this.position ||
      position.x !== this.position.x ||
      position.y !== this.position.y
    ) {
      this.options.pointer({ ...position, reset });
      this.position = position;
    }
    if (!halo.isVisible()) halo.showInactive();
  }
}
