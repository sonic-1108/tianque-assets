import { getAccount, onAccount, ensureAccount, STATS_API } from './stats';
import { SAVE_KEYS, validSnapshot } from '../relay/src/profile.js';

type Snapshot = Record<string, string | null>;
type Remote = { revision: number; updated: number | null; data: Snapshot | null };
type Status = { message: string; ready: boolean; busy: boolean; conflict: boolean; remote: Remote | null; savedAt: number | null };
let status: Status = { message: '等待连接账号', ready: false, busy: false, conflict: false, remote: null, savedAt: null };
const listeners = new Set<() => void>();
export const cloudSubscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const cloudSnapshot = () => status;
const set = (p: Partial<Status>) => { status = { ...status, ...p }; listeners.forEach(f => f()); };
let epoch = 0;
let running = false;
let revision = 0;
let baseline = '';
const META = 'tq_cloud_binding';
export function localSnapshot(): Snapshot {
  const data = Object.fromEntries(SAVE_KEYS.map(k => [k, localStorage.getItem(k)]));
  if (!validSnapshot(data)) throw new Error('本地存档格式异常，已停止同步并保留原存档');
  return data;
}
async function request(body: object, account = getAccount()): Promise<any> {
  if (!account || !STATS_API) throw new Error('账号服务未连接');
  const r = await fetch(STATS_API + '/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, id: account.id, code: account.code }), signal: AbortSignal.timeout(12000) });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || '云存档连接失败'), { conflict: r.status === 409 });
  return data;
}
function bind(last: string) {
  localStorage.setItem(META, JSON.stringify({ id: getAccount()?.id, revision, baseline: last }));
  baseline = last;
}
export async function connectCloud() {
  const gen = ++epoch;
  const account = getAccount();
  set({ ready: false, busy: true, conflict: false, remote: null, message: '正在读取云存档' });
  if (!account) { set({ busy: false, message: '请先登录账号' }); return; }
  try {
    const remote: Remote = await request({ action: 'read' }, account);
    if (gen !== epoch || account.id !== getAccount()?.id) return;
    const local = JSON.stringify(localSnapshot());
    const meta = JSON.parse(localStorage.getItem(META) || 'null');
    revision = remote.revision;
    set({ remote, savedAt: remote.updated });
    if ((!remote.data && (!meta || meta.id === account.id)) || (meta?.id === account.id && meta.revision === remote.revision)) {
      baseline = meta?.baseline || '';
      bind(baseline);
      set({ ready: true, message: '云存档已连接，每 20 秒自动备份' });
    } else if (JSON.stringify(remote.data) === local && meta?.id === account.id) {
      bind(local); set({ ready: true, message: '云存档已是最新' });
    } else {
      set({ conflict: true, message: '检测到其他设备或账号的存档。请选择保留本机进度，或读取云端进度。' });
    }
  } catch (e) { if (gen === epoch) set({ message: String(e.message || e) }); }
  finally { if (gen === epoch) set({ busy: false }); }
}
export async function uploadCloud(force = false) {
  if (status.busy || (!status.ready && !force)) return;
  const account = getAccount(); const gen = epoch;
  if (!account) return;
  set({ busy: true });
  try {
    const data = localSnapshot(); const raw = JSON.stringify(data);
    if (!force && raw === baseline) return;
    const saved = await request({ action: 'write', revision, data }, account);
    if (gen !== epoch || account.id !== getAccount()?.id) return;
    revision = saved.revision; bind(raw);
    set({ remote: { ...saved, data }, ready: true, conflict: false, savedAt: saved.updated, message: '云存档已保存' });
  } catch (e) {
    if (gen === epoch) set({ message: String(e.message || e), ...(e.conflict ? { ready: false, conflict: true } : {}) });
  } finally { if (gen === epoch) set({ busy: false }); }
}
export async function keepLocal() {
  if (status.busy) return;
  // Refresh the expected revision; a racing writer still causes a conflict, never a blind overwrite.
  await connectCloud();
  if (status.remote) await uploadCloud(true);
}
export async function restoreCloud() {
  if (status.busy) return;
  const account = getAccount();const gen = epoch;
  set({ busy: true });
  try {
    const remote: Remote = await request({ action: 'read' }, account);
    if (gen !== epoch || account?.id !== getAccount()?.id) return;
    if (!remote.data || !validSnapshot(remote.data)) throw new Error('没有可读取的有效云存档');
    const before = Object.fromEntries(SAVE_KEYS.map(k => [k, localStorage.getItem(k)]));
    localStorage.setItem('tq_cloud_local_backup', JSON.stringify({ at: Date.now(), binding: localStorage.getItem(META), data: before }));
    try {
      for (const k of SAVE_KEYS) remote.data[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, remote.data[k]!);
      revision = remote.revision; bind(JSON.stringify(remote.data));
    } catch (e) {
      for (const k of SAVE_KEYS) before[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, before[k]!);
      throw e;
    }
    location.reload();
  } catch (e) { if (gen === epoch) set({ message: String(e.message || e), busy: false }); }
}
export function recoverLocalBackup() {
  if (status.busy) return;
  try {
    const backup = JSON.parse(localStorage.getItem('tq_cloud_local_backup') || 'null');
    if (!backup?.data || !validSnapshot(backup.data)) throw new Error('没有有效的本机备份');
    const before = localSnapshot();
    try {
      for (const k of SAVE_KEYS) backup.data[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, backup.data[k]);
      // Force an explicit choice before any restored local backup can overwrite a cloud save.
      localStorage.setItem(META, JSON.stringify({ id: 'local-backup', revision: -1 }));
    } catch (e) {
      for (const k of SAVE_KEYS) before[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, before[k]!);
      throw e;
    }
    location.reload();
  } catch(e) { set({message: String(e.message || e)}); }
}
export function startCloud(name: string) {
  if (!STATS_API || running) return;
  running = true;
  onAccount(() => { void connectCloud(); });
  if (getAccount()) void connectCloud();
  else void ensureAccount(name).catch(() => set({ message: '账号服务暂不可用，本机进度仍保留' }));
  window.setInterval(() => { if (document.visibilityState === 'visible') void uploadCloud(); }, 20000);
}
