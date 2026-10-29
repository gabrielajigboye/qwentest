/* ============================================================
   MARBLE BLAST — a Zuma-style web game (vanilla JS + Canvas)
   ============================================================ */

// ---------- DOM ----------
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var W = canvas.width, H = canvas.height;

var scoreEl = document.getElementById("score");
var comboEl = document.getElementById("combo");
var livesEl = document.getElementById("lives");
var levelEl = document.getElementById("levelBadge");
var overlay = document.getElementById("overlay");
var ovTitle = document.getElementById("ovTitle");
var ovText = document.getElementById("ovText");
var startBtn = document.getElementById("startBtn");
var pauseBtn = document.getElementById("pauseBtn");
var restartBtn = document.getElementById("restartBtn");

// ---------- Constants ----------
var MARBLE_R = 16;            // marble radius
var GAP = 2;                  // spacing between marbles in chain
var STEP = MARBLE_R * 2 + GAP; // distance between adjacent marbles along path
var SHOOT_SPEED = 780;        // px/sec for fired marbles

var COLORS = [
  { name: "red",    fill: "#ff4d4d", dark: "#a31f1f" },
  { name: "blue",   fill: "#3d8bff", dark: "#1c4fa3" },
  { name: "green",  fill: "#3ddc68", dark: "#1c8a3c" },
  { name: "yellow", fill: "#ffd23d", dark: "#b3881a" },
  { name: "purple", fill: "#b04dff", dark: "#6a1fb3" },
];

// ---------- Path (precomputed polyline with arc-length lookup) ----------
var pathPts = [];     // dense points [{x,y}]
var pathCum = [];     // cumulative lengths
var pathTotal = 0;

function buildPath(seedLevel) {
  // Generate a serpentine spline using layered sine waves, varies per level.
  pathPts = [];
  const N = 900;
  const marginX = 60, topY = 70, botY = H - 150;
  const amp = (botY - topY) / 2;
  const midY = (botY + topY) / 2;
  const loops = 2.2 + Math.min(seedLevel, 6) * 0.35;   // more wiggles later
  const phase = seedLevel * 1.7;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = marginX + t * (W - marginX * 2);
    const y = midY
      + Math.sin(t * Math.PI * 2 * loops + phase) * amp * 0.55
      + Math.sin(t * Math.PI * 4 * loops + phase * 2.3) * amp * 0.25;
    pathPts.push({ x, y });
  }
  pathCum = [0];
  for (let i = 1; i < pathPts.length; i++) {
    const dx = pathPts[i].x - pathPts[i - 1].x;
    const dy = pathPts[i].y - pathPts[i - 1].y;
    pathCum.push(pathCum[i - 1] + Math.hypot(dx, dy));
  }
  pathTotal = pathCum[pathCum.length - 1];
}

// Position + tangent at arc length s (binary search over pathCum)
function pointAt(s) {
  if (s <= 0) return { ...pathPts[0], ang: angleBetween(0) };
  if (s >= pathTotal) { const p = pathPts[pathPts.length - 1]; return { x: p.x, y: p.y, ang: angleBetween(pathPts.length - 2) }; }
  let lo = 0, hi = pathCum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pathCum[mid] <= s) lo = mid; else hi = mid;
  }
  const segLen = pathCum[hi] - pathCum[lo] || 1;
  const f = (s - pathCum[lo]) / segLen;
  const a = pathPts[lo], b = pathPts[hi];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}
