// Headless smoke test for game.js core logic (DOM/canvas stubbed, run in vm).
var noop = function(){};
var ctxStub = new Proxy({}, {
  get: function(t, k){
    if (k === "createRadialGradient") return function(){ return { addColorStop: noop }; };
    return typeof k === "string" ? noop : undefined;
  },
  set: function(){ return true; },
});
function makeEl(){
  return {
    textContent: "", classList: { add: noop, remove: noop },
    addEventListener: noop, getContext: function(){ return ctxStub; },
    width: 960, height: 640,
    getBoundingClientRect: function(){ return { left:0, top:0, width:960, height:640 }; },
  };
}
var els = {};
var rafCount = 0;
var windowStub = {
  addEventListener: noop,
  getElementById: function(id){ return els[id] || (els[id] = makeEl()); }, // fallback
};
var documentStub = { getElementById: function(id){ return els[id] || (els[id] = makeEl()); } };

// Minimal localStorage stub so the best-score / mute features can be exercised.
var store = {};
var localStorageStub = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v){ store[k] = String(v); },
};

var fs = require("fs"), vm = require("vm");
var src = fs.readFileSync(__dirname + "/game.js", "utf8");
var sandbox = {
  document: documentStub, window: windowStub,
  localStorage: localStorageStub,
  requestAnimationFrame: function(cb){ rafCount++; if (rafCount < 3000) setTimeout(function(){ cb(Date.now()); }, 0); },
  Math: Math, console: console, setTimeout: setTimeout, Date: Date, performance: performance, Proxy: Proxy,
};
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox);
} catch (e) {
  console.error("LOAD FAILED:", e); process.exit(1);
}
var A = sandbox.window.__GAME__;
if (!A) { console.error("no __GAME__ api"); process.exit(1); }

