"use strict";
// Fingering Raurax Out: a pixel maze where the finger grows as you go.
// Logical resolution is 480x270 and gets scaled up in whole-number steps.

const W = 480, H = 270;
const PURPLE = "#9869b9", DARK = "#5b3a7a", WHITE = "#ffffff", FAINT = "#efe7f6";
const SKIN = "#ffd9c4", OUTLINE = "#4a1f2c", CREASE = "#e9a98f", NAIL = "#f4a3a0";
const FONT = '"Press Start 2P", monospace';

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// ---------- sizing ----------
function resize() {
  const k = Math.min(innerWidth / W, innerHeight / H);
  const s = k >= 1 ? Math.floor(k) : k;
  canvas.style.width = W * s + "px";
  canvas.style.height = H * s + "px";
}
addEventListener("resize", resize);
resize();

// ---------- sprite ----------
// girl.png is her body (drawn at 2x). Her original fingertip is drawn at the
// head of the growing finger, rotated to face the way it moves.
const SC = 2;
const girl = new Image(); girl.src = "assets/girl.png";
const GIRL_Y = H - 70 * SC;
const ANCHOR = { x: 100, y: GIRL_Y + 80 }; // finger tube starts hidden behind her hand
// The original fingertip (5x2 sprite pixels, cut from the art), pointing right.
const TIP_PIXELS = [
  ["#fedbc5", "#fed4be", "#ffd4c1", "#ffd1bf", "#5f282b"],
  ["#562430", "#4c1d28", "#451822", "#86656c", null],
];
const tips = {}; // direction -> canvas
// Tube cross-section: 1px outline above/left, 2px skin, 2px shade below/right.
// Each tip canvas carries that same 1px outline so it joins the tube seamlessly.
function buildTips() {
  const w = 5, h = 2;
  const make = (tw, th, map, outline) => {
    const c = document.createElement("canvas"); c.width = tw * SC + (outline[0] ? 1 : 0) * 0 + (tw < th ? 1 : 0); c.height = th * SC + (tw < th ? 0 : 1);
    const cc = c.getContext("2d");
    const ox = tw < th ? 1 : 0, oy = tw < th ? 0 : 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = TIP_PIXELS[y][x];
      if (!col) continue;
      const [tx, ty] = map(x, y);
      cc.fillStyle = col;
      cc.fillRect(tx * SC + ox, ty * SC + oy, SC, SC);
    }
    cc.fillStyle = OUTLINE;
    if (tw < th) cc.fillRect(0, outline[1] * SC, 1, outline[2] * SC);
    else cc.fillRect(outline[1] * SC, 0, outline[2] * SC, 1);
    return c;
  };
  tips.right = make(w, h, (x, y) => [x, y], [1, 0, 4]);
  tips.left  = make(w, h, (x, y) => [w - 1 - x, y], [1, 1, 4]);
  tips.down  = make(h, w, (x, y) => [y, x], [1, 0, 4]);
  tips.up    = make(h, w, (x, y) => [y, w - 1 - x], [1, 1, 4]);
}
buildTips();

// ---------- audio ----------
let actx = null, muted = false;
function beep(freq, dur, type = "square", vol = 0.04, when = 0) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) { /* audio is optional */ }
}
function jingle() {
  [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, 0.14, "square", 0.05, i * 0.1));
}

// ---------- maze ----------
const N = 1, E = 2, S = 4, WS = 8;
const DIRS = [
  { bit: N,  opp: S,  dx: 0,  dy: -1, key: "up" },
  { bit: E,  opp: WS, dx: 1,  dy: 0,  key: "right" },
  { bit: S,  opp: N,  dx: 0,  dy: 1,  key: "down" },
  { bit: WS, opp: E,  dx: -1, dy: 0,  key: "left" },
];

// Recursive backtracker: produces a perfect maze, so every cell is
// reachable from every other cell and the exit is always solvable.
function generateMaze(cols, rows) {
  const g = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const stack = [[0, (Math.random() * rows) | 0]];
  seen[stack[0][1]][0] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = DIRS.filter(d => {
      const nx = x + d.dx, ny = y + d.dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny][nx];
    });
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[(Math.random() * opts.length) | 0];
    const nx = x + d.dx, ny = y + d.dy;
    g[y][x] |= d.bit; g[ny][nx] |= d.opp;
    seen[ny][nx] = true;
    stack.push([nx, ny]);
  }
  return g;
}

