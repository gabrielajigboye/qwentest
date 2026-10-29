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

var fs = require("fs"), vm = require("vm");
var src = fs.readFileSync(__dirname + "/game.js", "utf8");
var sandbox = {
  document: documentStub, window: windowStub,
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

    // Plant a 3-run and match it
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

    console.log("\nALL LOGIC TESTS PASSED \u2705");
    process.exit(0);
  } catch (e) {
    console.error("TEST FAILED \u274c:", e.message);
    process.exit(1);
  }
}, 150);
