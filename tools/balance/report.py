"""Hero balance report from balance.cjs results (one JSON line per pair). Prints Markdown.

usage: python3 report.py results.jsonl [more.jsonl ...]
"""
import collections
import json
import sys

NAMES = {'Berserker': '狂刃', 'Ranger': '暗器', 'BuddhistMage': '梵音', 'Shadowblade': '影刃', 'Emperor': '天子'}


def main(paths):
    rows = []
    for p in paths:
        for line in open(p, encoding='utf-8'):
            line = line.strip()
            if line.startswith('{'):
                rows.append(json.loads(line))
    wins = collections.Counter()
    games = collections.Counter()
    left = collections.defaultdict(list)
    durs = []
    pairs = []
    errors = []
    meta = None
    for r in rows:
        if 'error' in r:
            errors.append(r)
            continue
        meta = meta or r
        a, b = r['classes'][:2]
        wa = wb = d = 0
        for x in r['rounds']:
            durs.append(x['dur'])
            games[a] += 1
            games[b] += 1
            if x['w'] == 0:
                wa += 1
                wins[a] += 1
                left[a].append(x['left'])
            elif x['w'] == 1:
                wb += 1
                wins[b] += 1
                left[b].append(x['left'])
            else:
                d += 1
        pairs.append((a, b, wa, wb, d))

    n = lambda h: NAMES.get(h, h)
    out = ['## 英雄平衡测试', '']
    if meta:
        out.append(f"地图 `{meta.get('map')}` · AI 难度 `{meta.get('lv')}` · 共 {len(durs)} 局 · 平均每局 {sum(durs) / max(1, len(durs)):.0f} 秒（游戏时间）")
        out.append('')
    out += ['| 英雄 | 胜率 | 局数 | 赢的时候平均剩余血量 |', '|---|---|---|---|']
    for h in sorted(games, key=lambda h: -wins[h] / max(1, games[h])):
        l = left[h]
        out.append(f"| {n(h)} | {100 * wins[h] / max(1, games[h]):.1f}% | {games[h]} | {sum(l) / max(1, len(l)):.0f}% |")
    out += ['', '| 对局 | 胜 - 负 - 平 |', '|---|---|']
    for a, b, wa, wb, d in pairs:
        out.append(f"| {n(a)} 对 {n(b)} | {wa} - {wb} - {d} |")
    for e in errors:
        out.append(f"\n出错：{e.get('A')} 对 {e.get('B')}：{e.get('error')}")
    print('\n'.join(out))


if __name__ == '__main__':
    main(sys.argv[1:] or ['/tmp/claude-0/balance/results.jsonl'])
