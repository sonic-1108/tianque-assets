import * as THREE from 'three';
import {weaponAppearance} from '../../../shared/weapons.js';
export type WeaponDesign={id?:string;name?:string;blade:string;grip:string;core:string;appearance?:Record<string,any>};
/** One model builder for the workbench, equipped weapon, and world drops. */
export function buildForgedBlade(spec:WeaponDesign){
 const group=new THREE.Group();
 const a=weaponAppearance(spec.appearance);
 const steel=new THREE.MeshStandardMaterial({color:a.steel,metalness:.78,roughness:a.roughness});
 const dark=new THREE.MeshStandardMaterial({color:'#27373e',metalness:.85,roughness:.4});
 const brass=new THREE.MeshStandardMaterial({color:a.trim,metalness:.9,roughness:.3});
 const glow=new THREE.MeshStandardMaterial({color:spec.core==='frost'?'#a1e4ee':spec.core==='echo'?'#c0a1ef':'#8fe0e8',metalness:.45,roughness:.2,emissive:spec.core==='echo'?'#7356ac':'#599ba5',emissiveIntensity:a.glow});
 const add=(g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0)=>{const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh;};
 const shape=new THREE.Shape();shape.moveTo(-.105,.27);shape.lineTo(.105,.27);shape.lineTo(.125,1.3);shape.quadraticCurveTo(.12,1.58,-.06,1.78);shape.lineTo(-.1,1.36);shape.closePath();
 const blade=new THREE.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.018,bevelThickness:.013});blade.translate(0,0,-.0275);add(blade,steel);
 const fuller=add(new THREE.BoxGeometry(.035,1.08,.075),dark,-.02,.86);
 for(const side of [-1,1]){
  add(new THREE.BoxGeometry(.014,1.03,.006),brass,.012,.85,side*.045);
  if(spec.blade==='copper')for(let i=0;i<7;i++){const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(.015,.42+i*.13,side*.051),new THREE.Vector3(-.035,.47+i*.13,side*.052),new THREE.Vector3(i%2?.08:-.065,.51+i*.13,side*.05)]);add(new THREE.TubeGeometry(curve,8,.008,5,false),i%3===0?glow:brass);}
  for(let i=0;i<4;i++){const mark=add(new THREE.BoxGeometry(.045,.007,.005),brass,-.018,.4+i*.06,side*.055);mark.rotation.z=.4;}
 }
 const guard=add(new THREE.BoxGeometry(.48,.08,.13),brass,0,.24);guard.rotation.z=.06;
 for(const x of [-.23,.23]){const cap=add(new THREE.SphereGeometry(.055,12,8),brass,x,.24);cap.scale.set(.65,1,1);}
 add(new THREE.CylinderGeometry(.06,.065,.43,12),new THREE.MeshStandardMaterial({color:spec.grip==='silk'?'#355f59':'#382b24',roughness:.8}),0,-.015);
 for(let i=0;i<12;i++){const wrap=add(new THREE.TorusGeometry(.065,.012,5,20),new THREE.MeshStandardMaterial({color:spec.grip==='silk'?'#aec4b2':'#866648',roughness:.75}),0,-.2+i*.033);wrap.rotation.set(Math.PI/2,0,i%2?.2:-.2);}
 add(new THREE.CylinderGeometry(.09,.065,.08,8),brass,0,-.28);
 if(spec.core!=='none'){
  const ring=add(new THREE.TorusGeometry(.085,.02,8,24),brass,0,.235,.095);add(new THREE.OctahedronGeometry(.072,1),glow,0,.235,.105);
  add(new THREE.OctahedronGeometry(.05,0),glow,0,-.32);
 }
 const base=new THREE.Object3D(),tip=new THREE.Object3D();base.position.y=.27;tip.position.y=1.76;group.add(base,tip);
 const fullerMat=new THREE.MeshBasicMaterial({color:'#b4edf4',transparent:true,opacity:0});
 group.scale.set(a.width,a.length,1);
 return {group,base,tip,fullerMat,steel};
}
export function disposeWeapon(group:THREE.Group){const mats=new Set<THREE.Material>();group.traverse((o:any)=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m)}});mats.forEach(m=>m.dispose());}
