// 投行家: a career in 洛城午后's downtown, from first day to Managing Director, then deal after deal (and further
// titles). Progress is kept in this browser.
import { IB_SPOTS, FIRMS, FIRM_SPOTS, CLIENT_SPOTS, laHeight } from './maps';
import { getWallet } from './wallet';

type P3 = [number, number, number];
/** one thing to do: be at spot (in tower firm, on floor level; firm -1 = out in the city) and press F */
export interface Task {
  spot: P3;
  firm: number;
  level: number;
  task: string;
  /** what F does there */
  verb: string;
  /** go: press F there; work: sit 20 s still; trade: a trade making pct */
  kind: 'go' | 'work' | 'trade';
  pct?: number;
  /** someone waits there (a client in a light suit) */
  client?: boolean;
  /** where, for the HUD (out in the city) */
  place?: string;
}
export interface IbStep {
  spot: keyof typeof IB_SPOTS;
  firm: number;
  level: number;
  task: string;
  done: string;
  pay: number;
  watch?: string;
}
export const IB_STEPS: IbStep[] = [
  { spot: 'reception', firm: 0, level: 0, task: '第一天上班：去 Goldman Sachs 大堂前台报到', done: '报到成功，领到工牌。欢迎加入，Summer Analyst', pay: 500 },
  { spot: 'printer', firm: 0, level: 2, task: '坐电梯上 GS 80 层投行部，去打印机拿刚印好的 pitchbook', done: 'pitchbook 拿到了，还是热的', pay: 0 },
  { spot: 'client', firm: -1, level: 0, task: '客户在湖边等着：把 pitchbook 送到他手里（湖东边的小路上）', done: '客户翻完 pitchbook 很满意。转正了：Analyst', pay: 2000 },
  { spot: 'desk', firm: 0, level: 2, task: '回 GS 80 层工位，与林砚核对收入和成本，修正模型', done: '模型改完，MD 说 "looks good"。升职：Associate', pay: 5000 },
  { spot: 'trade', firm: 2, level: 1, task: '去 Citadel 40 层交易台：按 F 买入，看墙上行情涨了再按 F 卖出，一笔赚到 2% 才算过', done: '漂亮的一笔。升职：VP', pay: 0 },
  { spot: 'board', firm: 1, level: 2, task: '收购谈下来了：去 Morgan Stanley 80 层董事会议室签 term sheet', done: '交易完成！升职：Managing Director', pay: 50000, watch: 'patek' },
];
const VERB: Record<string, string> = { reception: '报到', printer: '拿 pitchbook', client: '把 pitchbook 交给客户', board: '签 term sheet' };
/** titles: the career steps, then by deals closed as MD */
export const IB_TITLES = ['新人', 'Summer Analyst', 'Summer Analyst', 'Analyst', 'Associate', 'VP', 'Managing Director'];
const LATER: [number, string][] = [
  [3, 'Partner'],
  [8, 'Head of IBD'],
  [15, 'CEO'],
  [30, '华尔街之王'],
];
// ---------------------------------------------------------------
// deals after MD: a few steps each, paid on closing
// ---------------------------------------------------------------
export interface Deal {
  name: string;
  steps: Task[];
  i: number;
  pay: number;
  watch?: string;
  /** IPO roadshows run against the clock (Date.now ms) */
  deadline?: number;
  /** what the deal pays besides (a trade's profit is counted separately) */
  done: string;
}
const TARGETS = ['加州橙汁集团', '好莱坞梦工场影业', '硅谷光纤网络', '圣莫尼卡冲浪板公司', 'Y2K 软件公司', '帕萨迪纳航天', '比佛利山地产', '长滩港口物流', '日落大道唱片', '纳帕谷酒庄'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const firmName = (k: number) => FIRMS[k].name;
function clientTask(task: string, verb: string): Task {
  const c = pick(CLIENT_SPOTS);
  return { spot: [c.x, laHeight(c.x, c.z), c.z], firm: -1, level: 0, task: task.replace('{at}', c.name), verb, kind: 'go', client: true, place: c.name };
}
function makeDeal(n: number): Deal {
  const kind = pick(['ma', 'ipo', 'trade', 'night']);
  const f = Math.floor(Math.random() * FIRMS.length);
  const tgt = pick(TARGETS);
  const scale = 1 + n * 0.2;
  const watch = (n + 1) % 4 === 0 ? pick(['rolex', 'iwc', 'patek']) : undefined;
  if (kind === 'ma') {
    return {
      name: `并购：收购${tgt}`,
      steps: [
        clientTask(`${tgt}的老板在{at}等你：去谈收购`, '谈收购'),
        { spot: FIRM_SPOTS[f].board, firm: f, level: 2, task: `谈妥了：去 ${firmName(f)} 80 层董事会议室签并购协议`, verb: '签并购协议', kind: 'go' },
      ],
      i: 0,
      pay: Math.round(20000 * scale),
      watch,
      done: `${tgt}收购完成`,
    };
  }
  if (kind === 'ipo') {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 3);
    return {
      name: `IPO 路演：${tgt}上市`,
      steps: order.map((k, j) => ({ spot: FIRM_SPOTS[k].reception, firm: k, level: 0, task: `路演 ${j + 1}/3：去 ${firmName(k)} 大堂前台讲 ${tgt} 的故事`, verb: '路演', kind: 'go' as const })),
      i: 0,
      pay: Math.round(30000 * scale),
      watch,
      deadline: 0, // set when the deal starts
      done: `${tgt}敲钟上市`,
    };
  }
  if (kind === 'trade') {
    const pct = 0.015 + Math.min(0.02, n * 0.002);
    return {
      name: `自营交易：${firmName(f)} 交易台`,
      steps: [{ spot: FIRM_SPOTS[f].trade, firm: f, level: 1, task: `去 ${firmName(f)} 40 层交易台做一笔，赚到 ${(pct * 100).toFixed(1)}%`, verb: '交易', kind: 'trade', pct }],
      i: 0,
      pay: Math.round(10000 * scale),
      watch,
      done: '交易台的奖金',
    };
  }
  return {
    name: `熬夜赶 deck：${tgt}`,
    steps: [
      { spot: FIRM_SPOTS[f].desk, firm: f, level: 2, task: `明早要见${tgt}：去 ${firmName(f)} 80 层工位，与林砚核对 deck 数据`, verb: '坐下改 deck', kind: 'work' },
      { spot: FIRM_SPOTS[f].printer, firm: f, level: 2, task: `改完了：去 ${firmName(f)} 80 层打印机拿 deck`, verb: '拿 deck', kind: 'go' },
      clientTask(`把 deck 送到{at}，${tgt}的人在那等`, '交 deck'),
    ],
    i: 0,
    pay: Math.round(25000 * scale),
    watch,
    done: `${tgt}的会开得很顺`,
  };
}
// ---------------------------------------------------------------
// state
// ---------------------------------------------------------------
const KEY = 'tq_ib';
export interface IbState {
  step: number;
  /** the open trade at a desk: entry price (0 none) and which tower's desk */
  entry: number;
  entryFirm: number;
  work: number;
  /** deals closed as MD, and the one under way */
  deals: number;
  deal: Deal | null;
}
let state: IbState = load();
function load(): IbState {
  const s0: IbState = { step: 0, entry: 0, entryFirm: -1, work: 0, deals: 0, deal: null };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.step === 'number') return { ...s0, step: Math.min(IB_STEPS.length, s.step), deals: s.deals ?? 0, deal: s.deal ?? null };
  } catch {
    /* private mode */
  }
  return s0;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ step: state.step, deals: state.deals, deal: state.deal }));
  } catch {
    /* private mode */
  }
}
export const getIb = () => state;
export function ibTitle(s = state) {
  if (s.step < IB_STEPS.length) return IB_TITLES[s.step];
  let t = IB_TITLES[IB_TITLES.length - 1];
  for (const [n, name] of LATER) if (s.deals >= n) t = name;
  return t;
}
/** the next title and how many deals it needs (null at the top) */
export function ibNextTitle(): [string, number] | null {
  for (const [n, name] of LATER) if (state.deals < n) return [name, n - state.deals];
  return null;
}
export function ibSet(p: Partial<IbState>) {
  state = { ...state, ...p };
}
/** start the next deal if there is none (after MD) */
function ensureDeal() {
  if (state.step < IB_STEPS.length || state.deal) return;
  state.deal = makeDeal(state.deals);
  if (state.deal.deadline !== undefined) state.deal.deadline = Date.now() + 300000;
  save();
}
/** what to do now, or null */
export function ibTask(): Task | null {
  if (state.step < IB_STEPS.length) {
    const st = IB_STEPS[state.step];
    const kind = st.spot === 'desk' ? 'work' : st.spot === 'trade' ? 'trade' : 'go';
    return { spot: IB_SPOTS[st.spot], firm: st.firm, level: st.level, task: st.task, verb: VERB[st.spot] ?? '', kind, pct: kind === 'trade' ? 0.02 : undefined, client: st.spot === 'client', place: st.spot === 'client' ? '湖边小路' : undefined };
  }
  ensureDeal();
  return state.deal ? state.deal.steps[state.deal.i] : null;
}
export interface Done {
  text: string;
  next?: string;
  big: boolean;
}
/** the current task is done: pay, promote, move on. `extra` is a trade's profit, already paid */
export function ibDone(extra = 0): Done {
  if (state.step < IB_STEPS.length) {
    const st = IB_STEPS[state.step];
    if (st.pay || st.watch) payCash(st.pay, st.watch);
    state = { ...state, step: state.step + 1, entry: 0, work: 0 };
    save();
    const pay = st.pay + extra;
    const t = ibTask();
    return { text: `${st.done}${pay ? ` · +${pay.toLocaleString()}` : ''}${st.watch ? ' · 一块百达翡丽' : ''}`, next: t ? (state.step >= IB_STEPS.length ? `第一单生意来了：${state.deal?.name} · ${t.task}` : `下一步：${t.task}`) : undefined, big: true };
  }
  const D = state.deal;
  if (!D) return { text: '', big: false };
  D.i++;
  if (D.i < D.steps.length) {
    save();
    return { text: '搞定', next: `下一步：${D.steps[D.i].task}`, big: false };
  }
  const before = ibTitle();
  payCash(D.pay, D.watch);
  state = { ...state, deals: state.deals + 1, deal: null, entry: 0, work: 0 };
  save();
  const after = ibTitle();
  const t = ibTask();
  const watchName: Record<string, string> = { rolex: 'Rolex', iwc: 'IWC', patek: '百达翡丽' };
  return {
    text: `${D.done}！奖金 +${(D.pay + extra).toLocaleString()}${D.watch ? ` · 一块${watchName[D.watch]}` : ''}${after !== before ? ` · 升职：${after}` : ''}`,
    next: t && state.deal ? `新的生意：${state.deal.name} · ${t.task}` : undefined,
    big: true,
  };
}
/** Dialogue reading time is excluded from the roadshow deadline, including after reload. */
export function ibDelayDeadline(ms: number) {
  if (state.deal?.deadline) { state.deal.deadline += Math.max(0, ms); save(); }
}
/** an IPO roadshow out of time: the deal falls through, a new one comes */
export function ibExpire(): string | null {
  const D = state.deal;
  if (!D?.deadline || Date.now() < D.deadline) return null;
  const name = D.name;
  state = { ...state, deal: null };
  ensureDeal();
  return `${name} 路演超时，投资人走了，这单黄了 · 新的生意：${state.deal?.name}`;
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
/** where a task is, for the HUD */
export function ibWhere(t: Task) {
  if (t.firm < 0) return t.place ?? '城里';
  const F = FIRMS[t.firm];
  return `${F.name} · ${F.floors[t.level]}`;
}
/** the trade's size: P&L in cash is this times the move */
export const IB_NOTIONAL = 200000;
// kept for older callers
export function ibAdvance() {
  ibDone();
}
