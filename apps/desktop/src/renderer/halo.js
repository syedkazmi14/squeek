// Cursor ghost. The window is a click-through overlay spanning the cursor's display;
// main streams the cursor position and this page runs the follow and jiggle physics.
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
let W = 0,
  H = 0,
  dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = undefined;
}

const R = 17; // body radius
const S = R / 46; // scale for features sized against the original radius
const HOVER = 30; // distance the ghost keeps from the cursor
const N = 56; // outline points
const PAD = R * 3; // covers tail, wobble and squash when clearing

const palettes = {
  calm: ["#FFD860", "#FFC53A", "#F0A920"],
  risk: ["#FFB25C", "#F58A2E", "#D9621A"],
};

const mouse = { x: 0, y: 0 };
const pos = { x: 0, y: 0 };
const vel = { x: 0, y: 0 };
const prevVel = { x: 0, y: 0 };
const tail = { x: -0.6, y: 0.8 };
const eye = { x: 0, y: 0, vx: 0, vy: 0 };
let ready = false;
let dirty;

const dirs = [],
  radii = [],
  radV = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  dirs.push({ x: Math.cos(a), y: Math.sin(a), a });
  radii.push(R);
  radV.push(0);
}

function snap() {
  pos.x = mouse.x - HOVER * 0.7;
  pos.y = mouse.y + HOVER * 0.7;
  vel.x = vel.y = prevVel.x = prevVel.y = 0;
  eye.x = eye.y = eye.vx = eye.vy = 0;
  tail.x = -0.6;
  tail.y = 0.8;
  for (let i = 0; i < N; i++) {
    radii[i] = R;
    radV[i] = 0;
  }
}

window.squeek.onState((state) => {
  if (["paused", "monitoring", "unknown", "risk"].includes(state.status))
    document.body.dataset.state = state.status;
});
window.squeek.onPointer((pointer) => {
  if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) return;
  mouse.x = pointer.x;
  mouse.y = pointer.y;
  if (pointer.reset || !ready) {
    // The overlay itself moved, so the canvas size may have changed too.
    resize();
    snap();
    ready = true;
  }
});
window.addEventListener("resize", resize);
resize();

let blinkT = 0,
  nextBlink = performance.now() + 2500;

