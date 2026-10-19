import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import type { MaterialId } from '../../materials';
function Rock({color,scale=[1,1,1],metal=.3}:{color:string;scale?:[number,number,number];metal?:number}) {
  const geometry=useMemo(()=>{const g=new THREE.IcosahedronGeometry(.7,2);const p=g.getAttribute('position');for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const r=1+.07*Math.sin(x*21+y*7)*Math.cos(z*18)+.04*Math.sin(y*35+z*7);p.setXYZ(i,x*r,y*r,z*r)}g.computeVertexNormals();return g},[]);
  return <mesh geometry={geometry} scale={scale} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.68} metalness={metal} flatShading/></mesh>;
}
function Strand({points,color,r=.025,glow=false}:{points:number[][];color:string;r?:number;glow?:boolean}) {
  const curve=useMemo(()=>new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p as [number,number,number]))),[points]);
  return <mesh><tubeGeometry args={[curve,48,r,6,false]}/><meshStandardMaterial color={color} metalness={.65} roughness={.28} emissive={color} emissiveIntensity={glow?1.1:0}/></mesh>;
}
function Shard({position,scale,tilt=0,color='#9be6ed'}:{position:[number,number,number];scale:[number,number,number];tilt?:number;color?:string}) {
  const geometry=useMemo(()=>{
    const vertices:number[]=[],indices:number[]=[];
    for(let level=0;level<3;level++)for(let i=0;i<6;i++){
      const a=i*Math.PI/3, radius=level===0?.21:level===1?.26:.18;
      vertices.push(Math.cos(a)*radius,level===0?-.5:level===1?.12:.48+(i%3)*.035,Math.sin(a)*radius);
    }
    vertices.push(.035,.86,-.025);
    for(let level=0;level<2;level++)for(let i=0;i<6;i++){const a=level*6+i,b=level*6+(i+1)%6;indices.push(a,b,a+6,b,b+6,a+6)}
    for(let i=0;i<6;i++)indices.push(12+i,12+(i+1)%6,18);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();return flat;
  },[]);
  return <group position={position} rotation={[tilt,tilt*.7,tilt*.5]} scale={scale}>
    <mesh geometry={geometry} castShadow><meshPhysicalMaterial color={color} metalness={.05} roughness={.12} clearcoat={1} transparent opacity={.72} depthWrite={false} side={THREE.DoubleSide}/></mesh>
    <mesh scale={[.55,1.3,.55]}><octahedronGeometry args={[.2]}/><meshStandardMaterial color="#86d9dc" emissive="#267e8c" emissiveIntensity={.6} metalness={.2} roughness={.2}/></mesh>
    {[-1,1].map(n=><Strand key={n} r={.006} color="#e0ffff" glow points={[[n*.16,-.3,.12],[n*.19,-.04,.14],[n*.1,.18,.11],[n*.13,.38,.09]]}/>)}
  </group>;
}
function Iron() {
  const shape=useMemo(()=>{const s=new THREE.Shape();s.moveTo(-.65,-.24);s.lineTo(.45,-.24);s.lineTo(.7,.03);s.lineTo(.36,.27);s.lineTo(-.5,.27);s.lineTo(-.7,.05);s.closePath();return s},[]);
  return <group rotation={[.2,0,-.12]}>
    {[-1,0,1].map((n)=><group key={n} position={[n*.09,n*.19,0]} rotation={[Math.PI/2,0,n*.08]}><mesh castShadow><extrudeGeometry args={[shape,{depth:.12,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.04,bevelThickness:.035}]}/><meshStandardMaterial color={n===0?'#6e899a':'#aec0c8'} roughness={.32} metalness={.92}/></mesh></group>)}
    {Array.from({length:9},(_,i)=><Strand key={i} r={.008} color={i%2?'#485d66':'#d5e0df'} points={[[-.5+i*.105,.25,-.2],[-.48+i*.105,.29,0],[-.47+i*.105,.24,.18]]}/>)}
    <mesh position={[.36,.31,.07]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[.095,.009,6,32]}/><meshStandardMaterial color="#bd9861" metalness={.9} roughness={.3}/></mesh>
  </group>;
}
function Copper() {
  return <group rotation={[.12,.2,-.12]}>
    <Rock color="#293b3a" scale={[.85,.8,.8]}/>
    {Array.from({length:7},(_,i)=>{const a=i*2.4;const x=Math.cos(a),z=Math.sin(a);return <group key={i}>
      <Strand r={.045} color="#d28c51" points={[[x*.5,-.22,z*.4],[x*.35,.1,z*.4],[x*.4,.35,z*.4],[x*.25,.5,z*.2]]}/>
      <Strand r={.009} glow color="#82ebdc" points={[[x*.53,-.1,z*.42],[x*.38,.14,z*.42],[x*.44,.3,z*.43],[x*.27,.48,z*.23]]}/>
      <RoundedBox args={[.12,.18,.13]} radius={.018} smoothness={3} position={[x*.4,.36,z*.4]} rotation={[a,a,.2]} castShadow><meshStandardMaterial color="#cb8d60" metalness={.75} roughness={.34}/></RoundedBox>
    </group>})}
    <Strand r={.04} color="#e6aa79" points={[[.1,.3,0],[.14,.65,.03],[.33,.8,.01],[.27,1,0]]}/>
    <Strand r={.025} glow color="#99ffff" points={[[.14,.6,.04],[-.06,.72,.09],[.04,.88,.1]]}/>
  </group>;
}
function Frost() {
  return <group position={[0,-.15,0]}>
    <mesh position={[0,-.32,0]} scale={[1,.4,.8]} castShadow><dodecahedronGeometry args={[.6,0]}/><meshStandardMaterial color="#356b76" metalness={.25} roughness={.55}/></mesh>
    <Shard position={[0,.24,0]} scale={[1.1,1.45,1.1]}/>
    {Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <Shard key={i} position={[Math.cos(a)*.36,.05,Math.sin(a)*.32]} scale={[.7,.65+(i%3)*.15,.7]} tilt={(i%2?1:-1)*.35} color={i%2?'#50a3b0':'#9bdce2'}/>})}
    {Array.from({length:12},(_,i)=><mesh key={i} position={[Math.sin(i*4)*.55,Math.cos(i*3)*.4+.25,Math.cos(i*2)*.5]}><octahedronGeometry args={[.025]}/><meshBasicMaterial color="#dcffff"/></mesh>)}
  </group>;
}
function Echo() {
  return <group rotation={[.2,-.3,.25]}>
    {[0,1].map(i=><group key={i} rotation={[i*.75,i*.8,i*.6]}>
      <mesh castShadow><torusGeometry args={[.62+i*.14,.075,6,64,Math.PI*1.65]}/><meshStandardMaterial color={i?'#b5a4d9':'#7560a2'} metalness={.7} roughness={.24}/></mesh>
      <mesh><torusGeometry args={[.62+i*.14,.013,5,80,Math.PI*1.64]}/><meshStandardMaterial color="#e2c5ff" emissive="#a36bff" emissiveIntensity={2}/></mesh>
      {[0,1,2,3,4].map(j=><mesh key={j} position={[Math.cos(j)*(.62+i*.14),Math.sin(j)*(.62+i*.14),0]} rotation={[0,0,j]}><boxGeometry args={[.09,.14,.1]}/><meshStandardMaterial color="#d2b98d" metalness={.9} roughness={.25}/></mesh>)}
    </group>)}
    <mesh castShadow><icosahedronGeometry args={[.28,1]}/><meshPhysicalMaterial color="#291d44" metalness={.85} roughness={.18} clearcoat={1}/></mesh>
    <mesh rotation={[.8,.2,.1]}><torusGeometry args={[.3,.015,6,48]}/><meshStandardMaterial color="#c4a2ff" emissive="#a16aff" emissiveIntensity={2}/></mesh>
  </group>;
}
function Gravity() {
  return <group rotation={[.2,.2,.2]}>
    <Rock color="#554537" scale={[.8,1,.85]} metal={.6}/>
    {Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <group key={i}>
      <Strand r={.014} glow color="#d9a162" points={[[Math.cos(a)*.42,-.4,Math.sin(a)*.45],[Math.cos(a+.18)*.51,-.12,Math.sin(a+.18)*.55],[Math.cos(a)*.5,.2,Math.sin(a)*.54],[Math.cos(a+.12)*.4,.45,Math.sin(a+.12)*.4]]}/>
      <mesh position={[Math.cos(a)*.95,Math.sin(a*2)*.2,Math.sin(a)*.85]} rotation={[a,0,a]} castShadow><dodecahedronGeometry args={[.07+i%3*.025,0]}/><meshStandardMaterial color="#a58b65" metalness={.7} roughness={.4}/></mesh>
    </group>})}
    <mesh rotation={[Math.PI/2,.2,0]}><torusGeometry args={[.95,.004,4,100]}/><meshBasicMaterial color="#b68a53" transparent opacity={.4}/></mesh>
  </group>;
}
function Silk() {
  return <group rotation={[0,.25,-.35]}>
    {Array.from({length:22},(_,i)=>{const a=i/22*Math.PI*2;return <Strand key={i} color={i%4?'#c7dbcd':'#f4e6c1'} r={i%4?.009:.016} points={Array.from({length:30},(_,j)=>{const t=j/29;const r=.22+Math.sin(t*Math.PI)*.13;return [Math.cos(a+t*4)*r+(t>.7?Math.sin(t*9+i)*.1:0),t*1.5-.7,Math.sin(a+t*4)*r]})}/>})}
    {[-.5,.5].map(y=><group key={y} position={[0,y,0]}>
      <mesh rotation={[Math.PI/2,0,0]} castShadow><torusGeometry args={[.26,.055,8,48]}/><meshStandardMaterial color="#52776b" roughness={.22} metalness={.6}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[.285,.012,6,48]}/><meshStandardMaterial color="#d7b97e" metalness={1} roughness={.25}/></mesh>
    </group>)}
    {[0,1,2].map(i=><Strand key={i} r={.012} glow color="#b6e9c7" points={[[.1,.5,0],[.4,.8,i*.08],[.75,.8,i*.1],[.9,.6,i*.12]]}/>)}
  </group>;
}
export function MaterialModel({id}:{id:MaterialId}) { return id==='iron'?<Iron/>:id==='copper'?<Copper/>:id==='frost'?<Frost/>:id==='echo'?<Echo/>:id==='gravity'?<Gravity/>:<Silk/>; }
