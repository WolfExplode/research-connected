# 性能基线（阶段 0）

- 日期：2026-10-05
- 机器：Apple M3 Pro（arm64），Node v26.10.0
- 数据：benchmarks/perf-fixture.ts 生成的确定性合成图（mulberry32，seed=42），无网络
- 方法：每项 7 轮取中位数，含 1 轮预热；`npm run perf` 复现

| N | nodes | edges | select+similarity | force2d | temporal | radial | aggregates |
| - | ----- | ----- | ----------------- | ------- | -------- | ------ | ---------- |
| 50 | 50 | 76 | 6.3 ms | 14.1 ms | 0.0 ms | 0.0 ms | 0.2 ms |
| 150 | 150 | 235 | 75.3 ms | 96.1 ms | 0.1 ms | 0.1 ms | 0.5 ms |
| 300 | 300 | 483 | 416 ms | 363 ms | 0.1 ms | 0.2 ms | 1.0 ms |

说明：

- select+similarity = `selectNeighbors`（含生产路径 MMR：`buildPairSimilarity` + λ=0.7）+ 引用集构建 + `buildSimilarity`。无网络请求。
- 300 节点下 select+MMR 现已略贵于 force2d。
- force2d = `placeLayout("force2d")`（320 轮力导向 + 每轮 O(N²) 避让）。
- aggregates = `priorWorks` + `derivativeWorks`，可见集为全部节点。
- 交互渲染帧率需在 preview 中人工确认，本脚本只覆盖计算耗时。
- 窄屏为人工验收场景，本阶段不做 CSS 改动。
