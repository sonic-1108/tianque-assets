import React,{useMemo,useEffect} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RoomEnvironment} from 'three-stdlib';
import {OrbitControls,ContactShadows,RoundedBox} from '@react-three/drei';
import {buildForgedBlade,disposeWeapon,type WeaponDesign} from './weaponModel';
function ForgeLighting(){const {gl,scene}=useThree();useEffect(()=>{const pm=new THREE.PMREMGenerator(gl),room=new (RoomEnvironment as any)(),env=pm.fromScene(room,.04);scene.environment=env.texture;return()=>{scene.environment=null;env.dispose();room.dispose();pm.dispose()}},[gl,scene]);return null;}
export function ForgedWeapon({design,...props}:{design:WeaponDesign;[k:string]:any}){const w=useMemo(()=>buildForgedBlade(design),[design.blade,design.grip,design.core,JSON.stringify(design.appearance)]);useEffect(()=>()=>{disposeWeapon(w.group);w.fullerMat.dispose()},[w]);return <primitive object={w.group} {...props}/>}
export function WeaponViewer({design}:{design:WeaponDesign}){return <Canvas shadows camera={{position:[2.8,1.8,3.6],fov:34}} dpr={[1,1.5]}>
 <ForgeLighting/><color attach="background" args={['#151c20']}/><ambientLight intensity={1}/><directionalLight position={[0,2,5]} intensity={3} color="#e2edff"/><spotLight position={[1,4,3]} intensity={100} angle={.6} penumbra={1} color="#ffdfb0" castShadow/><directionalLight position={[-3,2,-2]} color="#b1d9e7" intensity={3}/>
 <group position={[0,.12,0]} rotation={[0,0,-.24]}><ForgedWeapon design={design} position={[0,-.55,0]}/></group>
 <RoundedBox args={[2.6,.16,1.7]} radius={.04} position={[0,-.95,0]} receiveShadow><meshStandardMaterial color="#353a3c" metalness={.65} roughness={.55}/></RoundedBox>
 {[-.8,.8].map(x=><mesh key={x} position={[x,-.84,0]}><boxGeometry args={[.035,.025,1.4]}/><meshStandardMaterial color="#aa8350" metalness={.85} roughness={.3}/></mesh>)}
 <ContactShadows position={[0,-.86,0]} opacity={.55} scale={5} blur={2.5} far={3}/>
 <OrbitControls enablePan={false} minDistance={2.1} maxDistance={6} target={[0,.1,0]} minPolarAngle={.2} maxPolarAngle={Math.PI*.8}/>
 </Canvas>}