// ---------- game state ----------
const state = {
  mode: "title", // title | play | win
  level: 1, best: 1,
  grid: null, cols: 0, rows: 0, cs: 8, mx: 64, my: 22,
  entry: 0, exit: 0,
  path: [], pts: [], len: 0, // len = drawn length in px
  winT: 0, confetti: [], time: 0,
};

function levelSize(level) {
  return {
    cols: Math.min(33, 10 + 2 * (level - 1)),
    rows: Math.min(22, 7 + (level - 1)),
  };
}

function startLevel(level) {
  const st = state;
  const { cols, rows } = levelSize(level);
  st.level = level; st.best = Math.max(st.best, level);
  st.cols = cols; st.rows = rows;
  st.cs = Math.min(Math.floor(336 / cols), Math.floor(230 / rows));
  st.mx = 472 - cols * st.cs;
  st.my = 30 + Math.floor((236 - rows * st.cs) / 2);
  st.grid = generateMaze(cols, rows);
  st.entry = (Math.random() * rows) | 0;
  st.exit = (Math.random() * rows) | 0;
  st.path = [{ x: 0, y: st.entry }];
  st.confetti = [];
  st.mode = "play";
  rebuildPts();
  st.len = 0; // the finger grows out of her hand at the start of every level
}

const cellCenter = (c) => ({
  x: state.mx + c.x * state.cs + (state.cs >> 1),
  y: state.my + c.y * state.cs + (state.cs >> 1),
});

// Pixel-by-pixel polyline of the finger: hand -> elbow -> maze path.
function rebuildPts() {
  const st = state;
  const first = cellCenter(st.path[0]);
  const corners = [{ x: ANCHOR.x, y: ANCHOR.y }, { x: 124, y: ANCHOR.y }, { x: 124, y: first.y }];
  st.path.forEach(c => corners.push(cellCenter(c)));
  const pts = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i], b = corners[i + 1];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let k = 0; k < n; k++) {
      pts.push({
        x: a.x + Math.sign(b.x - a.x) * k,
        y: a.y + Math.sign(b.y - a.y) * k,
      });
    }
  }
  pts.push(corners[corners.length - 1]);
  st.pts = pts;
}

function tryMove(key) {
  const st = state;
  if (st.mode !== "play") return;
  const target = st.pts.length - 1;
  if (Math.abs(target - st.len) > 1.5) return; // still animating
  const d = DIRS.find(d => d.key === key);
  const head = st.path[st.path.length - 1];
  if (!(st.grid[head.y][head.x] & d.bit)) { // bump into a wall
    if (!st.bumped) { beep(110, 0.06, "square", 0.04); st.bumped = true; }
    return;
  }
  st.bumped = false;
  const nx = head.x + d.dx, ny = head.y + d.dy;
  const prev = st.path[st.path.length - 2];
  if (prev && prev.x === nx && prev.y === ny) { // back-tracking: finger retracts
    st.path.pop();
    beep(330, 0.05, "triangle", 0.04);
  } else {
    st.path.push({ x: nx, y: ny });
    beep(440 + st.path.length * 4, 0.05, "square", 0.03);
  }
  rebuildPts();
}

// ---------- input ----------
const KEYMAP = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};
const held = [];
addEventListener("keydown", e => {
  if (e.key === "m" || e.key === "M") { muted = !muted; return; }
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    if (!held.includes(dir)) held.push(dir);
    advanceScreens();
    return;
  }
  if (e.key === "r" || e.key === "R") { if (state.mode === "play") startLevel(state.level); return; }
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advanceScreens(true); }
});
addEventListener("keyup", e => {
  const dir = KEYMAP[e.key];
  const i = held.indexOf(dir);
  if (i >= 0) held.splice(i, 1);
});
addEventListener("blur", () => { held.length = 0; });

function advanceScreens(force) {
  if (state.mode === "title" && (force || true)) { startLevel(1); beep(660, 0.1); }
  else if (state.mode === "win" && state.winT > 0.8) { startLevel(state.level + 1); beep(660, 0.1); }
}

