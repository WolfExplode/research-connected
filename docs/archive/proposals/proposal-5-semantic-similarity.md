# 语义相似度通道实施方案

> 目标：在现有引用结构相似度之外，增加一条文本/语义相似度通道，用于候选排序与关系解释。
> 边界：语义相似度永远不与引用关系混为一谈；不引入浏览器端模型推理；不改变「相似不代表引用」的既有口径。
> 依赖：阶段 3.7（候选排序重构，log+年龄衰减归一化）先行；本方案排在其后。

## 0. 现状盘点（已核实）

| 已有 | 位置 | 说明 |
| --- | --- | --- |
| 结构相似度 | `src/similarity.ts` | 0.55×耦合(cosine) + 0.35×共被引(cosine) + 0.10×直接引用，已归一化 |
| 主题余弦 | `src/topic-similarity.ts` | OpenAlex topic score 向量余弦，**目前只用于节点着色**，未进入排序 |
| S2 批量通道 | `SemanticScholarClient.bulkCounts` | POST `/paper/batch`（500/批，带 key 支持、重试、格式校验），加字段即可扩展 |
| 文本素材 | `PaperNode` | title / abstract（OpenAlex 倒排索引重建，部分缺失）/ concepts / topicTags |

关键洞察：S2 的 `paper/batch` 接口支持 `fields=embedding`（SPECTER2 向量，768 维），**可以和现有 bulkCounts 共用同一批请求**——零额外往返就能拿到向量。

## 1. 三层信号定义

```text
structural  = 现有：耦合 + 共被引 + 直接引用（引用结构）
semantic    = 新增：文本/语义相似度（本方案）
authority   = 阶段 3.7：log(1+被引) × 年龄衰减（候选排序用）
```

semantic 内部有两个实现档位，自动降级：

```text
S2 embedding 余弦（有 key / 接口可用 / 该篇有向量）
  → 缺失时降级：BM25（标题+摘要）× 0.6 + 主题余弦 × 0.4
  → 摘要也缺失：标题 + concepts 的 BM25 × 0.5 + 主题余弦 × 0.5
```

任何一档都算不出（无 DOI 且无摘要无主题）→ semantic = null，UI 显示「不可用」，**不拿 0 冒充**。

## 2. Phase A：本地语义通道（零新请求，先做）

**2.1 BM25 打分器（新文件 `src/text-similarity.ts`）**

- 语料：当前图 seed + 候选节点的标题 + 摘要 + concepts
- 分词：英文按空格/标点 + 小写 + 停用词；中日韩文本退化为字 bigram（不切词也能工作）
- BM25 参数：k1=1.2, b=0.75；对每对 (seed, node) 算 BM25 分数后按批次内 min-max 归一到 0–1
- 纯函数、无请求、可离线单测

**2.2 合成 semanticScore**

```ts
semanticScore(node) = 0.6 × bm25Norm(seed, node) + 0.4 × topicSimilarity(seed, node)
```

`topicSimilarity` 直接复用现有函数（它返回 null 时该项剔除并重归一权重）。

**2.3 接入点**

- `selectNeighbors`：候选排序从纯 `citedByCount` 改为 `0.45×structural(seed) + 0.35×semantic + 0.20×authority`（authority 来自 3.7；3.7 未做时暂用 log(1+被引) 占位）
- `seedScore`：放射布局的距离编码改为结构+语义混合， hint 文案同步说明
- 详情关系卡：新增一条「文本相似度」meter（用现有 `paintMeter`，alt 配色），hint 标注「标题/摘要/主题，本地计算」

**验收**：离线单测覆盖（同标题高分、无关论文低分、无摘要降级、中文 bigram）；以一篇跨学科种子人工对比开关前后候选差异；`npm run perf` 300 节点耗时回归不明显劣化（BM25 是 O(n²·词表)，80 节点规模无感）。

## 2A. Phase A 落地备注（已上线，对本方案的一处有意偏离）

候选排序原设计为 `0.45×structural + 0.35×semantic + 0.20×authority`，实际落地时做了调整：**候选选择阶段结构分不可得**——候选的参考文献列表要等建图时才拉取，此时 `structural(seed)` 尚未计算。因此：

- `selectNeighbors` 排序用 `0.5×authority + 0.5×semantic`（semantic 缺失时退回纯 authority），authority 用归一化后的 impactScore（÷ 批次最大值）
- 结构分在建图完成后通过 `seedScore` 混合进入：`0.55×structural + 0.45×semantic`，语义缺失则保持纯结构原值
- 效果差异：原方案语义只影响候选挑选，落地版语义同时影响候选挑选（0.5 权重）和放射距离编码（0.45 权重），语义对最终呈现的影响实际更强

Phase B 若引入 embedding，沿用同样的两处接入点即可，无需改回三层混合。

## 3. Phase B：SPECTER2 向量（共用现有批量请求）

