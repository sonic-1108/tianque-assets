// 投行家: a career in 洛城午后's downtown, from first day to Managing Director. Progress is kept in this browser.
import { IB_SPOTS, FIRMS } from './maps';
import { getWallet } from './wallet';

export interface IbStep {
  /** the spot the task is done at (IB_SPOTS key) */
  spot: keyof typeof IB_SPOTS;
  /** which tower and floor (for the HUD), firm -1 = out in the park */
  firm: number;
  level: number;
  task: string;
  /** shown when it's done */
  done: string;
  /** cash paid on completion, and a watch */
  pay: number;
  watch?: string;
}
export const IB_STEPS: IbStep[] = [
  { spot: 'reception', firm: 0, level: 0, task: '第一天上班：去 Goldman Sachs 大堂前台报到', done: '报到成功，领到工牌。欢迎加入，Summer Analyst', pay: 500 },
  { spot: 'printer', firm: 0, level: 2, task: '坐电梯上 GS 80 层投行部，去打印机拿刚印好的 pitchbook', done: 'pitchbook 拿到了，还是热的', pay: 0 },
  { spot: 'client', firm: -1, level: 0, task: '客户在湖边等着：把 pitchbook 送到他手里（湖东边的小路上）', done: '客户翻完 pitchbook 很满意。转正了：Analyst', pay: 2000 },
  { spot: 'desk', firm: 0, level: 2, task: '回 GS 80 层你的工位熬夜改模型：按 F 坐下，20 秒别动，挨打就得重来', done: '模型改完，MD 说 "looks good"。升职：Associate', pay: 5000 },
  { spot: 'trade', firm: 2, level: 1, task: '去 Citadel 40 层交易台：按 F 买入，看墙上行情涨了再按 F 卖出，一笔赚到 2% 才算过', done: '漂亮的一笔。升职：VP', pay: 0 },
  { spot: 'board', firm: 1, level: 2, task: '收购谈下来了：去 Morgan Stanley 80 层董事会议室签 term sheet', done: '交易完成！升职：Managing Director', pay: 50000, watch: 'patek' },
];
export const IB_TITLES = ['新人', 'Summer Analyst', 'Summer Analyst', 'Analyst', 'Associate', 'VP', 'Managing Director'];
const KEY = 'tq_ib';
export interface IbState {
  step: number;
  /** the open trade at the Citadel desk: entry price, or 0 for none */
  entry: number;
  /** working on the model: seconds of sitting still done */
  work: number;
}
let state: IbState = load();
function load(): IbState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.step === 'number') return { step: Math.min(IB_STEPS.length, s.step), entry: 0, work: 0 };
  } catch {
    /* private mode */
  }
  return { step: 0, entry: 0, work: 0 };
}
export const getIb = () => state;
export const ibTitle = (s = state) => IB_TITLES[Math.min(IB_TITLES.length - 1, s.step)];
export function ibAdvance() {
  state = { ...state, step: state.step + 1, entry: 0, work: 0 };
  try {
    localStorage.setItem(KEY, JSON.stringify({ step: state.step }));
  } catch {
    /* private mode */
  }
}
export function ibSet(p: Partial<IbState>) {
  state = { ...state, ...p };
}
/** add (or take, never below nothing) cash, and watches, straight into 身家 */
export function payCash(n: number, watch?: string) {
  const w = getWallet();
  w.cash = Math.max(0, Math.round(w.cash + n));
  if (watch) w.watches[watch] = (w.watches[watch] ?? 0) + 1;
  try {
    localStorage.setItem('tq_wallet', JSON.stringify(w));
  } catch {
    /* private mode */
  }
  return w;
}
/** where the current task is, for the HUD */
export function ibWhere(st: IbStep) {
  if (st.firm < 0) return '湖边';
  const F = FIRMS[st.firm];
  return `${F.name} · ${F.floors[st.level]}`;
}
/** the trade's size: P&L in cash is this times the move */
export const IB_NOTIONAL = 200000;
