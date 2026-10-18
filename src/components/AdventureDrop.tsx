import React, { useSyncExternalStore } from 'react';
import { adventure } from '../adventure';

export function AdventureDrop() {
  const state = useSyncExternalStore(adventure.subscribe, adventure.getSnapshot);
  if (!state.active || !state.drop) return null;
  const [x, y, z] = state.drop;
  return <group position={[x, y + .6, z]}>
    <mesh rotation={[0, Math.PI / 4, 0]}><octahedronGeometry args={[.4]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.5} /></mesh>
    <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[.09, .09, 2.4, 8]} /><meshBasicMaterial color="#fde68a" transparent opacity={.65} /></mesh>
  </group>;
}