setTimeout(function(){
  try {
    A.newGame();
    console.log("state:", A.game.state, "| level:", A.game.level, "| queue:", A.game.spawnQueue);

    for (var i = 0; i < 180 && A.game.state === "playing"; i++) {
      var dt = 1/60;
      A.updateChain(dt); A.updateProjectiles(dt); A.updateParticles(dt);
    }
    console.log("after sim: chain=" + A.game.chain.length + " headDist=" + A.headDist.toFixed(0) + " queue=" + A.game.spawnQueue + " state=" + A.game.state);
    if (A.game.chain.length === 0) throw new Error("chain never formed!");

    // Plant a 3-run and match it (force all colors distinct first so only the
    // planted run can match — avoids flaky accidental seam chain reactions)
    for (var q = 0; q < A.game.chain.length; q++) if (!A.game.chain[q].power) A.game.chain[q] = { color: q % 5 };
    A.game.chain[5] = { color: 0 }; A.game.chain[6] = { color: 0 }; A.game.chain[7] = { color: 0 };
    var before = A.game.chain.length;
    var ok = A.tryMatch(6);
    var after = A.game.chain.length;
    console.log("tryMatch planted run ->", ok, "| chain", before, "->", after, "| score:", A.game.score);
    if (!ok || after !== before - 3) throw new Error("matching broken");

    // Shoot upward and step until resolved
    A.GUN.angle = -Math.PI / 2; A.game.cooldown = 0; A.shoot();
    for (var j = 0; j < 120 && A.game.projectiles.length; j++) A.updateProjectiles(1/60);
    console.log("shot resolved, projectiles left:", A.game.projectiles.length);

    // Force pit reach -> lose a life
    var livesBefore = A.game.lives;
    A.headDist = A.pathTotalGet();
    A.updateChain(1/60);
    console.log("pit reached -> lives", livesBefore, "->", A.game.lives, "| state:", A.game.state);
    if (A.game.lives !== livesBefore - 1) throw new Error("loseLife broken");

    // Force clear condition -> level complete
    A.game.chain = []; A.game.spawnQueue = 0; A.game.projectiles = [];
    A.updateChain(1/60);
    console.log("cleared -> state:", A.game.state, "| score:", A.game.score);
    if (A.game.state !== "levelclear") throw new Error("level clear broken");

    // ---- Power-up tests ----
    A.startLevel(3);
    for (var i2 = 0; i2 < 120 && A.game.chain.length < 5; i2++) A.updateChain(1/60);

    // REVERSE orb pushes the chain backward when popped
    A.game.chain[2] = { power: "reverse" };
    var pos2 = A.chainPositions(); var pm = pos2.find(function(m){ return m.i === 2; });
    var hdBefore = A.headDist;
    A.applyPower("reverse", pm.x, pm.y);
    for (var i3 = 0; i3 < 30; i3++) A.updateChain(1/60);
    console.log("reverse power -> headDist", hdBefore.toFixed(0), "->", A.headDist.toFixed(0));
    if (!(A.headDist < hdBefore)) throw new Error("reverse power broken");

    // FREEZE orb stops the chain
    A.game.reverseTimer = 0;
    A.applyPower("pause", 100, 100);
    var hdF = A.headDist;
    for (var i4 = 0; i4 < 30; i4++) A.updateChain(1/60);
    if (Math.abs(A.headDist - hdF) > 0.001) throw new Error("freeze power broken");
    console.log("freeze power -> chain held at", A.headDist.toFixed(0));

    // GOLD orb adds score
    var scB = A.game.score;
    A.applyPower("gold", 100, 100);
    if (!(A.game.score > scB)) throw new Error("gold power broken");
    console.log("gold power -> score", scB, "->", A.game.score);

    // SNAKE EYES aim assist snaps turret toward nearest marble.
    // Point the virtual cursor at a real chain marble so it is within range.
    A.game.freezeTimer = 0; A.game.aimAssist = 8;
    var anyPos = A.chainPositions()[0];
    A.mouse.x = anyPos.x; A.mouse.y = anyPos.y;
    var tgt = A.nearestChainTarget(A.mouse.x, A.mouse.y);
    if (!tgt || tgt.dist > 140) throw new Error("no chain target for aim assist");
    A.GUN.angle = -Math.PI / 2; A.game.cooldown = 0;
    A.shoot();
    var wantAng = Math.atan2(tgt.y - A.GUN.y, tgt.x - A.GUN.x);
    wantAng = Math.max(-Math.PI + 0.08, Math.min(-0.08, wantAng));
    var diff = Math.abs(A.GUN.angle - wantAng);
    console.log("snake eyes -> angle delta after snap:", diff.toFixed(3));
    if (diff > 0.5) throw new Error("aim assist broken");
    A.game.aimAssist = 0;

    // Shooting a power orb directly pops it (not inserted into chain)
    A.game.chain[1] = { power: "gold" };
    var lenB = A.game.chain.length;
    var scC = A.game.score;
    var pp = A.chainPositions().find(function(m){ return m.i === 1; });
    A.game.projectiles.push({ x: pp.x, y: pp.y - 6, vx: 0, vy: 300, color: 0 });
    for (var i5 = 0; i5 < 10 && A.game.projectiles.length; i5++) A.updateProjectiles(1/60);
    console.log("pop orb by shot -> chain", lenB, "->", A.game.chain.length, "| score", scC, "->", A.game.score);
    if (A.game.chain.length !== lenB - 1) throw new Error("power orb pop broken");

    // Best-score persistence: trigger a level clear which calls saveBest()
    A.game.score = 999999;
    A.game.chain = []; A.game.spawnQueue = 0; A.game.projectiles = [];
    A.updateChain(1/60); // -> levelComplete -> saveBest
    console.log("persisted best:", store["marbleBlastBest"]);
    if (parseInt(store["marbleBlastBest"], 10) < 999999) throw new Error("best score persistence broken");
    console.log("\nALL LOGIC TESTS PASSED \u2705");
    process.exit(0);
  } catch (e) {
    console.error("TEST FAILED \u274c:", e.message);
    process.exit(1);
  }
}, 150);
