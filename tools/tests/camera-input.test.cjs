const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const THREE = require('three');
function fixture() {
 const target = () => ({ handlers: new Map(), addEventListener(k,f){this.handlers.set(k,f);}, removeEventListener(k){this.handlers.delete(k);}, emit(k,e={}){this.handlers.get(k)?.(e);} });
 const document=target(), window=target(), canvas=target(), exports={};
 const source=fs.readFileSync('src/CameraController.ts','utf8').replace(/^import .*;$/gm,'').replace('export class CameraController','class CameraController');
 const js=stripTypeScriptTypes(source,{mode:'transform'})+'; exports.CameraController=CameraController;';
 vm.runInNewContext(js,{exports,document,window,THREE,getSettings:()=>({sens:1}),FX:{mute:0}});
 const c=new exports.CameraController(new THREE.PerspectiveCamera(),canvas);
 const move=(x,y,t=canvas)=>document.emit('mousemove',{target:t,clientX:x,clientY:y,movementX:x,movementY:y});
 return {c,document,window,canvas,move};
}
test('unlocked canvas motion rotates camera and movement basis; UI and re-entry do not jump',()=>{
 const {c,move}=fixture();c.enabled=true;
 move(100,100);move(140,120);assert.equal(c.pendingDX,40);assert.equal(c.pendingDY,20);
 c.update(new THREE.Vector3(),.016);assert.equal(c.yaw,-.1);assert.ok(c.getMoveBasis().forward.x>0);
 move(800,500,{});move(200,200);assert.equal(c.pendingDX,0);move(210,200);assert.equal(c.pendingDX,10);
});
test('locked input keeps relative movement, disabled input is ignored, listeners clean up',()=>{
 const {c,document,window,canvas,move}=fixture();
 move(10,10);assert.equal(c.pendingDX,0);
 c.enabled=true;document.pointerLockElement=canvas;move(12,-3);assert.equal(c.pendingDX,12);
 document.emit('pointerlockchange');assert.equal(c.pendingDX,0);
 c.enabled=false;move(50,50);assert.equal(c.pendingDX,0);
 c.dispose();assert.equal(document.handlers.size,0);assert.equal(window.handlers.size,0);assert.equal(canvas.handlers.size,0);
});
