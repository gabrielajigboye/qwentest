// Verify the full render pipeline runs without errors using a recording ctx stub.
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
R("startLevel(5); for(var i=0;i<120;i++){ updateChain(1/60);} render();");
console.log("RENDER PIPELINE OK \u2705");
