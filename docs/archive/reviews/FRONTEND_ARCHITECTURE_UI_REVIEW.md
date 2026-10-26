# 前端架构治理与嵌入/图谱一致性审查

> 状态更新（2026-10-07，基于提交 `3f9d3ea`）：以下是 2026-10-05 的历史审查记录，不能直接视作当前缺陷清单。共享渲染已改为同一 `SimilarityMap` canvas；统一响应式断点、`--rc-*` token、键盘焦点样式、窄屏操作换行和侧栏折叠均已落地；路径高亮已移除。源码只保留 `map-canvas.ts`，Three.js/WebGL 已删除。当前架构有意复用纯逻辑/renderer，而不合并面板和嵌入的 DOM mount 流程。本轮 `npm test` 与 `npm run build` 通过。浏览器视觉矩阵未能执行：本轮浏览器安全提示显示用户拒绝访问本地预览，故窄屏、暗色主题和真实 Obsidian 宿主仍需手工验收。

日期：2026-10-05
范围：`src/app.ts`、`src/embed-mount.ts`、`src/graph-chrome.ts`、`src/map-canvas.ts`、`styles.css`、`preview/`、UI 验证脚本。

## 结论

当前总体方向正确：面板和嵌入复用 `mountGraph3D`、图例/工具条/详情卡片语义，且 `verify-architecture.mjs` 已建立领域层/适配层依赖护栏。但“共享语义”还没有落实成真正的共享 UI 契约：同一套控件由两套 mount 流程和大量 `.cpo-root`/`.cpo-embed` 选择器分别维护，导致尺寸、颜色、响应式和状态可访问性会逐渐漂移。

优先级建议：先修复窄宽度下的可用性和布局溢出，再收敛 token/组件契约，最后拆分 `app.ts`/`embed-mount.ts` 的协调职责。

## P0/P1 发现

1. **P1 — 嵌入模式缺少与面板一致的 header 结构。** `src/embed-mount.ts:55-94` 的嵌入只有品牌、重新加载和状态，面板在 `src/app.ts:90-120` 另有搜索表单、结果列表、banner、seed summary。两者共享 CSS 名称但不是共享组件，状态、错误和加载高度容易不一致。建议抽出 `mountHeader({mode, actions, search?})`，保留 surface-specific 内容参数。

2. **P1 — 面板/嵌入存在两套证据栏尺寸策略。** `styles.css:1438-1444` 将侧栏锁在 `min-width:260px`、`max-width:min(480px,46vw)`；窄屏在 `styles.css:1580-1608` 又用 `flex-basis:min(42%,330px)`。嵌入自身还通过 `src/embed-mount.ts:641-674` 写入 width/height。窄嵌入容易出现“图谱过矮 + 详情栏占据 42%”的组合，长标题/标签换行后可用空间更差。应统一一个 `--rc-sidebar-min/max` 和一个窄屏断点策略，并让 embed resize 只修改 CSS custom property。

3. **P1 — actions bar 在窄宽度下会横向溢出。** `styles.css:1185-1189` 的 `.cpo-actions-bar .cpo-tool-row { flex-wrap: nowrap; min-width: max-content; }` 与 `styles.css:565` 的横向滚动叠加；用户必须水平滚动才能找到导出/时间线操作，且滚动位置没有提示。建议保留一行时只显示高频动作，其余进入原生 `details`/菜单；或在 embed 下允许两行 wrap，避免把“可见性”交给隐蔽滚动。

4. **P1 — 触控与键盘焦点样式不成体系。** 画布用了 `touch-action: pan-y`（`styles.css:841`），但图谱同时需要横向平移和拖拽；移动端会把横向手势交给浏览器，交互感受不稳定。多数按钮只有 hover/active，缺少统一 `:focus-visible`（例如 rail/tool/tab/action-link 的选中与焦点区分）。应按交互目标设置 `touch-action:none` 或明确 pan 方向，并建立共享 focus ring token。

5. **P1 — 设计系统 token 未落地，视觉一致性实际上靠重复硬编码。** `.superdesign/design-system.md` 要求 `--rc-surface/canvas/ink/muted/border/accent/radius/space`，但 `styles.css:14-32` 仍使用 `--text-*`、`--background-*`、`--cpo-accent`，后半段又出现 `#f6f5f2`、`rgba(60,64,70,...)`、`#a67c2e` 等重复值（如 `styles.css:1400-1444`）。这会造成面板和嵌入在 hover、边框、详情背景上的细微差异。建议建立单一 `--rc-*` token 层，旧变量只做兼容映射。