// touch: swipe to steer, tap to start/continue
let touch = null;
canvas.addEventListener("pointerdown", e => { touch = { x: e.clientX, y: e.clientY }; advanceScreens(); });
canvas.addEventListener("pointermove", e => {
  if (!touch) return;
  const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  tryMove(dir);
  touch = { x: e.clientX, y: e.clientY };
});
addEventListener("pointerup", () => { touch = null; });

// ---------- update ----------
function update(dt) {
  const st = state;
  st.time += dt;
  if (st.mode === "play") {
    if (held.length) tryMove(held[held.length - 1]); else st.bumped = false;
    const target = st.pts.length - 1;
    const speed = Math.max(120, st.cs * 9);
    if (st.len < target) st.len = Math.min(target, st.len + speed * dt);
    else if (st.len > target) st.len = Math.max(target, st.len - speed * 1.4 * dt);
    const head = st.path[st.path.length - 1];
    if (head.x === st.cols - 1 && head.y === st.exit && st.len >= target - 0.5) {
      st.mode = "win"; st.winT = 0; jingle();
      for (let i = 0; i < 120; i++) {
        st.confetti.push({
          x: 120 + Math.random() * 360, y: -Math.random() * 90,
          vx: (Math.random() - 0.5) * 40, vy: 40 + Math.random() * 80,
          c: [PURPLE, DARK, SKIN, PURPLE][i & 3],
        });
      }
    }
  } else if (st.mode === "win") {
    st.winT += dt;
    st.confetti.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > H) p.y = -4; });
  }
}

// ---------- drawing ----------
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); }
function text(str, x, y, size, color, align = "left", shadow) {
  ctx.font = size + "px " + FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(str, x + Math.max(1, size / 8), y + Math.max(1, size / 8)); }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawBackground() {
  rect(0, 0, W, H, WHITE);
  // faint dotted floor so the white isn't empty
  ctx.fillStyle = FAINT;
  for (let y = 4; y < H; y += 8) for (let x = ((y >> 3) & 1) * 4; x < W; x += 8) ctx.fillRect(x, y, 1, 1);
}

function drawGirl() {
  if (girl.complete && girl.naturalWidth) ctx.drawImage(girl, 0, GIRL_Y, girl.naturalWidth * SC, girl.naturalHeight * SC);
}

function drawMaze() {
  const { grid, cols, rows, cs, mx, my, entry, exit } = state;
  ctx.fillStyle = PURPLE;
  const x1 = mx + cols * cs, y1 = my + rows * cs;
  // outer frame, with openings at entrance and exit
  ctx.fillRect(mx, my, cols * cs + 1, 1);
  ctx.fillRect(mx, y1, cols * cs + 1, 1);
  for (let y = 0; y < rows; y++) {
    if (y !== entry) ctx.fillRect(mx, my + y * cs, 1, cs + 1);
    if (y !== exit) ctx.fillRect(x1, my + y * cs, 1, cs + 1);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const c = grid[y][x];
    if (!(c & E) && x < cols - 1) ctx.fillRect(mx + (x + 1) * cs, my + y * cs, 1, cs + 1);
    if (!(c & S) && y < rows - 1) ctx.fillRect(mx + x * cs, my + (y + 1) * cs, cs + 1, 1);
  }
  // goal marker: little pulsing checker
  const gx = mx + (cols - 1) * cs + (cs >> 1), gy = my + exit * cs + (cs >> 1);
  const pulse = (state.time * 4 | 0) & 1;
  ctx.fillStyle = pulse ? DARK : PURPLE;
  ctx.fillRect(gx - 2, gy - 2, 2, 2); ctx.fillRect(gx, gy, 2, 2);
  ctx.fillStyle = pulse ? PURPLE : DARK;
  ctx.fillRect(gx, gy - 2, 2, 2); ctx.fillRect(gx - 2, gy, 2, 2);
}

