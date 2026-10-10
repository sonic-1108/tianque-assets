import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export function Arenas3D({ radius = 22, showObelisks = true }: { radius?: number; showObelisks?: boolean }) {
  const ambientCloudsRef = useRef<THREE.Group>(null);

  // Procedural stone arena ground canvas texture
  const floorTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Weathered sandstone base with per-tile variation
      ctx.fillStyle = '#6f665c';
      ctx.fillRect(0, 0, 1024, 1024);
      for (let tx = 0; tx < 8; tx++) {
        for (let ty = 0; ty < 8; ty++) {
          const l = 36 + Math.random() * 10;
          ctx.fillStyle = `hsl(30, ${8 + Math.random() * 6}%, ${l}%)`;
          ctx.fillRect(tx * 128, ty * 128, 128, 128);
          for (let k = 0; k < 60; k++) {
            ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,240,220'},${Math.random() * 0.06})`;
            const r = Math.random() * 18 + 2;
            ctx.beginPath();
            ctx.arc(tx * 128 + Math.random() * 128, ty * 128 + Math.random() * 128, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Arena tile grid
      ctx.strokeStyle = 'rgba(30,22,16,0.85)';
      ctx.lineWidth = 5;
      for (let i = 0; i < 1024; i += 128) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 1024);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(1024, i);
        ctx.stroke();
      }

      // Tian Que Celestial Ring Emblems
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(512, 512, 420, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(512, 512, 280, 0, Math.PI * 2);
      ctx.stroke();

      // Tai Chi / Bagua center circle
      ctx.fillStyle = 'rgba(40,30,22,0.35)';
      ctx.beginPath();
      ctx.arc(512, 512, 140, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);

  useFrame((_, delta) => {
    if (ambientCloudsRef.current) {
      ambientCloudsRef.current.rotation.y += delta * 0.02;
    }
  });

  return (
    <group>
      {/* 
        ARENA FLOOR (XZ PLANE with Y=0 surface):
        Top face is placed directly at Y = 0.
      */}
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <cylinderGeometry args={[radius + 1.2, radius + 1.2, 0.5, 64]} />
        <meshStandardMaterial
          map={floorTexture}
          roughness={0.88}
          metalness={0.0}
        />
      </mesh>

      {/* Arena Outer Golden Perimeter Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius + 0.8, 0.25, 12, 64]} />
        <meshStandardMaterial
          color="#d97706"
          emissive="#f59e0b"
          emissiveIntensity={0.35}
          roughness={0.3}
          metalness={0.8}
        />
      </mesh>

      {/* Floating Celestial Dust & Cloud Particles */}
      <group ref={ambientCloudsRef} visible={showObelisks}>
        {[-3, -2, -1, 0, 1, 2, 3].map((idx) => {
          const angle = (idx / 7) * Math.PI * 2;
          const x = Math.sin(angle) * (radius + 9);
          const z = Math.cos(angle) * (radius + 9);
          return (
            <group key={idx} position={[x, 0, z]}>
              {/* Training Arena Guardian Obelisk (Outer Boundary) */}
              <mesh castShadow receiveShadow position={[0, 4.5, 0]}>
                <boxGeometry args={[1.6, 9.0, 1.6]} />
                <meshStandardMaterial color="#4a443e" roughness={0.9} />
              </mesh>
              {/* Golden Crest */}
              <mesh position={[0, 9.4, 0]}>
                <octahedronGeometry args={[0.9, 0]} />
                <meshStandardMaterial color="#f59e0b" emissive="#fbbf24" emissiveIntensity={3.0} toneMapped={false} />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}
