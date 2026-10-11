import { useEffect, useState } from 'react';

/** Player settings, kept in localStorage */
export type Quality = 'high' | 'medium' | 'low';
export interface Settings {
  quality: Quality;
  /** 0..1 */
  sfx: number;
  music: number;
  amb: number;
  /** camera sensitivity multiplier, 0.4..2 */
  sens: number;
}
const KEY = 'tq_settings';
const DEFAULTS: Settings = { quality: 'high', sfx: 0.9, music: 0.8, amb: 0.8, sens: 1 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* private mode or bad data */
  }
  return { ...DEFAULTS };
}

let cur: Settings = load();
const subs = new Set<() => void>();

export function getSettings() {
  return cur;
}
export function setSettings(p: Partial<Settings>) {
  cur = { ...cur, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}
export function onSettings(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
export function useSettings() {
  const [, bump] = useState(0);
  useEffect(() => onSettings(() => bump((x) => x + 1)), []);
  return cur;
}

/** renderer settings per quality level */
export const QUALITY = {
  high: { dpr: [1, 2] as [number, number], shadows: true, shadowSize: 2048, bloom: true },
  medium: { dpr: [1, 1.5] as [number, number], shadows: true, shadowSize: 1024, bloom: true },
  low: { dpr: [0.75, 1] as [number, number], shadows: false, shadowSize: 512, bloom: false },
};