function angleBetween(i) {
  const a = pathPts[i], b = pathPts[i + 1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------- Game state ----------
function randColor() { return Math.floor(Math.random() * colorCount()); }
function colorCount() { return Math.min(3 + Math.floor((game.level || 1) / 2), COLORS.length); }

var game = {
  state: "menu",       // menu | playing | paused | levelclear | gameover
  level: 1,
  score: 0,
  lives: 3,
  combo: 1,
  chain: [],           // array of marbles {color}, index 0 = FRONT (closest to pit)
  frontDist: 0,        // arc-length of the head marble's tip start (distance traveled)
  spawnQueue: 0,       // marbles left to feed in
  speed: 42,           // chain forward speed px/s
  reverseTimer: 0,     // time remaining pushing chain backward
  projectiles: [],     // flying marbles
  particles: [],
  shake: 0,
  loaded: 0,
  next: 0,
  cooldown: 0,
  lastTime: 0,
};

// ---------- Level setup ----------
function startLevel(lvl) {
  game.level = lvl;
  buildPath(lvl);
  game.chain = [];
  headDist = 0;
  game.spawnQueue = 26 + lvl * 8;
  game.speed = 40 + lvl * 9;
  game.reverseTimer = 0;
  game.projectiles = [];
  game.particles = [];
  game.combo = 1;
  game.state = "playing";
  levelEl.textContent = "Level " + lvl;
  hideOverlay();
}

function newGame() {
  game.score = 0;
  game.lives = 3;
  updateHUD();
  startLevel(1);
}

// ---------- Chain mechanics ----------
// chain[0] is the HEAD marble (farthest along the path toward the pit).
// Marble i center sits at arc length headDist - i*STEP. Marbles trail the head.
var headDist = 0; // distance of head marble along path (starts at entrance)

function updateChain(dt) {
  // Feed marbles in from the start of the path (tail extends backward off-path)
  if (game.spawnQueue > 0) {
    const tailS = headDist - game.chain.length * STEP; // slot for next marble
    if (tailS >= -STEP * 0.5) {
      game.chain.push({ color: randColor() });
      game.spawnQueue--;
    }
  }

  let dir = 1;
  if (game.reverseTimer > 0) { game.reverseTimer -= dt; dir = -1; }

  headDist += game.speed * dir * dt;
  if (headDist < 0) headDist = 0; // don't pull the head before the entrance

  // Reached the pit?
  if (headDist >= pathTotal - MARBLE_R) {
    loseLife();
    return;
  }

  // Level cleared?
  if (game.chain.length === 0 && game.spawnQueue === 0 && game.projectiles.length === 0) {
    levelComplete();
  }
}

function chainPositions() {
  // returns [{x,y,color,i}] for drawing & collision
  const out = [];
  for (let i = 0; i < game.chain.length; i++) {
    const s = headDist - i * STEP;
    if (s < -MARBLE_R) break; // still off-screen waiting to enter
    const p = pointAt(Math.max(0, s));
    out.push({ x: p.x, y: p.y, color: game.chain[i].color, i, s });
  }
  return out;
}

// ---------- Matching ----------
function tryMatch(index) {
  if (index < 0 || index >= game.chain.length) return false;
  const c = game.chain[index].color;
  // expand run
  let lo = index, hi = index; // hi = larger index = further from head
  while (lo > 0 && game.chain[lo - 1].color === c) lo--;
  while (hi < game.chain.length - 1 && game.chain[hi + 1].color === c) hi++;
  const runLen = hi - lo + 1;
  if (runLen < 3) {
    // Zuma trick: if match breaks and neighbors now same color, could chain — handled after removal
    return false;
  }
  // Remove run
  const removed = game.chain.splice(lo, runLen);
  const n = removed.length;
  game.score += n * 10 * game.combo * game.level;
  game.combo++;
  // Particles at each removed marble position
  for (let k = 0; k < n; k++) {
    const s = headDist - (lo + k) * STEP;
    const p = pointAt(Math.max(0, Math.min(s, pathTotal)));
    burst(p.x, p.y, COLORS[c].fill);
  }
  game.shake = Math.min(8, 3 + n);

  // Chain reaction: if the seam now touches same-colored marbles, match again
  if (lo > 0 && lo < game.chain.length && game.chain[lo - 1].color === game.chain[lo].color) {
    // possible new run at seam
    const seamIdx = lo - 1;
    const cc = game.chain[seamIdx].color;
    let l2 = seamIdx, h2 = seamIdx;
    while (l2 > 0 && game.chain[l2 - 1].color === cc) l2--;
    while (h2 < game.chain.length - 1 && game.chain[h2 + 1].color === cc) h2++;
    if (h2 - l2 + 1 >= 3) {
      // bonus: push chain backward on chain reaction
      game.reverseTimer = 0.6;
      tryMatch(seamIdx);
    }
  }
  updateHUD();
  return true;
}

// ---------- Shooting ----------
var GUN = { x: W / 2, y: H - 60, angle: -Math.PI / 2 };

function shoot() {
  if (game.cooldown > 0 || game.state !== "playing") return;
  game.cooldown = 0.18;
  const vx = Math.cos(GUN.angle) * SHOOT_SPEED;
  const vy = Math.sin(GUN.angle) * SHOOT_SPEED;
  game.projectiles.push({
    x: GUN.x + Math.cos(GUN.angle) * 34,
    y: GUN.y + Math.sin(GUN.angle) * 34,
    vx, vy, color: game.loaded,
  });
  game.loaded = game.next;
  game.next = randColor();
}

function updateProjectiles(dt) {
  const pos = chainPositions();
  for (let j = game.projectiles.length - 1; j >= 0; j--) {
    const pr = game.projectiles[j];
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    // out of bounds
    if (pr.x < -40 || pr.x > W + 40 || pr.y < -40 || pr.y > H + 40) {
      game.projectiles.splice(j, 1);
      continue;
    }

    // hit chain marble?
    let hit = false;
    for (const m of pos) {
      const d = Math.hypot(pr.x - m.x, pr.y - m.y);
      if (d < MARBLE_R * 2 - 4) {
        insertMarble(m.i, pr);
        hit = true;
        break;
      }
    }
    if (hit) game.projectiles.splice(j, 1);
  }
}

function insertMarble(hitIndex, pr) {
  // Decide insert before or after based on approach side
  const projSpeed = Math.hypot(pr.vx, pr.vy);
  // Insert at nearest slot: compare distance to marble in front vs behind
  let idx = hitIndex;
  const hp = chainPositions();
  const target = hp.find(m => m.i === hitIndex);
  if (target) {
    const ahead = hp.find(m => m.i === hitIndex - 1);
    const behind = hp.find(m => m.i === hitIndex + 1);
    const dAhead = ahead ? Math.hypot(pr.x - ahead.x, pr.y - ahead.y) : Infinity;
    const dBehind = behind ? Math.hypot(pr.x - behind.x, pr.y - behind.y) : Infinity;
    // which neighbor did projectile cross toward?
    if (dAhead < dBehind) idx = hitIndex;       // insert in front of it (toward head)
    else idx = hitIndex + 1;                    // insert behind
  }
  game.chain.splice(idx, 0, { color: pr.color });
  // slight recoil: push chain back a touch
  headDist = Math.max(0, headDist - 3);
  burst(pr.x, pr.y, COLORS[pr.color].fill, 8);
  tryMatch(idx);
}

// ---------- Lives / levels ----------
function loseLife() {
  game.lives--;
  updateHUD();
  game.shake = 14;
  if (game.lives <= 0) {
    gameOver(false);
  } else {
    // reset current chain: clear marbles, respawn queue partially
    burstAllChain();
    game.chain = [];
    game.spawnQueue = Math.max(10, Math.floor(game.spawnQueue * 0.6) + 12);
    headDist = 0;
    game.combo = 1;
    updateHUD();
  }
}

function levelComplete() {
  game.score += 500 * game.level;
  updateHUD();
  if (game.level >= 8) {
    gameOver(true);
  } else {
    showOverlay("LEVEL " + game.level + " CLEAR!", "Nice shooting! Get ready for Level " + (game.level + 1) + ".", "Next Level", () => startLevel(game.level + 1));
    game.state = "levelclear";
  }
}

function gameOver(won) {
  game.state = "gameover";
  showOverlay(
    won ? "YOU WIN! 🏆" : "GAME OVER",
    (won ? "You conquered all 8 levels. " : "The marbles reached the pit. ") + "Final Score: " + game.score,
    "Play Again",
    newGame
  );
}

// ---------- HUD / Overlay ----------
function updateHUD() {
  scoreEl.textContent = game.score;
  comboEl.textContent = "x" + game.combo;
  livesEl.textContent = "♥".repeat(Math.max(0, game.lives));
}

var overlayAction = null;
function showOverlay(title, text, btnLabel, action) {
  ovTitle.textContent = title;
  ovText.textContent = text;
  startBtn.textContent = btnLabel;
  overlayAction = action;
  overlay.classList.remove("hidden");
}
function hideOverlay() { overlay.classList.add("hidden"); overlayAction = null; }

startBtn.addEventListener("click", () => {
  const fn = overlayAction;
  if (fn) fn();
});

// ---------- Particles ----------
function burst(x, y, color, count = 14) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 220;
    game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, color, r: 2 + Math.random() * 3 });
  }
}
function burstAllChain() {
  for (const m of chainPositions()) burst(m.x, m.y, COLORS[m.color].fill, 6);
}
function updateParticles(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= dt;
    if (p.life <= 0) { game.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
  }
}

