import * as THREE from 'three';
import type { MapId } from './maps';

/**
 * Image-based light made from each map's own sky, instead of a neutral studio:
 * metal, lacquer, wet tiles and snow pick up the colours that are actually around them.
 */
export interface SkyEnv {
  zenith: string;
  horizon: string;
  /** colour coming up from below: lava, snow, cloud sea, lantern-lit streets */
  ground: string;
  sunDir: [number, number, number];
  sun: string;
  /** brightness of the sun spot in the environment (it is what makes highlights) */
  sunPower: number;
  intensity: number;
}

export const SKY_ENV: Record<MapId, SkyEnv> = {
  experimental: { zenith:'#567e86',horizon:'#ded5b6',ground:'#686e52',sunDir:[-.4,.65,.5],sun:'#ffe0a5',sunPower:8,intensity:.55 },
  quarry: { zenith: '#5d8e9c', horizon: '#d9ddbd', ground: '#8e9270', sunDir: [-.4,.65,.5], sun: '#ffe0a5', sunPower: 8, intensity: .55 },
  temple: { zenith: '#3d5f8f', horizon: '#f2b27a', ground: '#8a6656', sunDir: [0.35, 0.16, -1], sun: '#ffcf8a', sunPower: 14, intensity: 0.75 },
  lavacliff: { zenith: '#1d0907', horizon: '#9a3412', ground: '#ff5a14', sunDir: [-0.5, 0.3, -0.8], sun: '#ff7a2a', sunPower: 6, intensity: 0.7 },
  sea: { zenith: '#070b11', horizon: '#2a3a48', ground: '#0b1820', sunDir: [0.2, 0.5, -1], sun: '#9fb8d8', sunPower: 3, intensity: 0.45 },
  glacier: { zenith: '#56739c', horizon: '#e6e2dc', ground: '#e9eff6', sunDir: [-0.55, 0.32, -0.77], sun: '#ffe6c8', sunPower: 12, intensity: 0.7 },
  bamboo: { zenith: '#0d1420', horizon: '#33435a', ground: '#cfd8e3', sunDir: [0, 1, 0], sun: '#cfe0ff', sunPower: 2, intensity: 0.6 },
  rooftop: { zenith: '#070a18', horizon: '#4a2216', ground: '#c2541c', sunDir: [-0.45, 0.42, -0.78], sun: '#d6dcff', sunPower: 5, intensity: 0.55 },
  forest: { zenith: '#6f8fa8', horizon: '#c9d6a8', ground: '#3d4a2a', sunDir: [0.47, 0.8, 0.35], sun: '#ffe2a8', sunPower: 6, intensity: 0.55 },
  desert: { zenith: '#5d86b8', horizon: '#f2cf9a', ground: '#c99a62', sunDir: [-0.62, 0.3, 0.5], sun: '#ffd9a0', sunPower: 12, intensity: 0.7 },
  losangeles: { zenith: '#2f6fc4', horizon: '#d9d2c0', ground: '#7a7458', sunDir: [-0.55, 0.62, 0.56], sun: '#fff0d8', sunPower: 12, intensity: 0.7 },
  coast: { zenith: '#3d6aa8', horizon: '#ffc58a', ground: '#a88a5a', sunDir: [-0.93, 0.16, 0.33], sun: '#ffb070', sunPower: 14, intensity: 0.6 },
  wending: { zenith: '#5d86b8', horizon: '#efe4cc', ground: '#8a8f5a', sunDir: [0.5, 0.45, 0.7], sun: '#fff0cc', sunPower: 12, intensity: 0.62 },
  plankway: { zenith: '#4a6fa6', horizon: '#e9dcc8', ground: '#d8dde6', sunDir: [0.55, 0.35, 0.75], sun: '#ffe2b0', sunPower: 11, intensity: 0.6 },
  summit: { zenith: '#2f5fae', horizon: '#f0cf9c', ground: '#e9e2d6', sunDir: [0.5, 0.14, -1], sun: '#ffcf8a', sunPower: 12, intensity: 0.45 },
};

export function makeSkyEnvironment(gl: THREE.WebGLRenderer, cfg: SkyEnv) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZ: { value: new THREE.Color(cfg.zenith) },
      uH: { value: new THREE.Color(cfg.horizon) },
      uG: { value: new THREE.Color(cfg.ground) },
      uS: { value: new THREE.Color(cfg.sun) },
      uD: { value: new THREE.Vector3(...cfg.sunDir).normalize() },
      uP: { value: cfg.sunPower },
    },
    vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZ, uH, uG, uS, uD; uniform float uP; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uH, uZ, pow(h, 0.6)) : mix(uH, uG, pow(min(1.0, -h * 3.0), 0.7));
        float s = max(dot(d, uD), 0.0);
        col += uS * (pow(s, 600.0) * uP + pow(s, 24.0) * 0.6 + pow(s, 4.0) * 0.15);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
