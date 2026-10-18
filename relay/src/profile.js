export const SAVE_KEYS = ['tq_wallet', 'tq_ib', 'tq_adventure_v1', 'tq_ib_story'];
export function validSnapshot(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 64000) return false;
  if (Object.keys(data).some(k => !SAVE_KEYS.includes(k))) return false;
  for (const key of SAVE_KEYS) {
    const raw = data[key];
    if (raw === null) continue;
    if (typeof raw !== 'string') return false;
    let value; try { value = JSON.parse(raw); } catch { return false; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const nonneg = n => Number.isSafeInteger(n) && n >= 0;
    if (key === 'tq_wallet' && (!nonneg(value.cash) || !value.watches || typeof value.watches !== 'object' || Object.values(value.watches).some(n => !nonneg(n)))) return false;
    if (key === 'tq_adventure_v1' && (value.version !== 1 || !nonneg(value.iron))) return false;
    if (key === 'tq_ib') {
      if (!nonneg(value.step) || value.step > 6 || !nonneg(value.deals)) return false;
      const d = value.deal;
      if (d != null && (typeof d.name !== 'string' || !nonneg(d.pay) || !Array.isArray(d.steps) || !d.steps.length || !nonneg(d.i) || d.i >= d.steps.length || d.steps.some(t => !t || !['go','work','trade'].includes(t.kind) || !Array.isArray(t.spot) || t.spot.length !== 3 || !t.spot.every(Number.isFinite) || !Number.isInteger(t.firm) || t.firm < -1 || t.firm > 3 || !Number.isInteger(t.level) || t.level < 0 || t.level > 2 || typeof t.task !== 'string' || typeof t.verb !== 'string'))) return false;
    }
    if (key === 'tq_ib_story' && (!Number.isSafeInteger(value.trust) || typeof value.last !== 'string')) return false;
  }
  return true;
}
export function summarize(raw) {
  let data; try { data = JSON.parse(raw || '{}'); } catch { data = {}; }
  const read = key => { try { return JSON.parse(data[key] || '{}'); } catch { return {}; } };
  const wallet = read('tq_wallet'), career = read('tq_ib'), adventure = read('tq_adventure_v1');
  return { cash: wallet.cash || 0, watches: wallet.watches || {}, careerStep: career.step || 0, deals: career.deals || 0, quest: career.deal?.steps?.[career.deal.i]?.task || ['前台报到','核对打印材料','湖边会见客户','修正模型','交易考核','董事会签约'][career.step] || career.deal?.name || '', iron: adventure.iron || 0 };
}
