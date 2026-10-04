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
}
interface Options {
  panel: WindowPort;
  halo: WindowPort;
  cursor: () => Point;
  workArea: (point: Point) => Area;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  now?: () => number;
}
export function companionBounds(point: Point, area: Area): Point {
  return {
    x: Math.round(
      Math.max(area.x, Math.min(point.x + 16, area.x + area.width - 48)),
    ),
    y: Math.round(
      Math.max(area.y, Math.min(point.y + 16, area.y + area.height - 48)),
    ),
  };
}
export function sidebarBounds(area: Area): Area {
  const width = Math.max(1, Math.min(520, area.width - 24)),
    height = Math.max(1, area.height - 24);
  return {
    x: area.x + area.width - width - Math.min(12, area.width - width),
    y: area.y + Math.min(12, area.height - height),
    width,
    height,
  };
}
/** Window lifecycle is independent of observation. Closing a review never changes consent. */
export class Companion {
  private readonly options: Options;
  private timer: unknown;
  private visible = true;
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
      33,
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
    panel.setBounds(
      sidebarBounds(this.options.workArea(this.options.cursor())),
    );
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
  }
  private tick() {
    const { halo } = this.options;
    if (halo.isDestroyed()) return;
    if (!this.visible) {
      halo.hide();
      return;
    }
    const point = this.options.cursor(),
      position = companionBounds(point, this.options.workArea(point));
    if (
      !this.position ||
      position.x !== this.position.x ||
      position.y !== this.position.y
    ) {
      // Preserve the intended size across Windows display scaling and rounding.
      halo.setBounds({ ...position, width: 48, height: 48 });
      this.position = position;
    }
    if (!halo.isVisible()) halo.showInactive();
  }
}