// ---------- Input ----------
var keys = {};
window.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === " ") { e.preventDefault(); swapMarbles(); }
  if (e.key.toLowerCase() === "p") togglePause();
  if (e.key.toLowerCase() === "r") { if (game.state !== "menu") newGame(); }
});
window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

function swapMarbles() {
  if (game.state !== "playing") return;
  const t = game.loaded; game.loaded = game.next; game.next = t;
}

// Mouse controls the SHOOTER (like Zuma): frog stays at bottom center,
// the gun turret rotates to point at the cursor. Click fires.

canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (W / r.width);
  const my = (e.clientY - r.top) * (H / r.height);
  const dx = mx - GUN.x, dy = my - GUN.y;
  if (Math.hypot(dx, dy) > 8) {
    GUN.angle = clampAngle(Math.atan2(dy, dx));
  }
});

canvas.addEventListener("mousedown", e => {
  if (e.button === 0) shoot();
  if (e.button === 2) swapMarbles();
});
canvas.addEventListener("contextmenu", e => e.preventDefault());

// Keyboard aiming support (rotate turret)
function keyboardAim(dt) {
  let rot = 0;
  if (keys["a"] || keys["arrowleft"]) rot -= 2.6 * dt;
  if (keys["d"] || keys["arrowright"]) rot += 2.6 * dt;
  if (rot) {
    GUN.angle = clampAngle(GUN.angle + rot);
  }
}
function clampAngle(a) {
  // Turret must always point upward toward the track: angle in [-PI+0.08, -0.08].
  const twoPi = Math.PI * 2;
  a = ((a % twoPi) + twoPi) % twoPi;   // normalize to [0, 2PI)
  let out;
  if (a >= Math.PI) {
    out = a - twoPi;                  // upper half -> negative angle in [-PI, 0)
  } else {
    out = a < Math.PI / 2 ? -0.08 : -Math.PI + 0.08;  // lower half -> clamp to nearest horizontal
  }
  return Math.max(-Math.PI + 0.08, Math.min(-0.08, out));
}

