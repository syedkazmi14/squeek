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

// Speech bubble: shown above the ghost whenever it speaks.
const BUBBLE_MS = 8000;
const BUBBLE_FADE_IN = 180;
const BUBBLE_FADE_OUT = 300;
// Large enough for older eyes.
const BUBBLE_FONT = "600 16px system-ui, 'Segoe UI', sans-serif";
const BUBBLE_MAX = 290;
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_Y = 10;
const BUBBLE_LINE = 22;
// Words appear as Squeek says them: about the pace of its slowed voice.
const TYPE_CHARS_PER_SECOND = 14;
const TYPE_DELAY = 250;
const BUBBLE_TAIL = 8;
let bubble;

function wrap(text) {
  ctx.font = BUBBLE_FONT;
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > BUBBLE_MAX) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

let lastStatus;
window.squeek.onState((state) => {
  if (["paused", "monitoring", "unknown", "risk"].includes(state.status))
    document.body.dataset.state = state.status;
  const cleared = lastStatus === "risk" && state.status !== "risk";
  lastStatus = state.status;
  // The warning no longer applies once the risk is gone.
  if (cleared && bubble)
    bubble.until = Math.min(bubble.until, performance.now() + BUBBLE_FADE_OUT);
});
window.squeek.onSay((message) => {
  // A cancelled question takes back its "I'm listening" bubble.
  if (message?.clear === true) {
    if (bubble)
      bubble.until = Math.min(bubble.until, performance.now() + BUBBLE_FADE_OUT);
    return;
  }
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!text || text.length > 500) return;
  const ms =
    Number.isFinite(message?.ms) && message.ms >= 1000 && message.ms <= 45000
      ? message.ms
      : BUBBLE_MS;
  const now = performance.now();
  bubble = { lines: wrap(text), born: now, until: now + ms };
});

