// 地图预览: one map, a fixed camera from the URL, the game's own post chain. For looking at scenery.
//   preview.html?map=coast&cam=x,y,z&look=x,y,z&fov=55&t=0
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping, wrapEffect } from '@react-three/postprocessing';
import { Effect } from 'postprocessing';
import { SKY_ENV, makeSkyEnvironment } from '../envSky';
import { Maps3D } from '../components/Maps3D';
import { MAPS, MapId, terrainHeight } from '../maps';

class SafeGradeEffect extends Effect {
  constructor() {
    super('SafeGrade', `void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      c = max((c - 0.22) * 1.1 + 0.22, 0.0);
      outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
    }`);
  }
}
const SafeGrade = wrapEffect(SafeGradeEffect);
const q = new URLSearchParams(location.search);
const id = (q.get('map') || 'coast') as MapId;
const v3 = (s: string | null, d: string) => (s || d).split(',').map(Number) as [number, number, number];
const cam = v3(q.get('cam'), '30,6,30');
const look = v3(q.get('look'), '-40,0,0');
const m = MAPS[id];

function Setup() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const sky = SKY_ENV[id];
    scene.environment = makeSkyEnvironment(gl, sky);
    (scene as any).environmentIntensity = m.env ?? sky.intensity;
    scene.background = new THREE.Color(m.background);
    scene.fog = new THREE.Fog(m.background, m.fog[0], m.fog[1]);
    gl.toneMappingExposure = m.exposure;
    camera.position.set(...cam);
    camera.lookAt(...look);
    (camera as THREE.PerspectiveCamera).fov = parseFloat(q.get('fov') || '55');
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, []);
  // report what got drawn (and keep the frame count for screenshots)
  useFrame(() => {
    const el = document.getElementById('i');
    (window as any).__frames = ((window as any).__frames ?? 0) + 1;
    if (el && (window as any).__frames % 30 === 0) el.textContent = `${id} · calls ${gl.info.render.calls} · tris ${(gl.info.render.triangles / 1000).toFixed(0)}k · ${q.get('note') || ''}`;
  });
  return null;
}
function Key() {
  const ref = React.useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const L = ref.current;
    if (!L) return;
    const [sx, sy, sz] = m.sunDir ?? [8, 14, 6];
    const n = Math.hypot(sx, sy, sz);
    const [lx, , lz] = look;
    const ly = terrainHeight(id, lx, lz);
    L.position.set(lx + (sx / n) * 30, ly + Math.max(4, (sy / n) * 30), lz + (sz / n) * 30);
    L.target.position.set(lx, ly, lz);
    L.target.updateMatrixWorld();
  }, []);
  return <directionalLight ref={ref} color={m.keyColor} intensity={m.keyIntensity} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} shadow-camera-far={90} />;
}
createRoot(document.getElementById('r')!).render(
  <Canvas shadows camera={{ fov: 55, near: 0.1, far: 1200 }} gl={{ antialias: false }} dpr={[1, 1.5]}>
    <Setup />
    <hemisphereLight args={[m.hemi[0], m.hemi[1], m.hemi[2]]} />
    <Key />
    <Maps3D mapId={id} />
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={m.bloom ?? 0.9} luminanceThreshold={0.95} luminanceSmoothing={0.2} />
      <Vignette offset={0.3} darkness={0.55} />
      <ToneMapping mode={6 as any} />
      <SafeGrade />
    </EffectComposer>
  </Canvas>
);
