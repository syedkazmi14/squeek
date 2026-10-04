import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Companion,
  sidebarBounds,
  type Pointer,
} from "../apps/desktop/src/main/companion.ts";
const area = { x: -1200, y: 0, width: 1200, height: 900 };
const second = { x: 0, y: 0, width: 1600, height: 1000 };
class Window {
  visible = false;
  positions: { x: number; y: number }[] = [];
  bounds: unknown;
  getBounds() {
    return this.bounds as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }
  hide() {
    this.visible = false;
  }
  showInactive() {
    this.visible = true;
  }
  show() {
    this.visible = true;
  }
  isDestroyed() {
    return false;
  }
  isVisible() {
    return this.visible;
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds;
    this.positions.push({ x: bounds.x, y: bounds.y });
  }
}
function setup() {
  const panel = new Window(),
    halo = new Window();
  let point = { x: -600, y: 200 };
  let tick: (() => void) | undefined;
  let cleared = false;
  const pointers: Pointer[] = [];
  const alerts: string[] = [];
  const shell = new Companion({
    panel,
    halo,
    cursor: () => point,
    workArea: (p) => (p.x < 0 ? area : second),
    pointer: (value) => pointers.push(value),
    alert: (state) => alerts.push(state),
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  return {
    shell,
    panel,
    halo,
    pointers,
    alerts,
    move: (p: { x: number; y: number }) => {
      point = p;
      tick?.();
    },
    cleared: () => cleared,
  };
}
test("startup shows a display overlay that streams the cursor without assessment", () => {
  const { shell, panel, halo, pointers, move } = setup();
  shell.start();
  assert.equal(panel.visible, false);
  assert.equal(halo.visible, true);
  assert.deepEqual(halo.bounds, area);
  assert.deepEqual(pointers.at(-1), { x: 600, y: 200, reset: true });
  move({ x: -500, y: 250 });
  assert.deepEqual(pointers.at(-1), { x: 700, y: 250, reset: false });
  assert.equal(halo.positions.length, 1, "overlay stays put on its display");
  const n = pointers.length;
  move({ x: -500, y: 250 });
  assert.equal(pointers.length, n, "an idle cursor sends nothing");
  shell.stop();
});
test("reopening preserves the dragged position and redocks at fixed size on another display", () => {
  const { shell, panel, move } = setup();
  shell.start();
  shell.showSidebar();
  panel.setBounds({ x: -900, y: 100, width: 360, height: 520 });
  shell.hideSidebar();
  shell.showSidebar();
  assert.deepEqual(panel.bounds, { x: -900, y: 100, width: 360, height: 520 });
  move({ x: 100, y: 100 });
  shell.showSidebar();
  assert.deepEqual(panel.bounds, { x: 1228, y: 12, width: 360, height: 520 });
  shell.stop();
});
test("crossing displays moves the overlay and snaps the ghost", () => {
  const { shell, halo, pointers, move } = setup();
  shell.start();
  move({ x: 40, y: 60 });
  assert.deepEqual(halo.bounds, second);
  assert.deepEqual(pointers.at(-1), { x: 40, y: 60, reset: true });
  move({ x: 50, y: 60 });
  assert.deepEqual(pointers.at(-1), { x: 50, y: 60, reset: false });
  shell.stop();
});
test("suspicious results open sidebar once per incident and close preserves companion", () => {
  const { shell, panel, halo, cleared } = setup();
  shell.start();
  const result = {
    source: { processId: 1, windowHandle: "2", processStartedAt: 3 },
    state: "high_risk",
    coverage: "partial",
    evidence: [{ excerpt: "technical signal" }],
  };
  shell.assessment(result);
  assert.equal(panel.visible, true);
  shell.hideSidebar();
  assert.equal(panel.visible, false);
  assert.equal(halo.visible, true);
  shell.assessment({ ...result });
  assert.equal(panel.visible, false);
  shell.assessment({
    ...result,
    evidence: [{ excerpt: "changed technical signal" }],
  });
  assert.equal(panel.visible, true);
  shell.stop();
  assert.equal(cleared(), true);
  assert.equal(halo.visible, false);
});
test("the ghost is told to speak once per incident, not on every repeat", () => {
  const { shell, alerts } = setup();
  shell.start();
  const result = {
    source: { processId: 1, windowHandle: "2", processStartedAt: 3 },
    state: "high_risk",
    coverage: "partial",
    evidence: [{ excerpt: "technical signal" }],
  };
  shell.assessment(result);
  shell.assessment({ ...result });
  assert.deepEqual(alerts, ["high_risk"]);
  shell.assessment({ ...result, evidence: [{ excerpt: "new signal" }] });
  assert.deepEqual(alerts, ["high_risk", "high_risk"]);
  shell.assessment({ ...result, state: "unknown" });
  assert.equal(alerts.length, 2, "unknown readings never alert");
  shell.stop();
});
test("caution opens review while unknown and clean readings do not", () => {
  const { shell, panel } = setup();
  shell.start();
  const result = { state: "unknown", coverage: "partial", evidence: [] };
  shell.assessment(result);
  assert.equal(panel.visible, false);
  shell.assessment({ ...result, state: "caution" });
  assert.equal(panel.visible, true);
  shell.hideSidebar();
  shell.assessment({ ...result, state: "no_detected_signal" });
  assert.equal(panel.visible, false);
  shell.stop();
});
test("companion visibility is separately controllable and the sidebar is bounded", () => {
  const { shell, halo, pointers, move } = setup();
  shell.start();
  shell.setVisible(false);
  move({ x: -50, y: 800 });
  assert.equal(halo.visible, false);
  shell.setVisible(true);
  assert.equal(halo.visible, true);
  assert.deepEqual(pointers.at(-1), { x: 1150, y: 800, reset: true });
  const bounds = sidebarBounds(area);
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y + bounds.height <= area.y + area.height);
  shell.stop();
});
test("compact sidebar keeps its footprint and clamps on small and offset displays", () => {
  assert.deepEqual(sidebarBounds(area), {
    x: -372,
    y: 12,
    width: 360,
    height: 520,
  });
  for (const display of [
    { x: 200, y: -600, width: 320, height: 480 },
    { x: -20, y: 10, width: 20, height: 16 },
    { x: 0, y: 0, width: 1, height: 1 },
  ]) {
    const bounds = sidebarBounds(display);
    assert.ok(bounds.x >= display.x && bounds.y >= display.y);
    assert.ok(bounds.x + bounds.width <= display.x + display.width);
    assert.ok(bounds.y + bounds.height <= display.y + display.height);
    assert.ok(bounds.width <= 360 && bounds.height <= 520);
  }
});
