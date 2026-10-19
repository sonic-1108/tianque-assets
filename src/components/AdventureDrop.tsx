import React, { useSyncExternalStore } from 'react';
import { MaterialModel } from './materials/MaterialModel';
import { materialById } from '../materials';
import { adventure } from '../adventure';

export function AdventureDrop() {
  const state = useSyncExternalStore(adventure.subscribe, adventure.getSnapshot);
  if (!state.active || !state.drop) return null;
  const [x, y, z] = state.drop;
  const material = materialById(state.runTarget);
  return <group position={[x, y + .6, z]}>
    <group scale={.65}><MaterialModel id={material.id}/></group>
    <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[.09, .09, 2.4, 8]} /><meshBasicMaterial color={material.color} transparent opacity={.65} /></mesh>
  </group>;
}
