import React from 'react';
import { useSettings, setSettings, Quality } from '../settings';

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05, fmt }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; fmt?: (v: number) => string }) {
  return (
    <label className="flex items-center gap-3 text-xs text-zinc-300">
      <span className="w-14 shrink-0 text-zinc-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="flex-1 accent-amber-500" />
      <span className="w-10 text-right tabular-nums text-zinc-400">{fmt ? fmt(value) : Math.round(value * 100)}</span>
    </label>
  );
}

/** 设置: picture quality, volumes and mouse sensitivity (saved in the browser) */
export function SettingsPanel() {
  const s = useSettings();
  const q: [Quality, string, string][] = [
    ['high', '高', '阴影 + 泛光 + 高分辨率'],
    ['medium', '中', '降低分辨率和阴影精度'],
    ['low', '低', '关阴影和泛光，最流畅'],
  ];
  return (
    <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
      <div className="text-xs font-bold text-amber-300 tracking-wider">设置</div>
      <div className="flex gap-2">
        {q.map(([id, name, tip]) => (
          <button
            key={id}
            title={tip}
            onClick={() => setSettings({ quality: id, qualityPicked: true })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${s.quality === id ? 'bg-amber-500 text-black border-amber-400' : 'bg-zinc-950 text-zinc-300 border-zinc-700 hover:border-amber-600'}`}
          >
            画质 {name}
          </button>
        ))}
      </div>
      <Slider label="音效" value={s.sfx} onChange={(v) => setSettings({ sfx: v })} />
      <Slider label="音乐" value={s.music} onChange={(v) => setSettings({ music: v })} />
      <Slider label="环境声" value={s.amb} onChange={(v) => setSettings({ amb: v })} />
      <Slider label="镜头灵敏度" value={s.sens} min={0.4} max={2} step={0.05} onChange={(v) => setSettings({ sens: v })} fmt={(v) => v.toFixed(2)} />
    </div>
  );
}