6. **P1 — 面板和嵌入的窄屏类由不同逻辑驱动。** `styles.css:741-767` 同时写 `.cpo-root.is-narrow` 和 `.cpo-embed.is-narrow`，但 `src/app.ts` 与 `src/embed-mount.ts` 的 ResizeObserver/宽度状态并非同一入口。结果是同一宽度可能触发不同的 rail、header、sidebar 规则。应抽出 `applyResponsiveMode(root, width)`，让两个 surface 使用同一个状态机和断点。

7. **P1 — CSS 后期覆盖层过多，降低治理可见性。** `styles.css` 约 1,946 行，规则在文件后段再次覆盖前段组件（例如 `styles.css:1390+` 的 “finishing layer”）。新增 UI 很难判断最终生效值，也容易只修面板不修嵌入。建议按 token → shell → graph → controls → evidence → responsive 分层，每个组件只保留一处主规则。

8. **P1 — `mountEmbed` 仍是超大协调器，且直接负责 DOM、尺寸、数据加载、事件和状态恢复。** 当前约 938 行；面板对应 `app.ts` 约 977 行。两者都把“view model + mount + side effect”混在一起，导致一致性修复必须同时穿过大量命令式 DOM。建议最小拆分为 `graph-surface`、`evidence-surface`、`embed-resize`、`view-state` 四个窄模块，不要引入新的框架或状态库。

9. **P2 — 视图状态缓存是模块级全局 Map，生命周期边界不明确。** `src/embed-mount.ts:37-46` 的 `cache` 和 `viewStates` 跨所有 embed 实例存在；关闭笔记/切换 vault 后仍可能持有大图和 camera/filter 状态。建议按 source/vault 生命周期清理，至少提供 `clearEmbedState()` 并在 destroy/unload 调用；如果数据缓存需要保留，分离数据缓存和视图状态缓存。

10. **P2 — 设计系统要求“无渐变”，但画布变量仍声明 start/end。** `styles.css:26-27` 的 `--cpo-canvas-bg-start/end` 暗示渐变语义，且图谱视觉 token 与设计系统的 `--rc-canvas` 不同。即使当前没有直接渐变，也会继续诱导新代码引入不一致背景。删除未使用 token，画布背景统一为 `--rc-canvas`。

11. **P2 — 交互文本和 ARIA 状态覆盖不完整。** 例如 rail filter 设置了 `aria-expanded`，但 tab/tool 状态主要依靠 `.is-on`；graph canvas 有 aria-label，却没有键盘选择/缩放说明，也没有对 tooltip/详情切换做 live region 设计。建议共享 `setPressed` 同时设置 `aria-pressed`，drawer 使用 `aria-controls`，画布提供键盘操作说明和可聚焦节点替代入口。

12. **P2 — 预览页面不是一致性回归入口。** `preview/embed.html`、`preview/detail-preview.html` 与面板没有固定宽度矩阵（窄嵌入、长标题、空态、错误态、侧栏打开、时间线）。现有 `scripts/verify-ui.ts` 主要验证布局函数/字符串语义，不能发现 CSS 溢出和视觉漂移。建议增加无浏览器依赖的 DOM contract 检查，再用预览手工验收 320/480/768/1024px 四档。

## 具体验收矩阵

- 320px embed：header 不换行溢出；rail、drawer、actions、详情栏均可键盘到达。
- 480px embed：图谱至少 220px 高；打开详情后标题/证据卡不截断；底部操作不要求横向滚动。
- 768px pane：左 rail、图谱、右证据栏同时可见；拖拽侧栏不低于 260px、不高于 46vw。
- 1024px+ pane：搜索、seed summary、graph stage、actions bar、sheet 的边界与嵌入遵循同一 token。
- 状态矩阵：loading/error/empty/selected/disabled/focus-visible/hover/dark Obsidian theme。
- 运行 `npm test`：架构检查通过，但当前离线单测失败在 `scripts/verify.cjs:4926` 的 “Kumu 圈层布局是二维小节点地图”，说明本轮审查不能宣称全绿；这属于现有布局回归，需单独修复并补充 UI 回归。

## 最小实施顺序

1. 建立 `--rc-*` token 映射和共享 focus/selected/button 状态；删除重复后期覆盖。
2. 统一 responsive state、sidebar sizing、actions bar 在 320/480/768px 的行为。
3. 抽取 header/toolbar/evidence 的 DOM factory；面板和 embed 只传 surface-specific 参数。
4. 为 preview 增加固定宽度/状态矩阵，修复 Kumu 单测回归后再接入 CI。

## Ponytail 结论

- `styles.css` 后段重复覆盖层是首要可删复杂度：合并为一套 token + 组件规则。
- `mountEmbed`/`mountGraphApp` 不需要引入新框架；只需拆出 4 个纯职责小模块。
- 不建议当前引入设计系统依赖、CSS-in-JS 或全局状态库。

净收益目标：首轮可删除/合并约 150–250 行 CSS 覆盖与重复选择器，且减少面板/嵌入分叉。
