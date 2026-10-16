import { useEffect, useState } from 'react';

/** Player settings, kept in localStorage */
export type Quality = 'high' | 'medium' | 'low';
/** how hard the AI opponents fight */
export type AiLevel = 'easy' | 'normal' | 'hard' | 'hell';
export interface Settings {
  quality: Quality;
  /** 0..1 */
  sfx: number;
  music: number;
  amb: number;
  /** camera sensitivity multiplier, 0.4..2 */
  sens: number;
  /** AI opponents: 简单 / 中等 / 困难 / 地狱 */
  aiLevel: AiLevel;
  /** the player chose the quality themselves (in 设置); otherwise it is the default, high */
  qualityPicked?: boolean;
}
const KEY = 'tq_settings';
const DEFAULTS: Settings = { quality: 'high', sfx: 0.9, music: 0.8, amb: 0.8, sens: 1, aiLevel: 'normal' };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
      // the automatic frame-rate guard used to save a lower quality for good (a few shader-compile hitches were
      // enough to land on "low": 0.75x resolution, no anti-aliasing, no shadows). Only a quality the player
      // picked is kept now.
      if (!s.qualityPicked) s.quality = 'high';
      return s;
    }
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

/**
 * AI difficulty. think: how often it decides (x normal); react: chance it reacts to an incoming swing (block,
 * dodge, counter); out / in: damage it deals / takes (enemy AI only, never online).
 */
export const AI_LEVELS: Record<AiLevel, { name: string; think: number; react: number; out: number; in: number }> = {
  easy: { name: '简单', think: 0.55, react: 0.3, out: 0.65, in: 1.3 },
  normal: { name: '中等', think: 1, react: 0.75, out: 1, in: 1 },
  hard: { name: '困难', think: 1.45, react: 0.92, out: 1.15, in: 0.88 },
  hell: { name: '地狱', think: 2.1, react: 1, out: 1.4, in: 0.72 },
};
