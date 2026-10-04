import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Companion,
  companionBounds,
  sidebarBounds,
} from "../apps/desktop/src/main/companion.ts";
const area = { x: -1200, y: 0, width: 1200, height: 900 };
class Window {
  visible = false;
  positions: { x: number; y: number }[] = [];
  bounds: unknown;
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
  const shell = new Companion({
    panel,
    halo,
    cursor: () => point,
    workArea: () => area,
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
    move: (p: { x: number; y: number }) => {
      point = p;
      tick?.();
    },
    cleared: () => cleared,
  };
}
test("startup shows cursor companion only and follows locally without assessment", () => {
  const { shell, panel, halo, move } = setup();
  shell.start();
  assert.equal(panel.visible, false);
  assert.equal(halo.visible, true);
  assert.deepEqual(halo.positions.at(-1), { x: -584, y: 216 });
  move({ x: -500, y: 250 });
  assert.deepEqual(halo.positions.at(-1), { x: -484, y: 266 });
  assert.deepEqual(halo.bounds, { x: -484, y: 266, width: 48, height: 48 });
  const n = halo.positions.length;
  move({ x: -500, y: 250 });
  assert.equal(halo.positions.length, n);
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
test("companion visibility is separately controllable and monitor coordinates are bounded", () => {
  const { shell, halo, move } = setup();
  shell.start();
  shell.setVisible(false);
  move({ x: -50, y: 800 });
  assert.equal(halo.visible, false);
  shell.setVisible(true);
  assert.equal(halo.visible, true);
  assert.deepEqual(companionBounds({ x: -1, y: 900 }, area), {
    x: -48,
    y: 852,
  });
  const bounds = sidebarBounds(area);
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y + bounds.height <= area.y + area.height);
  shell.stop();
});
