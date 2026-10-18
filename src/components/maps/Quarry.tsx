import React from 'react';
import { QUARRY_ROCKS } from '../../maps';

/** Compact, deterministic expedition scenery; no downloaded assets required. */
export function QuarryMap() {
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[28, 96]} /><meshStandardMaterial color="#82917a" roughness={1} />
    </mesh>
    {/* The pale stone path leads from the camp into a circular fighting clearing. */}
    <mesh position={[0, .015, 9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[5, 24]} /><meshStandardMaterial color="#bcb39a" roughness={1} />
    </mesh>
    <mesh position={[0, .025, -6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[9, 48]} /><meshStandardMaterial color="#c2bda8" roughness={1} />
    </mesh>
    {Array.from({ length: 15 }, (_, i) => <mesh key={'step'+i} position={[Math.sin(i*2)*.3, .035, 20-i*1.7]} rotation={[-Math.PI/2,0,(i%3-1)*.08]} receiveShadow>
      <planeGeometry args={[3.5, 1.25]} /><meshStandardMaterial color={i%2 ? '#a6a695' : '#b4b3a0'} roughness={1} />
    </mesh>)}
    {/* Circular boulders match the collision radius and top height in maps.ts. */}
    {QUARRY_ROCKS.map((r,i)=><group key={'ore'+i} position={[r.x,0,r.z]}>
      <mesh position={[0,r.h/2,0]} castShadow receiveShadow>
        <cylinderGeometry args={[r.r*.75,r.r,r.h,7]} /><meshStandardMaterial color={i%2?'#566d70':'#718b89'} roughness={.9}/>
      </mesh>
      {[0,1,2].map(k=><mesh key={k} position={[(k-1)*.55,r.h+.25,0]} rotation={[.2,k*.8,.25]} castShadow>
        <octahedronGeometry args={[.4]} /><meshStandardMaterial color="#87c3b3" metalness={.5} roughness={.3} emissive="#30685a" emissiveIntensity={.25}/>
      </mesh>)}
    </group>)}
    {/* Boundary escarpments stay outside the playable circle. */}
    {Array.from({length:28},(_,i)=>{
      const a=i/28*Math.PI*2, r=34+(i%3)*2, h=9+(i*7%13);
      return <mesh key={'cliff'+i} position={[Math.sin(a)*r,h/2-1,Math.cos(a)*r]} rotation={[0,a,.08]} castShadow>
        <cylinderGeometry args={[3.3,5.8,h,5]}/><meshStandardMaterial color={i%2?'#617c7b':'#718f89'} roughness={1}/>
      </mesh>;
    })}
    {Array.from({length:20},(_,i)=>{
      const a=i/20*Math.PI*2, x=Math.sin(a)*30, z=Math.cos(a)*30;
      return <group key={'pine'+i} position={[x,0,z]}>
        <mesh position={[0,3,0]}><cylinderGeometry args={[.18,.35,6,6]}/><meshStandardMaterial color="#5b5745"/></mesh>
        {[0,1,2].map(k=><mesh key={k} position={[0,4+k*1.5,0]} castShadow><coneGeometry args={[2.3-k*.45,3.5,7]}/><meshStandardMaterial color={i%2?'#2f6252':'#3c7360'} roughness={1}/></mesh>)}
      </group>;
    })}
    {/* Camp gateway and a supply crate at the starting point. */}
    {[-5,5].map(x=><group key={x} position={[x,0,19]}>
      <mesh position={[0,2.6,0]} castShadow><cylinderGeometry args={[.35,.4,5.2,8]}/><meshStandardMaterial color="#534739"/></mesh>
      <mesh position={[0,3.3,-.6]}><boxGeometry args={[.6,.85,.6]}/><meshStandardMaterial color="#ffe0a2" emissive="#ffaf4d" emissiveIntensity={1.2}/></mesh>
    </group>)}
    <mesh position={[0,5.1,19]} castShadow><boxGeometry args={[11.6,.65,1]}/><meshStandardMaterial color="#66503a"/></mesh>
    <mesh position={[0,4.5,19.05]}><boxGeometry args={[3.6,.65,.2]}/><meshStandardMaterial color="#769487"/></mesh>
    <mesh position={[-9,.8,15]} castShadow receiveShadow><cylinderGeometry args={[1.3,1.5,1.6,6]}/><meshStandardMaterial color="#93704a" roughness={1}/></mesh>
    {/* Copper boundary inlay makes the playable edge legible. */}
    <mesh position={[0,.04,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[26.5,27,96]}/><meshStandardMaterial color="#ae9b65" roughness={.8}/></mesh>
  </group>;
}