function step(t) {
  // Follow: hover at a distance from the cursor, springy and floaty
  const dx = mouse.x - pos.x,
    dy = mouse.y - pos.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / dist,
    uy = dy / dist;
  const tx = mouse.x - ux * HOVER,
    ty = mouse.y - uy * HOVER;
  vel.x += (tx - pos.x) * 0.035;
  vel.y += (ty - pos.y) * 0.035;
  vel.x *= 0.76;
  vel.y *= 0.76;
  // idle bob
  vel.y += Math.sin(t * 0.0025) * 0.04;
  pos.x += vel.x;
  pos.y += vel.y;

  const ax = vel.x - prevVel.x,
    ay = vel.y - prevVel.y;
  prevVel.x = vel.x;
  prevVel.y = vel.y;
  const speed = Math.hypot(vel.x, vel.y);

  // Tail points away from the cursor and against motion, with a downward resting bias
  let wx = -ux * 0.9 - vel.x * 0.12;
  let wy = -uy * 0.9 - vel.y * 0.12 + 0.55;
  const wl = Math.hypot(wx, wy) || 1;
  wx /= wl;
  wy /= wl;
  tail.x += (wx - tail.x) * 0.06;
  tail.y += (wy - tail.y) * 0.06;
  const tailAng = Math.atan2(tail.y, tail.x);
  const tailLen = (24 + Math.min(speed * 0.5, 1) + Math.sin(t * 0.004)) * S;

  // Body jiggle: each outline point is a radial spring, coupled to neighbours
  for (let i = 0; i < N; i++) {
    const d = dirs[i];
    let diff = d.a - tailAng;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const c = Math.max(0, Math.cos(diff));
    let rest = R + tailLen * Math.pow(c, 9);
    // squash/stretch along velocity
    rest -= Math.max(-1.7, Math.min(1.3, (d.x * vel.x + d.y * vel.y) * 0.09));
    // idle wobble
    rest +=
      Math.sin(t * 0.003 + d.a * 3) * 0.6 +
      Math.sin(t * 0.0047 - d.a * 2) * 0.45;

    radV[i] += (rest - radii[i]) * 0.25;
    // inertia: leading side compresses when accelerating
    radV[i] -= Math.max(-0.7, Math.min(0.5, (d.x * ax + d.y * ay) * 0.3));
    const prev = radii[(i - 1 + N) % N],
      next = radii[(i + 1) % N];
    radV[i] += ((prev + next) / 2 - radii[i]) * 0.18;
    radV[i] *= 0.77;
  }
  for (let i = 0; i < N; i++) radii[i] += radV[i];

  // Eyes: look toward the cursor, lag behind body acceleration
  const look = Math.min(dist / 160, 1);
  const etx = ux * 9 * S * look,
    ety = uy * 7 * S * look;
  eye.vx += (etx - eye.x) * 0.1 - ax * 0.4;
  eye.vy += (ety - eye.y) * 0.1 - ay * 0.4;
  const mx = 9 * S;
  const pl = Math.hypot(eye.x, eye.y);
  if (pl > mx * 0.7) {
    const pull = ((pl - mx * 0.7) * 0.35) / pl;
    eye.vx -= eye.x * pull;
    eye.vy -= eye.y * pull;
  }
  eye.vx *= 0.8;
  eye.vy *= 0.8;
  eye.x += eye.vx;
  eye.y += eye.vy;
  const ml = Math.hypot(eye.x, eye.y);
  if (ml > mx) {
    const nx = eye.x / ml,
      ny = eye.y / ml;
    eye.x = nx * mx;
    eye.y = ny * mx;
    const out = eye.vx * nx + eye.vy * ny;
    if (out > 0) {
      eye.vx -= nx * out;
      eye.vy -= ny * out;
    }
  }

  // Blink
  if (t > nextBlink) {
    blinkT = t;
    nextBlink = t + 2200 + Math.random() * 3500;
  }
}

function draw(t) {
  // Only clear around the ghost: the canvas spans a whole display.
  if (dirty) ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
  else ctx.clearRect(0, 0, W, H);
  dirty = {
    x: Math.floor(pos.x - PAD),
    y: Math.floor(pos.y - PAD),
    w: Math.ceil(PAD * 2),
    h: Math.ceil(PAD * 2),
  };

  const pts = dirs.map((d, i) => ({
    x: pos.x + d.x * radii[i],
    y: pos.y + d.y * radii[i],
  }));

  const colors =
    document.body.dataset.state === "risk" ? palettes.risk : palettes.calm;
  const g = ctx.createRadialGradient(
    pos.x - R * 0.35,
    pos.y - R * 0.45,
    R * 0.1,
    pos.x,
    pos.y,
    R * 1.5,
  );
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  const last = pts[N - 1];
  ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
  for (let i = 0; i < N; i++) {
    const p = pts[i],
      q = pts[(i + 1) % N];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
  ctx.fill();

  // Eyes
  const bt = (t - blinkT) / 160;
  const blink = bt >= 0 && bt < 1 ? Math.abs(Math.cos(bt * Math.PI)) : 1;
  const ex = pos.x + eye.x,
    ey = pos.y - 4 * S + eye.y;
  ctx.fillStyle = "#000";
  const lim = Math.min(...radii) * 0.72 - 7.4 * S;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    let cx = ex + s * 15 * S - pos.x,
      cy = ey - pos.y;
    const cl = Math.hypot(cx, cy);
    if (cl > lim) {
      cx *= lim / cl;
      cy *= lim / cl;
    }
    ctx.ellipse(
      pos.x + cx,
      pos.y + cy,
      6.2 * S,
      Math.max(7.4 * S * blink, 0.8),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

let lastFrame = performance.now(),
  acc = 0;
const STEP = 1000 / 60;
function frame(now) {
  acc += Math.min(now - lastFrame, 100);
  lastFrame = now;
  if (ready) {
    while (acc >= STEP) {
      step(now);
      acc -= STEP;
    }
    draw(now);
  } else acc = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
