export const MATERIAL_IDS = ['iron', 'copper', 'frost', 'echo', 'gravity', 'silk'];
export const RECIPES = [
  { id: 'storm', name: '鸣雷刃芯', slot: '刃部', costs: { iron: 3, copper: 2 }, effect: '每第 3 次未被格挡的近战命中，造成额外 35% 伤害。', trigger: '连续命中 · 雷电释放', color: '#efa95f' },
  { id: 'echo', name: '沉岳回响核', slot: '核心', costs: { gravity: 2, echo: 2 }, effect: '重击伤害提高 25%，击退距离提高 20%。', trigger: '重击命中 · 冲击共振', color: '#b4a2ff' },
  { id: 'frost', name: '霜息缠柄', slot: '柄部', costs: { frost: 2, silk: 2 }, effect: '极限闪避或完美格挡后，在反击窗口内近战命中，恢复 5% 最大生命。', trigger: '精准反击 · 生命回流', color: '#8edfdc' },
];
export function parseMaterialSave(raw) {
  const s = raw === null ? {version:1,iron:0} : JSON.parse(raw);
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (!s || ![1,2].includes(s.version) || !count(s.iron)) throw Error('材料存档格式不支持');
  if (s.version === 2 && (!s.materials || typeof s.materials !== 'object' || Array.isArray(s.materials) || Object.keys(s.materials).some(k => !MATERIAL_IDS.includes(k) || k === 'iron' || !count(s.materials[k])) || !Array.isArray(s.crafted) || s.crafted.some(id => !RECIPES.some(r => r.id === id)) || new Set(s.crafted).size !== s.crafted.length || (s.equipped !== null && !s.crafted.includes(s.equipped)) || !MATERIAL_IDS.includes(s.target))) throw Error('材料存档损坏');
  return { version:2, iron:s.iron, materials: s.version === 2 ? {...s.materials} : {}, crafted: s.version === 2 ? [...s.crafted] : [], equipped: s.version === 2 ? s.equipped : null, target: s.version === 2 ? s.target : 'copper' };
}
export function materialCount(s, id) { return id === 'iron' ? s.iron : s.materials[id] || 0; }
/** Pure combat calculation. Caller only applies this to successful melee hits in offline expeditions. */
export function materialReaction(id, hit, heavy, counter) {
  return { multiplier: id === 'storm' && hit % 3 === 0 ? 1.35 : id === 'echo' && heavy ? 1.25 : 1, knock: id === 'echo' && heavy ? 1.2 : 1, heal: id === 'frost' && counter ? .05 : 0 };
}
