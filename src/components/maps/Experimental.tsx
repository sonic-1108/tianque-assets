import React, { useSyncExternalStore } from 'react';
import { Html } from '@react-three/drei';
import { adventure } from '../../adventure';
import { EXPEDITION_NODES } from '../../../shared/expedition.js';
import { MaterialModel } from '../materials/MaterialModel';
import { materialById, type MaterialId } from '../../materials';
const label:React.CSSProperties={color:'#f8edca',background:'rgba(19,34,30,.85)',padding:'5px 10px',border:'1px solid #ad9866',borderRadius:3,fontSize:12,whiteSpace:'nowrap',pointerEvents:'none'};
function Lantern({x,z}:{x:number;z:number}) {return <group position={[x,0,z]}><mesh position={[0,1,0]} castShadow><boxGeometry args={[.15,2,.15]}/><meshStandardMaterial color="#493d2f"/></mesh><mesh position={[0,1.9,0]}><boxGeometry args={[.45,.65,.45]}/><meshStandardMaterial color="#e8bc75" emissive="#f7b551" emissiveIntensity={.65}/></mesh><mesh position={[0,2.28,0]} rotation={[0,Math.PI/4,0]}><coneGeometry args={[.48,.25,4]}/><meshStandardMaterial color="#35413c"/></mesh></group>}
export function ExperimentalMap(){
 const s=useSyncExternalStore(adventure.subscribe,adventure.getSnapshot);
 return <group>
  <mesh rotation={[-Math.PI/2,0,0]} receiveShadow><circleGeometry args={[28,96]}/><meshStandardMaterial color="#697967" roughness={1}/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,.018,2]} receiveShadow><planeGeometry args={[4.5,44]}/><meshStandardMaterial color="#a69d80" roughness={1}/></mesh>
  {[-1,1].map(side=><mesh key={side} rotation={[-Math.PI/2,0,side*.75]} position={[side*6,.025,7]} receiveShadow><planeGeometry args={[2.5,17]}/><meshStandardMaterial color="#a69d80" roughness={1}/></mesh>)}
  {Array.from({length:24},(_,i)=><mesh key={'p'+i} position={[Math.sin(i*9)*.5,.05,23-i*1.9]} rotation={[-Math.PI/2,0,Math.sin(i)*.3]} receiveShadow><circleGeometry args={[1.1,5]}/><meshStandardMaterial color={i%2?'#b8af95':'#979985'}/></mesh>)}
  {Array.from({length:90},(_,i)=>{const a=i*2.399,r=6+((i*13)%190)/10,x=Math.sin(a)*r,z=Math.cos(a)*r;if(Math.abs(x)<3||Math.abs(z-7)<3||EXPEDITION_NODES.some(n=>Math.hypot(x-n.x,z-n.z)<4))return null;return <group key={'grass'+i} position={[x,0,z]}>
    <mesh rotation={[-Math.PI/2,0,a]} position={[0,.035,0]} scale={[1.5,1,1]}><circleGeometry args={[.8+(i%3)*.4,7]}/><meshStandardMaterial color={i%2?'#73806a':'#61725b'} roughness={1}/></mesh>
    {[0,1,2].map(k=><mesh key={k} position={[k*.16,.25+(i%3)*.08,0]} rotation={[.1,a+k,.12*(k-1)]}><coneGeometry args={[.12,.6+(i%3)*.15,3]}/><meshStandardMaterial color={i%2?'#9b9d65':'#4e674c'} roughness={1}/></mesh>)}
  </group>})}
  {/* A shallow spring sits outside the traversable paths. */}
  <mesh rotation={[-Math.PI/2,0,0]} position={[17,.04,3]} scale={[1,1.7,1]}><circleGeometry args={[4.4,48]}/><meshStandardMaterial color="#80aaa3" metalness={.55} roughness={.2}/></mesh>
  {Array.from({length:44},(_,i)=>{const a=i*2.399,r=29+(i%4)*2,h=6+i%9;return <group key={'edge'+i} position={[Math.sin(a)*r,0,Math.cos(a)*r]}>
   <mesh position={[0,h*.22,0]} scale={[1,h/5,1]} rotation={[.1,a,.13]} castShadow receiveShadow><dodecahedronGeometry args={[3,0]}/><meshStandardMaterial color={i%2?'#536762':'#78817a'} roughness={1}/></mesh>
   <mesh position={[0,h/2+2,0]} castShadow><cylinderGeometry args={[.14,.4,h,7]}/><meshStandardMaterial color="#514c3b"/></mesh>
   {[0,1,2].map(k=><mesh key={k} position={[Math.sin(i+k)*1.4,h*.7+k*1.3,Math.cos(k)*.7]} scale={[1.4,.65,1]} castShadow><icosahedronGeometry args={[2.5-k*.3,1]}/><meshStandardMaterial color={i%3?'#365d4b':'#627348'} roughness={1}/></mesh>)}
  </group>})}
  {/* Ruined kiln, framed by weathered pillars on the north edge. */}
  <group position={[0,0,-21]}>
   <mesh position={[0,.3,0]} receiveShadow><cylinderGeometry args={[4,4.5,.6,12]}/><meshStandardMaterial color="#7c8173"/></mesh>
   {[-4,4].map(x=><group key={x} position={[x,0,0]}><mesh position={[0,3,0]} castShadow><cylinderGeometry args={[.65,.9,6,6]}/><meshStandardMaterial color="#909786"/></mesh><mesh position={[0,6.1,0]} castShadow><boxGeometry args={[1.5,.4,1.5]}/><meshStandardMaterial color="#52675b"/></mesh></group>)}
   <mesh position={[0,5.6,0]} rotation={[0,0,.07]} castShadow><boxGeometry args={[8.8,.65,1]}/><meshStandardMaterial color="#798776"/></mesh>
   <mesh position={[0,1.4,0]} castShadow><cylinderGeometry args={[1.5,2,2.3,10]}/><meshStandardMaterial color="#484e47" metalness={.5} roughness={.6}/></mesh>
   <mesh position={[0,2.6,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.9,1.5,32]}/><meshStandardMaterial color="#b48f52" metalness={.7} roughness={.4}/></mesh>
  </group>
  {EXPEDITION_NODES.map(n=>{const taken=s.samples.includes(n.id),m=materialById(n.material);return <group key={n.id} position={[n.x,0,n.z]}>
   <mesh position={[0,.25,0]} scale={[1.8,.5,1.3]} castShadow receiveShadow><dodecahedronGeometry args={[1.1,0]}/><meshStandardMaterial color="#52655f" roughness={.9}/></mesh>
   {!taken&&<group position={[0,1,0]} scale={1.2}><MaterialModel id={n.material as MaterialId}/></group>}
   <mesh rotation={[-Math.PI/2,0,0]} position={[0,.06,0]}><ringGeometry args={[2.4,2.47,48]}/><meshBasicMaterial color={taken?'#738277':m.color} transparent opacity={.6}/></mesh>
   <Html center position={[0,3,0]} distanceFactor={18} zIndexRange={[5,0]} style={{pointerEvents:'none'}}><div style={label}>{taken?'✓ 已采集':n.name+' · '+m.name}</div></Html>
  </group>})}
  {/* Camp awning and a blacksmith with an apron, beard and hammer. */}
  <group position={[-4,0,19]}>
   {[-2,2].map(x=><mesh key={x} position={[x,1.8,0]} castShadow><cylinderGeometry args={[.12,.18,3.6,6]}/><meshStandardMaterial color="#635137"/></mesh>)}
   <mesh position={[0,3.45,-.4]} rotation={[.15,0,0]} castShadow><boxGeometry args={[4.7,.12,3]}/><meshStandardMaterial color="#8e7452" side={2}/></mesh>
   <mesh position={[-1.6,.6,-.4]} castShadow><boxGeometry args={[1,.9,.8]}/><meshStandardMaterial color="#4b5751" metalness={.6} roughness={.5}/></mesh>
   <group position={[.5,0,-.1]}>
    {[-.23,.23].map(x=><mesh key={x} position={[x,.45,0]} castShadow><capsuleGeometry args={[.17,.55,4,8]}/><meshStandardMaterial color="#333e3e"/></mesh>)}
    <mesh position={[0,1.25,0]} castShadow><capsuleGeometry args={[.38,.55,4,8]}/><meshStandardMaterial color="#61716b"/></mesh>
    <mesh position={[0,1.15,.34]} castShadow><boxGeometry args={[.58,.9,.09]}/><meshStandardMaterial color="#795c3c" roughness={1}/></mesh>
    <mesh position={[0,1.96,0]} castShadow><sphereGeometry args={[.28,12,10]}/><meshStandardMaterial color="#be9b77"/></mesh>
    <mesh position={[0,1.81,.2]} rotation={[0,0,Math.PI]}><coneGeometry args={[.18,.38,7]}/><meshStandardMaterial color="#b3b3a4"/></mesh>
    <mesh position={[0,2.17,0]}><sphereGeometry args={[.29,12,8,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color="#494a43"/></mesh>
    {[-1,1].map(side=><mesh key={side} position={[side*.45,1.2,.04]} rotation={[0,0,side*.25]} castShadow><capsuleGeometry args={[.13,.65,4,8]}/><meshStandardMaterial color="#61716b"/></mesh>)}
    <mesh position={[.57,.8,.15]}><boxGeometry args={[.12,.65,.12]}/><meshStandardMaterial color="#685139"/></mesh><mesh position={[.57,.52,.15]}><boxGeometry args={[.5,.23,.23]}/><meshStandardMaterial color="#3b4445" metalness={.7} roughness={.4}/></mesh>
   </group>
   <Html center position={[.5,3,0]} distanceFactor={16} zIndexRange={[5,0]} style={{pointerEvents:'none'}}><div style={label}>石师傅 · 营地工匠</div></Html>
  </group>
  <mesh position={[0,.065,18]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[2.6,2.8,64]}/><meshBasicMaterial color={s.samples.length>=2?'#e8c77c':'#a6b6a0'}/></mesh>
  {[[-3,13],[3,13],[-6,-12],[6,-12]].map(([x,z],i)=><Lantern key={i} x={x} z={z}/>)}
 </group>
}