// Tube cross-section matches her sprite finger: 2px skin on top/left, 2px shade under/right.
function drawFinger() {
  const st = state, pts = st.pts;
  const n = Math.min(pts.length, Math.floor(st.len) + 1);
  if (n < 1) return;
  ctx.fillStyle = OUTLINE;
  for (let i = 0; i < n; i++) ctx.fillRect(pts[i].x - 3, pts[i].y - 3, 5, 5);
  ctx.fillStyle = SKIN;
  for (let i = 0; i < n; i++) ctx.fillRect(pts[i].x - 2, pts[i].y - 2, 2, 2);
  // knuckle creases every so often
  ctx.fillStyle = CREASE;
  for (let i = 60; i < n - 12; i += 54) {
    const a = pts[i - 1], b = pts[i + 1];
    if (a.y === b.y) ctx.fillRect(pts[i].x, pts[i].y - 2, 1, 2);
    else ctx.fillRect(pts[i].x - 2, pts[i].y, 2, 1);
  }
  // the real fingertip rides at the head of the finger
  const t = pts[n - 1], p = pts[Math.max(0, n - 4)];
  let dir = state.tipDir || "right";
  if (t.x > p.x) dir = "right"; else if (t.x < p.x) dir = "left";
  else if (t.y > p.y) dir = "down"; else if (t.y < p.y) dir = "up";
  state.tipDir = dir;
  const img = tips[dir];
  if (img) {
    const horiz = dir === "right" || dir === "left";
    ctx.drawImage(img, t.x - (horiz ? 5 : 3), t.y - (horiz ? 3 : 5));
  }
}

function drawHUD() {
  const st = state;
  text("LEVEL " + st.level, 136, 10, 8, PURPLE);
  text("FINGER " + Math.round(st.len / 3) + "CM", 472, 10, 8, PURPLE, "right");
}

function drawTitle() {
  drawBackground();
  const bob = Math.sin(state.time * 3) > 0 ? 0 : 1;
  const cx = 300;
  text("FINGERING", cx, 30 + bob, 32, PURPLE, "center", DARK);
  text("RAURAX OUT", cx, 76 + bob, 32, PURPLE, "center", DARK);
  if ((state.time * 2 | 0) % 2 === 0) text("PRESS ANY KEY", cx, 134, 8, DARK, "center");
  text("ARROWS / WASD TO MOVE", cx, 156, 8, PURPLE, "center");
  text("DEAD END? BACK UP!", cx, 172, 8, PURPLE, "center");
  // her finger keeps growing out of her hand
  const len = Math.floor((state.time * 50) % 340);
  ctx.fillStyle = OUTLINE; ctx.fillRect(ANCHOR.x - 3, ANCHOR.y - 3, len + 5, 5);
  ctx.fillStyle = SKIN; ctx.fillRect(ANCHOR.x - 2, ANCHOR.y - 2, len + 2, 2);
  ctx.drawImage(tips.right, ANCHOR.x + len - 5, ANCHOR.y - 3);
  drawGirl();
}

function drawWin() {
  const st = state;
  const x = 150, y = 70, w = 310, h = 130;
  rect(x, y, w, h, DARK);
  rect(x + 2, y + 2, w - 4, h - 4, WHITE);
  rect(x + 6, y + 6, w - 12, h - 12, PURPLE);
  rect(x + 8, y + 8, w - 16, h - 16, WHITE);
  const cx = x + w / 2;
  text("FINGERING", cx, y + 20, 24, PURPLE, "center", DARK);
  text("THINGS OUT!", cx, y + 52, 24, PURPLE, "center", DARK);
  text("LEVEL " + st.level + " CLEARED", cx, y + 90, 8, DARK, "center");
  if (st.winT > 0.8 && (st.time * 2 | 0) % 2 === 0) text("PRESS ANY KEY", cx, y + 106, 8, PURPLE, "center");
  st.confetti.forEach(p => rect(p.x, p.y, 2, 2, p.c));
}

function draw() {
  const st = state;
  if (st.mode === "title") { drawTitle(); return; }
  drawBackground();
  drawMaze();
  drawFinger();
  drawGirl();
  drawHUD();
  if (st.mode === "win") drawWin();
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
document.fonts.load("8px " + FONT).finally(() => requestAnimationFrame(frame));

// test hook
window.__game = { state, startLevel, tryMove };
