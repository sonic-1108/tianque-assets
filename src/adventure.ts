/** The first offline expedition. Never shares a key with wallet/competitive saves. */
export const ADVENTURE_KEY = 'tq_adventure_v1';
export type Point = [number, number, number];
export type AdventureState = {
  active: boolean; iron: number; collected: boolean;
  drop: Point | null; defeated: boolean; error: string;
};
export function createAdventure(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let state: AdventureState = { active: false, iron: 0, collected: false, drop: null, defeated: false, error: '' };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AdventureState>) => {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn());
  };
  function read() {
    try {
      const raw = storage.getItem(ADVENTURE_KEY);
      if (raw === null) return update({ iron: 0, error: '' });
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Number.isSafeInteger(data.iron) || data.iron < 0) throw new Error();
      update({ iron: data.iron, error: '' });
    } catch { update({ error: '材料存档暂时无法读取，原存档未覆盖。请检查浏览器存储后重试。' }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    read,
    start() { read(); update({ active: true, collected: false, drop: null, defeated: false }); },
    stop() { update({ active: false, drop: null }); },
    reset() { update({ collected: false, drop: null, defeated: false }); },
    defeatEnemy(at: Point) {
      if (!state.active || state.defeated) return;
      update({ defeated: true, drop: [...at] });
    },
    collect(at: Point, alive: boolean) {
      const d = state.drop;
      if (!state.active || !alive || !d || state.error || Math.hypot(at[0]-d[0], at[2]-d[2]) > 2.5 || Math.abs(at[1]-d[1]) > 2.5) return false;
      try {
        // Read again so another tab's already-saved materials aren't silently replaced.
        const raw = storage.getItem(ADVENTURE_KEY);
        const saved = raw === null ? { version: 1, iron: 0 } : JSON.parse(raw);
        if (saved?.version !== 1 || !Number.isSafeInteger(saved.iron) || saved.iron < 0 || saved.iron >= Number.MAX_SAFE_INTEGER) throw new Error();
        const iron = saved.iron + 1;
        storage.setItem(ADVENTURE_KEY, JSON.stringify({ version: 1, iron }));
        update({ iron, drop: null, collected: true });
        return true;
      } catch {
        update({ error: '拾取未保存，材料仍在原地。请允许浏览器存储后重试。' });
        return false;
      }
    },
  };
}
export const adventure = createAdventure({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