function togglePause() {
  if (game.state === "playing") {
    game.state = "paused";
    showOverlay("PAUSED", "Take a breath. The marbles will wait.", "Resume", () => { game.state = "playing"; hideOverlay(); });
    pauseBtn.textContent = "Resume";
  } else if (game.state === "paused") {
    game.state = "playing";
    hideOverlay();
    pauseBtn.textContent = "Pause";
  }
}
pauseBtn.addEventListener("click", togglePause);
restartBtn.addEventListener("click", () => { if (game.state !== "menu") newGame(); });

// ---------- Rendering ----------
function drawBackground() {
  ctx.fillStyle = "#0a0f14";
  ctx.fillRect(0, 0, W, H);

  // subtle grid glow
  ctx.strokeStyle = "rgba(60,90,130,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function drawPath() {
  // Track groove
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pathPts[0].x, pathPts[0].y);
  for (let i = 1; i < pathPts.length; i += 3) ctx.lineTo(pathPts[i].x, pathPts[i].y);
  ctx.strokeStyle = "#1c2634";
  ctx.lineWidth = MARBLE_R * 2 + 10;
  ctx.stroke();
  ctx.strokeStyle = "#121923";
  ctx.lineWidth = MARBLE_R * 2 + 2;
  ctx.stroke();

  // Entrance marker
  const p0 = pathPts[0];
  ctx.fillStyle = "#2b3442";
  ctx.beginPath();
  ctx.arc(p0.x, p0.y, MARBLE_R + 8, 0, Math.PI * 2);
  ctx.fill();

  // Pit / skull at end
  const pe = pathPts[pathPts.length - 1];
  ctx.save();
  ctx.translate(pe.x, pe.y);
  const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
  grad.addColorStop(0, "#ff5c5c");
  grad.addColorStop(1, "rgba(255,60,60,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e6edf3";
  ctx.font = "30px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("☠", 0, 2);
  ctx.restore();
}

