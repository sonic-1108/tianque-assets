import type * as THREE from 'three';

/**
 * 梵音's gilded body. Brightens only the gold skin: gold texels are orange/yellow
 * (g/r high) while the robe is maroon (g/r tiny), so a hue ratio mask keeps the
 * cloth dark and pushes the skin toward polished temple gold.
 */
export function applyMonkGold(m: THREE.MeshStandardMaterial, isPlayer: boolean, boost = 1) {
  const tint = isPlayer ? '1.0' : '0.0';
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float tqR = max(diffuseColor.r, 1e-4);
        float tqSkin = smoothstep(0.16, 0.34, diffuseColor.g / tqR) * step(diffuseColor.b, diffuseColor.g * 1.05) * smoothstep(0.015, 0.06, diffuseColor.r);
        vec3 tqGold = min(diffuseColor.rgb * ${(1.85 * boost).toFixed(2)} + vec3(0.04, 0.025, 0.0), vec3(1.0));
        tqGold = mix(tqGold, vec3(1.0, 0.72, 0.26) * max(tqGold.r, 0.5), 0.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, tqGold, tqSkin);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.42), tqSkin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, max(metalnessFactor, 0.55), tqSkin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += tqSkin * vec3(0.13, 0.08, 0.015) * (0.6 + 0.4 * ${tint});`);
  };
  m.customProgramCacheKey = () => 'tq-monk-gold-' + tint + boost;
  m.needsUpdate = true;
}