> ✅ 已落地（待发布），与方案的两处差异：
> 1. **降级粒度**：embedding 字段并入 `bulkCounts` 同一请求（零额外往返），但某一批次带 embedding 失败时自动降级为该批次的纯计数请求——语义功能永远不可能拖垮交叉比对。
> 2. **接入点**：向量在建图阶段才取回（候选选择之后），所以只进入展示用 `semanticScore`（0.75×向量余弦 + 0.25×主题余弦，单侧缺向量退回 Phase A 本地通道）与 seedScore 混合，**不参与候选排序**——候选排序仍是 Phase A 的 0.5×权威 + 0.5×本地语义。
> 图上记录 `semanticMode`（embedding/local）与 `semanticModel`（模型名，防向量空间漂移）；设置页新增「语义向量（SPECTER2）」开关（默认开，需先开交叉比对）。

**3.1 请求改造**

`bulkCounts` 的 `fields` 从 `citationCount,referenceCount,externalIds` 扩展为 `…,embedding`；返回的向量存入**仅内存**的 `Map<string, Float32Array>`（key 为论文 id），不进 settings、不进暂存持久化（768 维 × 80 篇 ≈ 240KB，随图重建即可）。

**3.2 相似度**

- seed↔node 余弦进 `semanticScore`（替代 Phase A 的 BM25 主项，主题余弦保留为辅助）：
  `semanticScore = 0.75 × embeddingCos + 0.25 × topicSimilarity`
- 记录 S2 返回的模型版本，版本变化时丢弃缓存重算（防向量空间漂移）

**3.3 降级与失败语义**

- 无 key / 429 / 格式错误 → 整张图静默退回 Phase A，状态栏一行「语义向量不可用，使用本地文本相似度」
- 单篇无向量（S2 未收录）→ 该篇单独退回 Phase A，不拖垮整图
- 设置页开关：`semanticEmbedding: boolean`（默认开，跟随现有 s2Reconcile 的总开关策略），关掉则永远不发 embedding 字段

**验收**：mock 批量返回部分 null 向量的单测；断网/429 降级路径单测；真实种子人工抽查 10 条高分候选是否确实语义相关。

## 4. Phase C：MMR 多样性与入选解释（已落地）

> ✅ 评审后按修正落地，不引入新请求、不碰 LLM、不做 pairwise embedding 边。

- **候选两两相似度**：`src/diversity.ts` 词项 TF 余弦（0.6）+ 主题余弦（0.4），对称、[0,1]、可空、按 id 对 memo。不用 seed 导向的 BM25（非对称、依赖 query/corpus）。SPECTER2 仍只在入选之后随批量核对取回。
- **MMR**：`λ × relevance − (1−λ) × max(与已选相似度)`。`λ` 是相关性权重，不是 0.3 扣减系数。默认 `MMR_LAMBDA = 0.7`（0.6–0.8 带内中值）。`npm run mmr-sweep` 在合成邻域上 diversity 几乎平坦，不把 0.7 当成测出的拐点。
- **入选原因**：`selectionRank: Map<id, {authority, semantic, relevance}>` 仅 picked、仅内存。详情折叠卡（面板 + embed）展示这三项，外加「建图后当前综合分」（未参与入选）。semantic 缺失保留 null。
- **embed cache**：`sampleDepth` / `s2Reconcile` / `semanticEmbedding` / OpenAlex key / S2 key 有无都进 cache key。
- **不做**：pairwise 全对 embedding 边。

## 5. 口径红线（沿用既有原则）

- UI 文案禁用「相关研究」「推荐阅读」这类暗示引用的词；统一叫「文本相似度 / 语义相似度」
- 语义分数不进 `GraphEdge.weight`（那是结构+引用的地盘），单独字段 `semanticScore?: number | null`
- LLM 未配置时本功能照常工作（不依赖 LLM）

## 6. 阶段拆解

| 阶段 | 内容 | 验收 | 建议版本 |
| --- | --- | --- | --- |
| A | BM25 + 主题余弦合成 semanticScore，接入排序与详情 meter | 单测全绿 + 人工对比 | 1.9.0（与暂存列表同批或紧随其后） |
| B | S2 embedding 并入批量请求、内存向量、降级链 | mock/降级单测 + 抽查 | 1.9.x |
| C | MMR 与入选解释 | 对称 pair sim + 标准 MMR + selectionRank 真值折叠卡；λ sweep 作观察脚本 | **1.9.x** |

## 7. 风险清单

1. **S2 限速**：无 key 共享池紧张——embedding 字段并入现有请求就是为了不增加请求数；失败降级 Phase A
2. **摘要缺失率**：OpenAlex 部分老文献无摘要，Phase A 有标题+concepts 兜底，最差退回 null 显示「不可用」
3. **多语言**：BM25 对中文用字 bigram；SPECTER2 本身对非英语论文质量下降，主题余弦辅助项缓解
4. **语义扎堆**：选择阶段没有结构分（0.5 权威 + 0.5 本地语义）；Phase C 用标准 MMR（λ=0.7）在 origin 配额内做多样性，pairwise 信号是词项/主题余弦而不是向量
5. **向量版本漂移**：S2 可能升级 embedding 模型，缓存带版本号，不匹配即弃