// Link warnings: a ring around a risky link and, once it is clicked, a card asking
// whether to open it. Main holds the click (stops the overlay passing it through)
// only while the cursor is on the ring or the card, judged from the cursor position.
const ring = document.getElementById("link-ring");
const card = document.getElementById("link-card");
const cardTitle = document.getElementById("link-title");
const cardText = document.getElementById("link-text");
const backButton = document.getElementById("link-back");
const openButton = document.getElementById("link-open");
let link;
function validLink(view) {
  const r = view?.rect;
  return (
    view &&
    ["caution", "high_risk"].includes(view.state) &&
    typeof view.message === "string" &&
    view.message.length <= 300 &&
    [r?.x, r?.y, r?.width, r?.height].every(Number.isFinite) &&
    r.width > 0 &&
    r.height > 0
  );
}
function closeCard() {
  if (card.hidden) return;
  card.hidden = true;
  window.squeek.linkCard(null);
}
function placeCard() {
  const r = link.rect,
    margin = 12,
    width = card.offsetWidth,
    height = card.offsetHeight;
  const below = r.y + r.height + margin + height <= H - margin;
  card.style.left = `${Math.max(margin, Math.min(r.x, W - width - margin))}px`;
  card.style.top = `${below ? r.y + r.height + margin : Math.max(margin, r.y - height - margin)}px`;
  const placed = card.getBoundingClientRect();
  window.squeek.linkCard({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
  });
}
window.squeek.onLink((view) => {
  link = validLink(view) ? view : undefined;
  if (!link) {
    ring.hidden = true;
    closeCard();
    return;
  }
  const pad = 4;
  ring.style.left = `${link.rect.x - pad}px`;
  ring.style.top = `${link.rect.y - pad}px`;
  ring.style.width = `${link.rect.width + pad * 2}px`;
  ring.style.height = `${link.rect.height + pad * 2}px`;
  ring.dataset.state = link.state;
  ring.classList.toggle("guarded", link.guarded === true);
  ring.hidden = false;
  if (!link.guarded) closeCard();
  else if (!card.hidden) placeCard();
});
ring.addEventListener("click", () => {
  if (!link?.guarded) return;
  cardTitle.textContent =
    link.state === "high_risk"
      ? "This link looks like a scam"
      : "Be careful with this link";
  cardText.textContent = link.message;
  openButton.hidden = link.canOpen !== true;
  card.hidden = false;
  // Main only accepts the card's position once it knows the user asked.
  void window.squeek.linkChoice("ask").then(placeCard);
});
backButton.addEventListener("click", () => {
  closeCard();
  void window.squeek.linkChoice("back");
});
openButton.addEventListener("click", () => {
  closeCard();
  void window.squeek.linkChoice("open");
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
  let box = {
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
  dirty = drawBubble(t, box);
}

function drawBubble(t, box) {
  if (!bubble) return box;
  const age = t - bubble.born,
    left = bubble.until - t;
  if (left <= 0) {
    bubble = undefined;
    return box;
  }
  const alpha = Math.min(
    1,
    age / BUBBLE_FADE_IN,
    Math.max(0, left / BUBBLE_FADE_OUT),
  );
  ctx.font = BUBBLE_FONT;
  const w =
      Math.ceil(Math.max(...bubble.lines.map((l) => ctx.measureText(l).width))) +
      BUBBLE_PAD_X * 2,
    h = bubble.lines.length * BUBBLE_LINE + BUBBLE_PAD_Y * 2 - 4;
  const margin = 10;
  const x = Math.max(margin, Math.min(pos.x - w / 2, W - w - margin));
  // Sit above the ghost, rising slightly as it fades in; flip below at the top of the screen.
  const rise = (1 - Math.min(1, age / BUBBLE_FADE_IN)) * 6;
  const above = pos.y - R - BUBBLE_TAIL - 6 - h + rise >= margin;
  const y = above
    ? pos.y - R - BUBBLE_TAIL - 6 - h + rise
    : pos.y + R + BUBBLE_TAIL + 6 - rise;
  const tipX = Math.max(x + 16, Math.min(pos.x, x + w - 16));
  const baseY = above ? y + h : y;
  const tipY = above ? y + h + BUBBLE_TAIL : y - BUBBLE_TAIL;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(27, 26, 23, 0.22)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#FFFDF8";
  ctx.strokeStyle = "#E9E4D6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();
  // Tail pointing at the ghost, drawn over the bubble edge so there is no seam.
  ctx.beginPath();
  ctx.moveTo(tipX - 7, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + 7, baseY);
  ctx.closePath();
  ctx.fillStyle = "#FFFDF8";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tipX - 7, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + 7, baseY);
  ctx.stroke();
  ctx.fillStyle = "#FFFDF8";
  ctx.fillRect(tipX - 6, baseY - 1, 12, 2);
  ctx.fillStyle = "#1B1A17";
  ctx.textBaseline = "middle";
  // Typewriter: the bubble keeps its full size while the words fill in.
  let shown = Math.max(0, Math.floor(((age - TYPE_DELAY) / 1000) * TYPE_CHARS_PER_SECOND));
  bubble.lines.forEach((line, i) => {
    if (shown <= 0) return;
    ctx.fillText(
      line.slice(0, shown),
      x + BUBBLE_PAD_X,
      y + BUBBLE_PAD_Y - 2 + BUBBLE_LINE * (i + 0.5),
    );
    shown -= line.length + 1;
  });
  ctx.restore();

  const pad = 16;
  const top = Math.min(box.y, y - BUBBLE_TAIL - pad, tipY - pad),
    bottom = Math.max(box.y + box.h, y + h + BUBBLE_TAIL + pad, tipY + pad);
  const lx = Math.min(box.x, x - pad),
    rx = Math.max(box.x + box.w, x + w + pad);
  return {
    x: Math.floor(lx),
    y: Math.floor(top),
    w: Math.ceil(rx - lx),
    h: Math.ceil(bottom - top),
  };
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
