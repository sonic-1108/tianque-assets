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

export function applyCharacterShading(m: THREE.MeshStandardMaterial, isPlayer: boolean, monkGold: boolean, cut?: { value: number }, suit = false, hemp = false) {
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
    if (hemp) {
      // 散人's first look: skin and hair kept, every dyed cloth becomes undyed hemp (light) and faded grey cotton (dark)
      f = f.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 tqC = diffuseColor.rgb;
          float tqR = max(tqC.r, 1e-4);
          float tqGR = tqC.g / tqR;
          float tqBG = tqC.b / max(tqC.g, 1e-4);
          float tqLum0 = dot(tqC, vec3(0.3, 0.59, 0.11));
          // lips are redder than the rest of the face: a lower green/red edge, but only where it's bright enough not to be the dark red robe
          float tqSkin = max(smoothstep(0.15, 0.26, tqGR), smoothstep(0.07, 0.13, tqGR) * smoothstep(0.14, 0.22, tqLum0)) * (1.0 - smoothstep(0.9, 1.0, tqGR)) * smoothstep(0.35, 0.5, tqBG) * (1.0 - smoothstep(0.95, 1.1, tqBG)) * smoothstep(0.06, 0.14, tqC.r);
          float tqL = dot(tqC, vec3(0.3, 0.59, 0.11));
          float tqHair = (1.0 - smoothstep(0.03, 0.06, tqL)) * (1.0 - smoothstep(1.6, 2.4, tqR / max(tqC.g, 1e-4)));
          vec3 tqCloth = mix(vec3(0.16, 0.17, 0.18), vec3(0.47, 0.42, 0.33), smoothstep(0.08, 0.3, tqL)) * (0.7 + tqL * 1.2);
          diffuseColor.rgb = mix(tqCloth, tqC, max(tqSkin, tqHair));
        }`);
    }
    if (suit) {
      // 交易员's stand-in: everything but skin and hair becomes a navy suit (the texture's detail kept as shading)
      f = f.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 tqC = diffuseColor.rgb;
          float tqR = max(tqC.r, 1e-4);
          float tqGR = tqC.g / tqR;
          float tqBG = tqC.b / max(tqC.g, 1e-4);
          float tqSkin = smoothstep(0.15, 0.26, tqGR) * (1.0 - smoothstep(0.9, 1.0, tqGR)) * smoothstep(0.35, 0.5, tqBG) * (1.0 - smoothstep(0.95, 1.1, tqBG)) * smoothstep(0.06, 0.14, tqC.r);
          float tqL = dot(tqC, vec3(0.3, 0.59, 0.11));
          float tqHair = (1.0 - smoothstep(0.03, 0.06, tqL)) * (1.0 - smoothstep(1.6, 2.4, tqR / max(tqC.g, 1e-4)));
          vec3 tqSuit = vec3(0.05, 0.07, 0.13) * (0.75 + tqL * 1.6);
          diffuseColor.rgb = mix(tqSuit, tqC, max(tqSkin, tqHair));
        }`);
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
  m.customProgramCacheKey = () => 'tq-char-' + (isPlayer ? 'p' : 'e') + (monkGold ? 'g' : '') + (suit ? 's' : '') + (hemp ? 'h' : '');
  m.needsUpdate = true;
}
