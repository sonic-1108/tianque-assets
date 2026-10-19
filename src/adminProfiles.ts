import { STATS_API } from './stats';
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const date = (n: number) => n ? new Date(n).toLocaleString() : '暂无记录';
const title = (p: any) => p.careerStep < 6 ? ['新人','Summer Analyst','Summer Analyst','Analyst','Associate','VP'][p.careerStep] : p.deals >= 30 ? '华尔街之王' : p.deals >= 15 ? 'CEO' : p.deals >= 8 ? 'Head of IBD' : p.deals >= 3 ? 'Partner' : 'Managing Director';
export function startProfiles(code: string) {
  const host = document.createElement('section'); host.className = 'wrap'; document.body.append(host);
  host.innerHTML = `<h1>账号档案</h1><p class="sub">服务端验证口令后读取。新版本上线后开始累计活跃游玩时间；存档是客户端上报的进度，不是防作弊记录。</p>
    <form id="profile-search"><input aria-label="搜索玩家昵称或账号 ID" placeholder="昵称或完整账号 ID" maxlength="64"><button>搜索</button><button type="button" id="profile-refresh">刷新</button></form>
    <p id="profile-status" role="status"></p><div class="scroll" id="profile-list"></div><p><button id="profile-prev">上一页</button> <button id="profile-next">下一页</button></p><section id="profile-detail"></section>`;
  const message = host.querySelector('#profile-status')!;
  const list = host.querySelector('#profile-list')!;
  const detail = host.querySelector('#profile-detail')!;
  const prev = host.querySelector<HTMLButtonElement>('#profile-prev')!, next = host.querySelector<HTMLButtonElement>('#profile-next')!;
  let offset = 0, search = '', generation = 0, detailGeneration = 0;
  async function call(path: string) {
    if (!STATS_API) throw new Error('账号服务未连接');
    if (!code) throw new Error('服务端账号档案需要后台口令，请配置 ADMIN_SEED 后重新发布');
    const r = await fetch(STATS_API + path, { headers: { 'x-tq-admin': code }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || '读取失败'); return data;
  }
  async function load() {
    const gen = ++generation;
    message.textContent = '读取账号档案中…'; prev.disabled = next.disabled = true;
    try {
      const result = await call(`/admin/players?offset=${offset}&search=${encodeURIComponent(search)}`);
      if (gen !== generation) return;
      message.textContent = `当前第 ${offset / 50 + 1} 页 · ${result.players.length} 个账号（每页最多 50 个）`;
      prev.disabled = offset === 0; next.disabled = !result.more;
      list.innerHTML = `<table><thead><tr><th>玩家 / ID</th><th>状态</th><th>最近地图 / 职业</th><th>活跃游玩</th><th>职位 / 材料</th><th>最后出现</th></tr></thead><tbody>${result.players.map(p => `<tr><td><button data-player="${escape(p.id)}">${escape(p.name)}</button><br><small>${escape(p.id)}</small></td><td>${p.online ? '在线' : '离线'}</td><td>${escape(p.map || '—')} / ${escape(p.hero || '—')}</td><td>${Math.floor((p.seconds || 0)/60)} 分钟</td><td>${p.updated ? `${escape(title(p.progress))} / 铁料 ${p.progress.iron}` : '尚无云存档'}</td><td>${escape(date(p.seen || p.last))}</td></tr>`).join('') || '<tr><td colspan="6">暂无匹配账号</td></tr>'}</tbody></table>`;
      list.querySelectorAll<HTMLButtonElement>('[data-player]').forEach(button => { button.onclick = () => { void showDetail(button.dataset.player!); }; });
    } catch (e) { if (gen === generation) { message.textContent = String(e.message || e); list.textContent = ''; } }
  }
  async function showDetail(id: string) {
    const gen = ++detailGeneration; detail.textContent = '读取玩家详情中…';
    try {
      const d = await call('/admin/player?id=' + encodeURIComponent(id)); if (gen !== detailGeneration) return;
      const p = d.progress;
      detail.innerHTML = `<h2>${escape(d.player.name)} · ${escape(d.player.id)}</h2><p>注册：${escape(date(d.player.created))}<br>最近在线：${escape(date(d.activity?.seen || d.player.last))}<br>累计活跃游玩：${Math.floor((d.activity?.seconds || 0)/60)} 分钟<br>胜 / 负 / 平：${d.player.wins} / ${d.player.losses} / ${d.player.draws}</p>
        <p>${d.savedAt ? `云存档版本 ${d.revision} · ${escape(date(d.savedAt))}<br>职位：${escape(title(p))} · 已成交 ${p.deals} 单<br>当前订单：${escape(p.quest || '初始主线或暂无订单')}<br>钱包：${p.cash} · 铁料：${p.iron}<br>原材：${escape(Object.entries(p.materials || {}).map(([k,v])=>`${k} × ${v}`).join("，") || "无")}<br>改造：${escape(p.equipped || "未装备")}<br>手表：${escape(Object.entries(p.watches).map(([k,v])=>`${k} × ${v}`).join('，') || '无')}` : '该账号尚未上传云存档'}</p>
        <h3>最近 50 场对局</h3><div class="scroll"><table><thead><tr><th>时间</th><th>职业</th><th>地图</th><th>结果</th><th>时长</th></tr></thead><tbody>${d.matches.map(m=>`<tr><td>${escape(date(m.ts))}</td><td>${escape(m.hero)}</td><td>${escape(m.map)}</td><td>${['负','胜','平'][m.result] || '—'}</td><td>${m.dur} 秒</td></tr>`).join('') || '<tr><td colspan="5">暂无对局记录</td></tr>'}</tbody></table></div>`;
    } catch (e) { if(gen === detailGeneration) detail.textContent = String(e.message || e); }
  }
  host.querySelector<HTMLFormElement>('#profile-search')!.onsubmit = e => { e.preventDefault(); search = host.querySelector('input')!.value; offset = 0; void load(); };
  host.querySelector<HTMLButtonElement>('#profile-refresh')!.onclick = () => { void load(); };
  prev.onclick = () => { offset = Math.max(0,offset-50); void load(); };
  next.onclick = () => { offset += 50; void load(); };
  void load();
}
