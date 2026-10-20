# 天阙 Tianque — handoff notes for Claude

A 3D martial-arts browser fighting game (React Three Fiber). The owner talks in Chinese: reply in Chinese, keep it
short, no dashes in prose, deploy quickly when asked, and say plainly what was not tested.

## Run, build, deploy

- `npm ci`, `npm run dev` (Vite). Type check: `npx tsc --noEmit -p .`. Build: `npx vite build`.
- **Deploy = push to `main`.** `.github/workflows/deploy.yml` builds GitHub Pages and deploys the relay worker.
  Site: https://sonic-1108.github.io/tianque-assets/ . Work happens on branch `emperor-wip`; ship with
  `git push origin HEAD HEAD:main`. Players force-refresh (Ctrl+Shift+R); the lobby shows the build time.
- A push that touches `src/components/CombatData.ts` also starts `balance.yml` (AI-vs-AI win rates, 10 parallel jobs).
  The owner does not want balance runs right now: cancel it if it starts
  (`gh api -X POST repos/sonic-1108/tianque-assets/actions/runs/<id>/cancel`).
- Secrets (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ADMIN_SEED) are set by the owner in GitHub. Never ask for them,
  print them, or handle the owner's passwords/tokens.

## Where things are

- `src/Game.tsx` (~9k lines): the whole simulation in one component with closures. `mainTick` per frame: input, AI
  (`runAI`, `runRangerAI`, `aiReflex`, map routers like `routeDesert`/`routePlank`), physics, hits (`envHit`,
  `koCheck`), map updates (`updateForest`, `updateWeather`, `updateShrines`, `updateDesert`, ...). Not split yet
  (splitting it into heroes / maps / systems modules was planned and never started).
- `src/maps.ts`: map definitions, terrain height functions (`terrainHeight` → `forestFloor`, `desertHeight`,
  `plankHeight`, ...), `mapRuntime` (live map state, also sent to online guests in the host snapshot).
- `src/components/maps/*.tsx`: map scenery. `Forest.tsx` + `ForestExtras.tsx` are 青冥古林.
- `src/components/CombatData.ts`: heroes, skills, HP. `HP_SCALE = 2` multiplies every fighter's HP (rounds were too short).
- `src/settings.ts`: quality, AI levels (`AI_LEVELS`: every level does the same damage as the player; harder levels
  only think/react faster and move better: that is what the owner asked for).
- `src/App.tsx`: lobby, HUD, `Minimap.tsx`, `ShrineHud.tsx`, stats (`src/stats.ts` → relay `/api`).
- `relay/`: Cloudflare worker (online rooms + stats API in a Durable Object's SQLite; D1 is not available because the
  token lacks D1 permission).
- `tools/balance/`: AI-vs-AI balance harness. `tools/tests/`: Playwright scripts used to test mechanics (see below).

## 青冥古林 (forest), the most recent work

- Radius 200 m (`FGROW = 200/58`), river across the middle, 110 giant trees, 10 lookouts.
- Features (`FOREST_X` in maps.ts): waterfall bluff + pool + cave (east), hunters' camp, bamboo grove + stone lantern
  path, ruined pagoda (climb by rubble slopes), swamp (slow + poison + mist hides people), 4 zip lines between
  lookouts, herbs (血参 heal, 疾风果 speed), hunters' traps (and traps you can set).
- Weather cycle with a long night (160 s). At night nobody (player or AI) sees a foe unless lit
  (candle, lanterns, campfire, temple) or within 3 m (`aiSees`, `aiInDark`).
- **Win condition: 3 祖坛 altars** (`SHRINE`, `SHRINES`, `updateShrines`): stand on one to light it, score per second by
  altars held (1 / 2.5 / 5), knockdown +5, first to 100 wins, knocked-down fighters respawn at camp after 8 s.
- Minimap (bottom right, N to enlarge) turns with the camera; foes only shown when visible (`mapRuntime.seen`).

## Testing (no GPU in the cloud container)

- Always open agent-driven game previews with `?silent=1` (or `&silent=1` when a query exists). The owner requires silent testing; do not change their saved sound settings or system volume.

- Software rendering cannot draw the big forest, so 3D screenshots there are not possible: test logic, not looks, and
  tell the owner the visuals are unseen. 2D things (minimap) can be screenshotted.
- Pattern: `npx vite build --outDir /tmp/b --base /`, `npx vite preview --outDir /tmp/b --port 4180`, then
  `URL=http://127.0.0.1:4180/ node tools/tests/<script>.cjs`. The scripts stub WebGL draw/compile calls so the game
  logic runs at speed, start a round from the lobby, and drive state through `globalThis.__TQ`
  (`fighters`, `ai`, `maps`, `rt` = mapRuntime). Useful hooks: `__TQ_TURBO` (sim speed), `__TQ_WEATHER_T`
  (jump weather clock), `__TQ_SIM`, `__TQ_NOWARM`, `__TQ_NOGHOST`, `__TQ_SKIPX` (skip forest extras).
- Mechanics need AI mode on (`__TQ.ai.current = true`): practice mode (AI off) doesn't score or end rounds.
- Don't `pkill -f <pattern>` when the pattern is in your own command line (kills your shell). Edits while a dev server
  test runs break it through HMR: test against a separate build.
- The container's proxy blocks `*.workers.dev`, so the live stats API can't be checked from there.

## 洛城午后 downtown + 投行家 (latest)

- Footbridge (z = 0) over the freeway to a plaza (`DT` in maps.ts). Four enterable towers `FIRMS` (GS, MS, Citadel, IMC):
  lobby 0, trading floor 40, banking floor 80 (`DT.levels`). Physics: `laFloorAt` / `laCeilAt` (height aware),
  `laPushOut` boxes (`FIRM_IN`), `laClamp` bounds. Lifts: F in the core's alcove (`inLift`, `c.lift`), Game
  `updateTowerItems`. Scenery in `src/components/maps/LADowntown.tsx` (people are instanced, shader animated).
- Quest `src/banker.ts` (`IB_STEPS`, localStorage `tq_ib`), HUD `QuestHud.tsx`. The market is `marketPx(sym, t)`.
- The AI does not use lifts.

## Open threads

- Code split of `Game.tsx` (never started).
- Balance: from earlier local runs, 暗器 (Ranger) was clearly strongest vs melee, 狂刃 weakest. Not tuned yet.
- Forest visuals added in the last sessions (waterfall, camp, pagoda, swamp, altars) have not been seen rendered.
- Night may be too dark/long; owner hasn't decided.
