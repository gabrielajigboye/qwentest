// Verify the full render pipeline runs without errors using a recording ctx stub.
// Also stub localStorage + AudioContext-free globals used by new features.
var calls = [];
function makeCtx() {
  var grad = { addColorStop: function(){ } };
  return new Proxy({}, {
    get: function(t, k) {
      if (k === "createRadialGradient" || k === "createLinearGradient") return function(){ return grad; };
      if (k === "measureText") return function(){ return { width: 10 }; };
      return function(){ calls.push(k); };
    },
    set: function(){ return true; }
  });
}
var noop = function(){};
function makeEl(){
  return { textContent:"", classList:{add:noop,remove:noop}, addEventListener:noop,
    getContext:function(){ return makeCtx(); }, width:960, height:640,
    getBoundingClientRect:function(){ return {left:0,top:0,width:960,height:640}; } };
}
var els = {};
var windowStub = { addEventListener: noop };
var documentStub = { getElementById: function(id){ return els[id] || (els[id] = makeEl()); } };
var fs=require("fs"), vm=require("vm");
var sandbox = { document:documentStub, window:windowStub,
  localStorage: { getItem: function(){ return null; }, setItem: noop },
  requestAnimationFrame: function(){ return 0; }, // don't loop; we call manually
  Math, console, setTimeout, Date, performance, Proxy };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname+"/game.js","utf8"), sandbox);
var R = function(e){ return vm.runInContext(e, sandbox); };
R("newGame(); for(var i=0;i<240;i++){ updateChain(1/60); updateProjectiles(1/60); updateParticles(1/60); }");
R("render()");
console.log("render ok, draw ops:", calls.length);
if (calls.indexOf("arc") === -1) throw new Error("nothing drawn");
// also exercise pause overlay + restart paths
R("togglePause(); render(); togglePause();");
// power orbs in chain + active power badges + floaters + slow-mo vignette
R("startLevel(5); for(var i=0;i<300;i++){ updateChain(1/60);} game.chain[1]={power:'reverse'}; game.chain[3]={power:'gold'}; applyPower('pause',100,100); applyPower('accuracy',120,120); floater(200,200,'+999'); render();");
R("startLevel(6); for(var i=0;i<200;i++){ updateChain(1/60);} while(game.chain.length>5){game.chain.pop();} game.spawnQueue=2; updateChain(1/60); render();"); // slow-mo path
console.log("RENDER PIPELINE OK \u2705");
