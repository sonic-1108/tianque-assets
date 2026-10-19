import React, { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, RoundedBox } from '@react-three/drei';
import { RoomEnvironment } from 'three-stdlib';
import * as THREE from 'three';
import { MaterialModel } from './MaterialModel';
import type { MaterialId } from '../../materials';
function Lighting(){const {gl,scene}=useThree();useEffect(()=>{const generator=new THREE.PMREMGenerator(gl);const room=new (RoomEnvironment as any)();const target=generator.fromScene(room,.04);const previous=scene.environment;scene.environment=target.texture;return()=>{scene.environment=previous;target.dispose();room.dispose();generator.dispose()}},[gl,scene]);return null}
function Workshop({id}:{id:MaterialId}){
  const wood=useMemo(()=>{const size=256,data=new Uint8Array(size*size*4);let seed=4821;for(let y=0;y<size;y++)for(let x=0;x<size;x++){seed=(seed*1664525+1013904223)>>>0;const grain=Math.sin(x*.3+Math.sin(y*.023)*1.7+Math.sin(y*.06)*.6)*8+Math.sin(x*1.4+y*.02)*3;const n=(seed/4294967296-.5)*13;const i=(y*size+x)*4;data[i]=92+grain+n;data[i+1]=64+grain*.7+n;data[i+2]=41+grain*.5+n;data[i+3]=255}const t=new THREE.DataTexture(data,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,1);t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t},[]);
  useEffect(()=>()=>wood.dispose(),[wood]);
  const dust=useMemo(()=>new Float32Array(Array.from({length:100*3},(_,i)=>Math.sin(i*41.73)* (i%3===1?1.8:3))),[]);
  const offset={iron:-.2,copper:-.1,frost:0,echo:.2,gravity:0,silk:.1}[id];
  return <group>
    <group position={[0,offset,0]}><MaterialModel id={id}/></group>
    {/* Solid timber workbench, visible plank edges and hammered brass fasteners. */}
    {[-2,-1,0,1,2].map(n=><group key={n} position={[n*.89,-.98,0]}><RoundedBox args={[.87,.22,3.25]} radius={.035} smoothness={2} receiveShadow><meshStandardMaterial map={wood} roughness={.82} bumpMap={wood} bumpScale={.035}/></RoundedBox>{[-1.4,1.4].map(z=><mesh key={z} position={[0,.113,z]} rotation={[-Math.PI/2,0,0]}><cylinderGeometry args={[.025,.025,.008,8]}/><meshStandardMaterial color="#73624d" metalness={.85} roughness={.6}/></mesh>)}</group>)}
    <RoundedBox args={[2.45,.025,2]} position={[0,-.846,0]} rotation={[0,.13,0]} radius={.06} smoothness={3} receiveShadow><meshStandardMaterial color="#283c3a" roughness={1}/></RoundedBox>
    <mesh position={[0,-.77,0]} castShadow receiveShadow><cylinderGeometry args={[1.03,1.06,.13,80]}/><meshStandardMaterial color="#4e4c40" metalness={.75} roughness={.48}/></mesh>
    <mesh position={[0,-.695,0]} receiveShadow><cylinderGeometry args={[.95,.95,.025,80]}/><meshStandardMaterial color="#253331" metalness={.5} roughness={.58}/></mesh>
    {[.96,1].map(r=><mesh key={r} position={[0,-.69,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[r,.008,5,96]}/><meshStandardMaterial color="#ae8d55" metalness={.9} roughness={.35}/></mesh>)}
    {Array.from({length:36},(_,i)=>{const a=i/36*Math.PI*2;return <mesh key={i} position={[Math.cos(a)*.98,-.68,Math.sin(a)*.98]} rotation={[-Math.PI/2,0,-a]}><planeGeometry args={[.025,.004]}/><meshBasicMaterial color="#c5a36c"/></mesh>})}
    {/* Hammer and calipers form part of the scene, rather than a flat background image. */}
    <group position={[-1.5,-.72,.15]} rotation={[0,-.6,Math.PI/2]}>
      <mesh position={[0,.35,0]} castShadow><cylinderGeometry args={[.045,.06,.75,12]}/><meshStandardMaterial color="#64412a" roughness={.82}/></mesh>
      <RoundedBox args={[.42,.22,.23]} position={[0,.73,0]} radius={.035} smoothness={3} castShadow><meshStandardMaterial color="#677371" metalness={.9} roughness={.4}/></RoundedBox>
      {Array.from({length:8},(_,i)=><mesh key={i} position={[0,i*.03+.08,0]}><torusGeometry args={[.06,.009,5,16]}/><meshStandardMaterial color="#392d25" roughness={.9}/></mesh>)}
    </group>
    <group position={[1.5,-.81,.45]} rotation={[0,.7,0]}>{[-.12,.12].map(x=><group key={x}><RoundedBox args={[.035,.025,.65]} position={[x,0,0]} radius={.008} smoothness={2}><meshStandardMaterial color="#b09864" metalness={.8} roughness={.4}/></RoundedBox><mesh position={[x>0?.07:-.07,0,-.3]}><boxGeometry args={[.13,.025,.03]}/><meshStandardMaterial color="#c4b080" metalness={.8} roughness={.35}/></mesh></group>)}</group>
    <group position={[-1.65,-.7,-1]} rotation={[0,.35,0]}><mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[.7,.5]}/><meshStandardMaterial color="#c5b68e" roughness={1}/></mesh><mesh rotation={[-Math.PI/2,0,.4]} position={[0,.002,0]}><ringGeometry args={[.13,.135,32]}/><meshBasicMaterial color="#877a59"/></mesh></group>
    <group position={[1.6,-.45,-1.05]}>
      <mesh castShadow><cylinderGeometry args={[.16,.2,.65,8]}/><meshPhysicalMaterial color="#879e84" transparent opacity={.3} roughness={.2} metalness={.1}/></mesh>
      <mesh position={[0,-.1,0]}><cylinderGeometry args={[.14,.17,.38,8]}/><meshStandardMaterial color="#789e91" emissive="#497b71" emissiveIntensity={.3}/></mesh>
      <mesh position={[0,.35,0]}><cylinderGeometry args={[.11,.12,.13,8]}/><meshStandardMaterial color="#695038" roughness={1}/></mesh>
    </group>
    <mesh position={[0,-1.6,-3]} receiveShadow><boxGeometry args={[12,5,.2]}/><meshStandardMaterial color="#262c29" roughness={1}/></mesh>
    <mesh position={[-2,0,-2.8]}><boxGeometry args={[.22,4,.12]}/><meshStandardMaterial color="#3d3024" roughness={1}/></mesh>
    <mesh position={[2.8,0,-2.8]}><boxGeometry args={[.22,4,.12]}/><meshStandardMaterial color="#3d3024" roughness={1}/></mesh>
    <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[dust,3]}/></bufferGeometry><pointsMaterial color="#bca67b" size={.008} transparent opacity={.3} depthWrite={false}/></points>
  </group>;
}
export function MaterialViewer({id,rotate}:{id:MaterialId;rotate:boolean}) {
  return <Canvas shadows dpr={[1,1.5]} camera={{position:[2.3,1.75,3.4],fov:39}} gl={{antialias:true,alpha:false}}>
    <color attach="background" args={['#17201e']}/><fog attach="fog" args={['#17201e',5,13]}/><Lighting/>
    <ambientLight intensity={.35}/><spotLight position={[-2.5,4,1.5]} angle={.65} penumbra={.8} intensity={75} color="#ffe0a6" castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.0003}/><directionalLight position={[2,2,-1]} intensity={2} color="#9bc8cb"/><pointLight position={[-3,.5,-1]} intensity={8} color="#e79542"/>
    <Workshop id={id}/><OrbitControls key={id} autoRotate={rotate} autoRotateSpeed={.35} enablePan={false} minDistance={2.6} maxDistance={5.5} minPolarAngle={.55} maxPolarAngle={1.32} minAzimuthAngle={-.85} maxAzimuthAngle={.85} target={[0,-.15,0]}/>
  </Canvas>;
}
