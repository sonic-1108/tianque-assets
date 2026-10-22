// 角色预览: one hero on a plain stage, for checking models and poses (no game logic).
//   rig-preview.html?cls=Trader&pose=glide&t=3&cam=0,1.6,3.2&look=0,1.4,0&fov=40&yaw=0
//   pose: idle | run | jump | glide   t: seconds into the pose (glide lift finishes after ~0.6 s)
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { CharacterRig3D } from '../components/CharacterRig3D';
import { TRADER } from '../trader';
import { CharacterClassId } from '../types';
import { setLook } from '../wanderer';

const q = new URLSearchParams(location.search);
const cls = (q.get('cls') || 'Trader') as CharacterClassId;
const pose = q.get('pose') || 'idle';
const T = parseFloat(q.get('t') || '2');
const v3 = (s: string | null, d: string) => (s || d).split(',').map(Number) as [number, number, number];
const cam = v3(q.get('cam'), '0,1.5,3.4');
const look = v3(q.get('look'), '0,1.2,0');
const yaw = parseFloat(q.get('yaw') || '0');
if (q.get('undress')) (globalThis as any).__TQ_UNDRESS = true;
if (q.get('sex')) setLook(q.get('sex') === 'f' ? 'f' : 'm');
if (q.get('alpha')) for (const el of [document.documentElement, document.body, document.getElementById('r')!]) el.style.background = 'transparent';

function makeFighter(): any {
  return {
    id: 'p', isPlayer: true, classId: cls, team: 0, hp: 1000, maxHp: 1000, mp: 100, maxMp: 100,
    pos: [0, 0, 0], vel: [0, 0, 0], rotY: yaw, isGrounded: pose !== 'glide' && pose !== 'jump',
    actionState: pose === 'run' ? 'run' : pose === 'jump' ? 'jump' : 'idle', stateTimer: 0, stateDuration: 1,
    hitStopTimer: 0, whiteFlashTimer: 0, buffs: [], cooldowns: {}, localMove: [0, pose === 'run' ? 1 : 0],
    glide: pose === 'glide' ? TRADER.glide.t : 0,
  };
}

function Stage() {
  const { camera, gl, scene } = useThree();
  (globalThis as any).__TQ_SCENE = scene;
  const ref = useRef<any>(makeFighter());
  const grp = useRef<THREE.Group>(null);
  const t0 = useRef(performance.now());
  useEffect(() => {
    camera.position.set(...cam);
    camera.lookAt(...look);
    (camera as THREE.PerspectiveCamera).fov = parseFloat(q.get('fov') || '40');
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    gl.toneMapping = THREE.ACESFilmicToneMapping;
  }, []);
  useFrame(() => {
    const el = (performance.now() - t0.current) / 1000;
    const c = ref.current;
    // drive the clock to the requested moment, then hold it (screenshots wait for __ready)
    const t = Math.min(el, T);
    c.stateTimer = t;
    if (pose === 'glide') c.glide = Math.max(0.01, TRADER.glide.t - t);
    if (pose === 'run') c.vel = [0, 0, -6];
    (window as any).__ready = el > T + 0.6;
    if (grp.current) grp.current.rotation.y = c.rotY;
  });
  return (
    <group ref={grp}>
      <CharacterRig3D classId={cls} combatantRef={ref} isPlayer />
    </group>
  );
}

createRoot(document.getElementById('r')!).render(
  <Canvas shadows dpr={1} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: !!q.get('alpha') }}>
    {!q.get('alpha') && <color attach="background" args={[q.get('bg') || '#262b35']} />}
    <hemisphereLight args={['#e8eefc', '#3a3026', 1.1]} />
    <directionalLight position={[2.5, 5, 4]} intensity={2.6} castShadow />
    <directionalLight position={[-3, 2, -2]} intensity={0.8} color="#9fb6ff" />
    <mesh rotation-x={-Math.PI / 2} receiveShadow visible={!q.get('alpha') && !q.get('nofloor')}>
      <circleGeometry args={[4, 48]} />
      <meshStandardMaterial color="#4a4f5a" />
    </mesh>
    <Stage />
  </Canvas>,
);
