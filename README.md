# 天阙 Tian Que

3D 动作对战网页游戏。狂刃·霍岩 / 夜鸮 / 梵音 / 灵雀 / 慈航。

本地运行：`npm install` 然后 `npm run dev`

## 青岚采石场：单人寻材试验

大厅点击「青岚采石场 · 单人寻材」，或在地图列表选择青岚采石场后出征。
固定使用狂刃挑战一名试炼守卫；沿石径进入战斗区，击败后靠近金色标记自动拾取铁料。
材料保存于当前浏览器的 `tq_adventure_v1`，刷新后保留。按 M 回大厅重新出发。
此地图暂不支持联机，武器制作尚未开放；其他竞技地图维持原有规则。

鼠标锁定被浏览器拒绝时，可在场景内移动鼠标转视角；移动到界面控件或暂停时不处理镜头输入。

验证：`npx tsc --noEmit -p .`、`npm run build`。
存档测试：`npx tsc --ignoreConfig src/adventure.ts --target ES2022 --module ESNext --outDir .adventure-test --skipLibCheck`，然后 `node --test tools/tests/adventure.test.mjs`。
镜头测试：Node 22.13+ 执行 `node --test tools/tests/camera-input.test.cjs`。
