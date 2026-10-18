import React from 'react';
import { cloudSubscribe, cloudSnapshot, connectCloud, uploadCloud, keepLocal, restoreCloud, recoverLocalBackup } from '../cloudSave';
export function CloudSavePanel() {
  const s = React.useSyncExternalStore(cloudSubscribe, cloudSnapshot);
  return <section className="tq-st-note" style={{ padding: 12, border: '1px solid #b5aa95', borderRadius: 8 }}>
    <strong>账号云存档</strong><div role="status">{s.message}</div>
    <div>包含钱包、手表、铁料、洛城主线与职位。恢复码也用于换设备找回这些进度。</div>
    {s.savedAt && <div>上次备份：{new Date(s.savedAt).toLocaleString()}</div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {s.ready && <button className="tq-st-btn" disabled={s.busy} onClick={() => uploadCloud()}>立即备份</button>}
      <button className="tq-st-btn ghost" disabled={s.busy} onClick={() => connectCloud()}>重新连接</button>
      {s.conflict && <button className="tq-st-btn" disabled={s.busy} onClick={() => { if (confirm('将本机进度绑定到当前账号，并覆盖该账号云端版本。确定保留本机进度？')) void keepLocal(); }}>保留本机进度</button>}
      {s.remote?.data && <button className="tq-st-btn ghost" disabled={s.busy} onClick={() => { if (confirm('读取当前账号的云端进度并刷新游戏。本机原进度会额外保留一份备份。继续？')) void restoreCloud(); }}>读取云端进度</button>}
      <button className="tq-st-btn ghost" disabled={s.busy} onClick={() => { if (confirm('恢复上次读取云端前保留的本机备份，并刷新游戏？恢复后会暂停自动同步，等待你选择版本。')) recoverLocalBackup(); }}>恢复本机备份</button>
    </div>
  </section>;
}
