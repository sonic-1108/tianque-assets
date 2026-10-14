import type * as THREE from 'three';

/**
 * Character look, applied per material:
 *  - a soft fill that comes from the viewer, so a face turned toward the camera is never in black shadow
 *  - a fresnel rim (warm for the player, cool blue for the opponent) so the two read apart without
 *    darkening the opponent's textures
 *  - 梵音 only: brighten the gold skin (gold texels are orange/yellow, the robe is maroon, so a g/r
 *    ratio mask keeps the cloth dark)
 */
/** 0 normal .. 1 pitch-black night: dims the viewer-side fill and rim so characters vanish into the dark */
export const TQ_DARK = { value: 0 };

export function applyCharacterShading(m: THREE.MeshStandardMaterial, isPlayer: boolean, monkGold: boolean, cut?: { value: number }) {
  const rim = isPlayer ? 'vec3(1.0, 0.82, 0.55) * 0.22' : 'vec3(0.45, 0.68, 1.0) * 0.28';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tqDark = TQ_DARK;
    // 飞虫沙暴: everything above world height tqCut is gone (eaten from the head down), with a glowing ragged edge
    sh.uniforms.tqCut = cut ?? { value: 99 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float tqWY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\ntqWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    let f = sh.fragmentShader.replace('void main() {', 'uniform float tqDark;\nuniform float tqCut;\nvarying float tqWY;\nvoid main() {');
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float tqGrain = fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233))) * 43758.5453);
      float tqEdge = tqCut + (tqGrain - 0.5) * 0.16 - tqWY;
      if (tqEdge < 0.0) discard;`);
    if (monkGold) {
      f = f
        .replace('#include <map_fragment>', `#include <map_fragment>
        float tqR = max(diffuseColor.r, 1e-4);
        float tqSkin = smoothstep(0.16, 0.34, diffuseColor.g / tqR) * step(diffuseColor.b, diffuseColor.g * 1.05) * smoothstep(0.015, 0.06, diffuseColor.r);
        vec3 tqGold = min(diffuseColor.rgb * 1.85 + vec3(0.04, 0.025, 0.0), vec3(1.0));
        tqGold = mix(tqGold, vec3(1.0, 0.72, 0.26) * max(tqGold.r, 0.5), 0.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, tqGold, tqSkin);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.42), tqSkin);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, max(metalnessFactor, 0.55), tqSkin);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += tqSkin * vec3(0.13, 0.08, 0.015) * ${isPlayer ? '1.0' : '0.6'} * (1.0 - tqDark);`);
    }
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.9, 0.55, 0.2) * (1.0 - smoothstep(0.0, 0.07, tqEdge)) * step(tqCut, 50.0) * 1.5;`);
    f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      {
        vec3 tqV = normalize(vViewPosition);
        float tqFace = clamp(dot(normal, tqV), 0.0, 1.0);
        // viewer-side fill: lifts the shadowed side of whatever faces the camera
        reflectedLight.indirectDiffuse += diffuseColor.rgb * (0.12 + 0.38 * tqFace) * (1.0 - tqDark);
        float tqRim = pow(1.0 - tqFace, 4.0);
        reflectedLight.directSpecular += ${rim} * tqRim * (1.0 - tqDark);
      }`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'tq-char-' + (isPlayer ? 'p' : 'e') + (monkGold ? 'g' : '');
  m.needsUpdate = true;
}