function drawMarble(x, y, colorIdx, r = MARBLE_R) {
  const c = COLORS[colorIdx];
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.25, c.fill);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // swirl highlight
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0.6, 2.2);
  ctx.stroke();
}

function drawChain() {
  for (const m of chainPositions()) drawMarble(m.x, m.y, m.color);
}

function drawProjectiles() {
  for (const p of game.projectiles) {
    // trail
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    ctx.stroke();
    drawMarble(p.x, p.y, p.color, MARBLE_R - 2);
  }
}

function drawFrog() {
  ctx.save();
  ctx.translate(GUN.x, GUN.y);
  ctx.rotate(GUN.angle);
  // body
  ctx.fillStyle = "#2ea44f";
  ctx.beginPath();
  ctx.ellipse(-4, 0, 26, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  // snout / barrel
  ctx.fillStyle = "#37c460";
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(8, -9, 26, 18, 8) : ctx.rect(8, -9, 26, 18);
  ctx.fill();
  // mouth opening
  ctx.fillStyle = "#12241a";
  ctx.beginPath();
  ctx.arc(32, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-2, -16, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-2, 16, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath(); ctx.arc(0, -17, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 17, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // loaded marble in mouth
  const lx = GUN.x + Math.cos(GUN.angle) * 30;
  const ly = GUN.y + Math.sin(GUN.angle) * 30;
  drawMarble(lx, ly, game.loaded, MARBLE_R - 2);

  // next marble indicator
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("next", GUN.x + 40, GUN.y + 4);
  drawMarble(GUN.x + 62, GUN.y, game.next, 10);
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawProgress() {
  // progress bar of how close chain head is to the pit
  const frac = Math.max(0, Math.min(1, headDist / pathTotal));
  const bw = 200, bx = W - bw - 16, by = 14;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(bx, by, bw, 8);
  ctx.fillStyle = frac > 0.75 ? "#ff5c5c" : frac > 0.5 ? "#ffd23d" : "#3ddc68";
  ctx.fillRect(bx, by, bw * frac, 8);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("DANGER", bx - 8, by + 8);
}

function render() {
  ctx.save();
  if (game.shake > 0) {
    ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
  }
  drawBackground();
  if (pathPts.length) {
    drawPath();
    drawChain();
    drawProjectiles();
    drawFrog();
    drawParticles();
    drawProgress();
  }
  ctx.restore();
}

// ---------- Main loop ----------
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (ts - game.lastTime) / 1000 || 0.016);
  game.lastTime = ts;

  if (game.state === "playing") {
    game.cooldown -= dt;
    keyboardAim(dt);
    updateChain(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - 30 * dt);
  } else {
    updateParticles(dt);
  }
  render();
}

// ---------- Boot ----------
buildPath(1);
updateHUD();
requestAnimationFrame(loop);

// ---------- Debug/test API (also useful in the browser console) ----------
window.__GAME__ = { game, get headDist(){ return headDist; }, set headDist(v){ headDist = v; },
  pathTotalGet(){ return pathTotal; }, newGame, startLevel, updateChain, updateProjectiles,
  updateParticles, tryMatch, shoot, GUN, insertMarble, chainPositions };
