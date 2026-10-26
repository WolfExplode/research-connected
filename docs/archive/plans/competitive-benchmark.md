# Research Connected 竞品对标与功能规划

> 访问日期：**2026-10-18**（下文所有外部链接均于该日访问）。
> 对象版本：`research-connected` v1.8.5（`manifest.json`，`isDesktopOnly: true`，`minAppVersion: 1.14.4`）。
> 方法：仓库现状以代码为准（README / USER_GUIDE / ROADMAP / proposal 与 `src/` 交叉核对）；竞品与 API 只引用官方站点、官方帮助中心、官方博客、官方 GitHub 仓库或官方 API 规范。确需引用的二手来源会标注 **（二手）**，无法从一手来源核实的说法标注 **（未核实）**。

---

## 0. 结论先行

- **定位上的空位是真实存在的**：所有文献地图竞品（Connected Papers、Litmaps、ResearchRabbit、Inciteful 等）都是云端账户制 Web 应用；Obsidian 生态里的文献插件（Zotero Integration、Citations）只做「把已有文献搬进笔记」，Smart Connections 只做「笔记之间的语义相似」。**「在笔记里、本地、无账户地探索引用邻域」目前只有本插件在做。**
- **最大的短板不是图谱算法，而是「图谱之后」的闭环**：竞品几乎都有新文献追踪（Litmaps Monitor、Semantic Scholar Alerts、ResearchRabbit 邮件更新、Undermind），多种子输入（Connected Papers multi-origin、Litmaps、Local Citation Network、Inciteful），以及与参考文献管理器的往返（Litmaps/ResearchRabbit/Inciteful ↔ Zotero）。本插件三者都没有。
- **建议的 P0 只有三项**：① 修正与 OpenAlex 现行文档不一致的分页参数（前置风险修复）；② 按项目「检查新文献」（拉取式、本地、无服务器）；③ 文献笔记管线 + 「已有笔记」标记（Properties / Bases 友好）。多种子图、基于暂存/排除反馈的推荐、Zotero 只读联动、JSON Canvas 导出排 P1。

---

## 1. 产品现状（已核对代码）

### 1.1 已发布能力

| 能力 | 代码依据 | 说明 |
| --- | --- | --- |
| 单种子相似性地图 | `src/neighborhood.ts`、`src/similarity.ts` | 种子可为 DOI / OpenAlex ID / 标题检索；分数 `0.55×耦合 + 0.35×共被引 + 0.10×直接引用`（USER_GUIDE「Algorithm」） |
| 采样深度三档 | `src/neighborhood.ts` L39–40 | standard / extended（`per_page` 200）/ deep（200×最多 5 页 cursor） |
| 语义通道 | `src/text-similarity.ts`、`src/diversity.ts`、`SemanticScholarClient.bulkCounts` | 本地 BM25 + 主题余弦；可选 SPECTER2 向量（并入 S2 `/paper/batch`）；MMR 多样性（proposal-5 A+B+C 已落地） |
| 多源证据 | `src/citation-sources.ts`、`src/citation-evidence.ts` | OpenAlex 主数据；S2 计数交叉比对、参考文献回填、摘要兜底、**引用语境 contexts / intents / isInfluential**（详情卡最多展示 5 条引文语境，`detail-cards.ts` L230）；Crossref 参考文献/摘要兜底；OpenCitations 引用核验 |
| 数据质量防线 | `neighborhood.ts`、`detail-cards.ts` | 非研究类型过滤、撤稿 ⚠、被引数错配 ⚠、候选诊断（Inspect） |
| 布局 | `src/layout-modes.ts` | Planar（力导向 + 社区着色）/ Timeline（年份为 X）/ Radial（相似度为半径） |
| 页签 | `graph-chrome.ts` `GraphTab` | graph / prior / derivative / research（LLM 研究脉络，默认关闭）/ staged / excluded |
| 研究项目 | `src/project-state.ts` | 按种子保存：快照 `SavedGraphSnapshot`、多个命名视图 `SavedView`、深挖批次 `DeepDiveBatch`、论文状态 `reading: unread/to-read/read`、`staged`、`excluded`；全部存于插件 `data.json` |
| 图编辑 | `src/graph-edit.ts` | 右键排除、Deep dive、Set as seed；深挖成员按种子记忆；撤销 |
| DOI 引用路径 | `src/doi-path.ts`、`main.ts` 命令 | 在已抓取 `referenceLists` 上做预算内 BFS |
| 导出 | `src/export-graph.ts` | BibTeX、YAML 列表、Markdown 表格、单篇笔记骨架（frontmatter：title/authors/year/doi/openalex）、暂存清单笔记 |
| 笔记内嵌 | `src/embed-block.ts`、`embed-syntax.ts`、`embed-mount.ts` | ` ```research-connected ` 代码块，支持 position/width/height/labels/maxNodes/depth/年份/筛选/layout/color |
| 隐私 | README | 无遥测；凭据明文存 `data.json`；LLM 默认关闭且仅手动生成 |

### 1.2 已确认缺失（代码中不存在）

- 无任何「新文献追踪 / 定期检查」逻辑（`project-state.ts` 无 lastChecked / seenIds 字段）。
- 只接受**单一种子**（`ResearchProject.seedId: string`；嵌入语法只解析一个 seed）。
- 不读取 Zotero、`.bib` 或 vault 内已有文献笔记；不知道某篇论文是否「已在库 / 已有笔记」。
- `createVaultNote`（`src/vault-note.ts`）只写入 **vault 根目录**，无文件夹/模板配置，不回写 frontmatter。
- 导出无 RIS / CSL-JSON；无 `.canvas` 导出；快照只在 `data.json` 内，不能作为文件分享。
- 无作者视角（ROADMAP §10 已改为「作者网络可以做」，尚未实现）。

### 1.3 ROADMAP 标记

ROADMAP 第 8 节阶段 0–6 全部标为 ✅；§9「聚焦邻域」暂缓；§10 明确不做机构网络、BI 仪表盘、把采样/LLM 包装为完整学术史。产品定位为「Obsidian 里的单篇种子论文相似性地图」（ROADMAP §1）——**下文 P1-1「多种子图」与此定位直接冲突，需要产品决策**。

### 1.4 顺带发现的 API 合规风险（影响 P0）

- OpenAlex 现行认证文档写明 **`per_page` 最大 100**，且 **cursor 翻页超过第一页需要免费 API key**（[OpenAlex Authentication](https://help.openalex.org/api/authentication/)）。而 `neighborhood.ts` extended/deep 档位使用 `per_page: 200`，deep 档使用 cursor 多页。2026-10-18 实测 `per_page=200` 无 key 仍返回 200 条（文档与线上行为不一致），因此**当前未坏，但随时可能被收紧**；无 key 时 deep 档可能只拿到第一页而用户不知情。
- OpenAlex 单个 filter 的 OR 值上限为 100（同上文档）；现有批量 ID 查询每批 ≤80，合规。

---

## 2. 竞品调研（一手来源）

### 2.1 文献地图类

**Connected Papers**
- 定位：输入一篇典型论文，生成该领域相似论文图；提供 Prior Works（祖先工作）与 Derivative Works（综述与后续 SOTA）视图；数据来自 Semantic Scholar 数据库（[Premium 页](https://www.connectedpapers.com/premium)）。
- Multi-origin graphs：可把任意节点加为第二、第三……个 origin，重建一张「与所有 origin 都相似」的图；官方称这是社区「最多请求的功能」，Free 与 Premium 均可用（[官方博客](https://medium.com/connectedpapers/announcing-premium-accounts-multi-origin-graphs-and-more-92e8dbd66848)）。
- 所有计划包含：相似图、Prior/Derivative、Multi-origin、Saved papers、Graph history；免费每月 5 张图（[Pricing](https://www.connectedpapers.com/pricing)）。付费价格（Academic $6/月、Business $20/月）仅见于二手来源 **（未核实）**。
- 未见官方文档提及：新文献提醒、Zotero 同步、笔记/注释。

**Litmaps**
- 地图：点=文章、线=引用关系；坐标轴可在 Cite Count / Ref Count / Publication Date / Momentum / Map Connectivity 间切换（[Visualization 帮助](https://docs.litmaps.com/en/articles/9181490-use-and-edit-litmaps-visualization)）。
- 三种检索算法：Shared Citations & References（默认，单篇时取引用/参考/共被引中最互联者，多篇时取所有输入的互联）、Common Authors、Similar Text（基于标题摘要语义，唯一不用引用的算法）（[Search Algorithms](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)）。
- 多输入：可选多篇起始文章，「More Like This」把文章加入地图并作为下一轮输入；可从 Zotero 同步或导入 BibTeX / RIS / PubMed 对整个库检索（[Search 帮助](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps)）。
- Monitor：对已有 Litmap 定期重跑检索并邮件提醒新文章；所有用户可用，Pro 可自定义频率（每周/每月）、算法与过滤（[Monitor](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)）。
- Zotero Sync（Pro）：Zotero Collection ↔ Litmaps Tag 双向同步增删与元数据编辑（[Zotero Sync](https://docs.litmaps.com/en/articles/9421968-sync-zotero-with-litmaps)；[Litmaps Pro](https://docs.litmaps.com/en/articles/8115278-litmaps-pro)）。
- 价格页：Free 为 Basic Search、最多 20 个输入；Pro 教育版 $10*/月起（[Pricing](https://www.litmaps.com/pricing)）。同一页面对 Free 的地图数量同时出现「2 Litmaps」与「1 Litmap」两种写法 **（页面自相矛盾，未核实）**。

**ResearchRabbit**
- 定位：以种子论文为起点「turn one paper into a map of ideas」，推荐随用户探索而学习（[官网](https://www.researchrabbit.ai/)）。
- Recently Found（探索暂存）与 Collections / 多级 Subcollections（整理）分离（[Collections](https://learn.researchrabbit.ai/en/articles/12454600-organizing-your-articles-with-collections)）。
- Zotero Importer：从 Zotero Collection 导入；回写 Zotero 目前只能导出 BibTeX，双向同步「正在开发」（[Zotero Importer](https://learn.researchrabbit.ai/en/articles/12796541-using-the-zotero-importer)）。
- 免费版：最多 50 个起始文章、引用地图、Collections、共享协作者或公开链接、BibTeX 导入导出、笔记/贴纸/颜色（[Free Tier](https://learn.researchrabbit.ai/en/articles/12865509-researchrabbit-free-tier)）；导出支持 BibTeX / RIS / CSV（[Sharing](https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections)）。
- RR+：$10/月（按国家购买力折扣），最多 300 个种子、高级检索、多项目、「Signals alerts to protect research integrity」（[Pricing](https://www.researchrabbit.ai/pricing)）。
- 「Email Updates / Rabbit Radar 每周新文献邮件」与「Timeline 视图」仅见于高校图书馆指南 **（二手，新版产品中未核实）**。

**Inciteful**
- 以一篇或多篇论文（可导入 BibTeX）建引用网络，迭代加入相关论文，用 link prediction 找「最相似」而非只看被引；结果可导出到 Zotero、Mendeley 等；免费（[官网](https://inciteful.xyz/)）。
- Literature Connector：输入两篇论文，展示两者之间的最短引用路径，最多 6 跳；暂不支持多对多或非最短路径（[Literature Connector](https://inciteful.xyz/c)）。

**Local Citation Network**
- 基于 OpenAlex / Semantic Scholar / Crossref / Zotero Cita 数据，对一组种子文章计算 Top Cited / Top Citing；种子可来自单篇的参考文献，或扫描任意纯文本（如 `.ris` / `.bib`）中的 DOI；最多同时 5 个网络标签页；可下载完整网络 JSON 分享与重载；提供在期刊网页上使用的 bookmarklet（[官网 FAQ](https://localcitationnetwork.github.io/)）。

**Citation Gecko**
- 多种子（DOI、BibTeX、检索、Zotero 导入），在「被种子引用 / 引用种子」两种图间切换，可把连接论文加为新种子（[gecko-react README](https://github.com/CitationGecko/gecko-react)）。旧仓库已归档（[citation-network-explorer](https://github.com/CitationGecko/citation-network-explorer)）。「已停止开发」仅见于图书馆指南 **（二手）**。

**VOSviewer / CitNetExplorer**
- VOSviewer：构建期刊、研究者或文献网络，关系可为引用、文献耦合、共被引或合著；支持术语共现文本挖掘；1.6.21（2026-06-12）改进 OpenAlex 查询并支持 API key；VOSviewer Online 用于分享和嵌入交互可视化（[VOSviewer](https://www.vosviewer.com/)）。
- CitNetExplorer：分析研究领域随时间的发展、按引用关系划定主题文献、支持系统综述中的前后向引用检索（[CitNetExplorer](https://www.citnetexplorer.nl/)）。

**Open Knowledge Maps**
- 基于检索词的主题知识地图：AI 流水线按主题相似聚类并为区域打概念标签，突出开放获取资源；覆盖 4 亿+研究产出、25+ 种产出类型；可视化框架 Headstart 开源（[About](https://openknowledgemaps.org/about)）。

### 2.2 AI / 语义发现类

**Semantic Scholar（产品）**
- Research Feeds：基于 Library 文件夹，每日刷新推荐；保存=正信号，「not relevant」=负信号（[Research Feeds FAQ](https://www.semanticscholar.org/faq/create-research-feeds)）。
- Alerts：Author（新论文/新引用）、Paper（新引用）、Topic、Research Feed 四类；频率每天或每周（[FAQ · Alerts](https://www.semanticscholar.org/faq)）。
- TLDR：AI 生成的一句话摘要，**目前仅限计算机科学与生物医学领域**（[FAQ](https://www.semanticscholar.org/faq)；[TLDR](https://www.semanticscholar.org/product/tldr)）。
- Semantic Reader：在阅读位置显示引用卡片（含 TLDR），面向大多数 arXiv 论文（[Semantic Reader](https://www.semanticscholar.org/product/semantic-reader)）；内置 Hypothesis 注释已于 2024 年 1 月停止（[FAQ](https://www.semanticscholar.org/faq)）。

**Semantic Scholar（API，与实现相关）**
- 服务：Academic Graph（含 SPECTER2 embeddings）、Recommendations、Datasets；未认证共享 1000 RPS 且可能被限流；API key 入门限额 1 RPS（[API Overview](https://www.semanticscholar.org/product/api)）。
- Recommendations：`POST /recommendations/v1/papers/` 接受**正例与负例论文列表**；`GET /papers/forpaper/{paper_id}` 单篇正例，`from` 取值 `recent` 或 `all-cs`；`limit` 最大 500（[Recommendations API 规范](https://api.semanticscholar.org/recommendations/v1/swagger.json)；[文档页](https://api.semanticscholar.org/api-docs/recommendations)）。
- Graph：`/paper/{id}/citations` 与 `/references` 支持 `fields=contexts,intents,isInfluential`；Paper 对象含 `tldr`、`embedding` 字段；`/paper/search/bulk` 支持 `publicationDateOrYear` 过滤、每次最多 1000 条、续页 token，但不返回嵌套引用数据（[Graph API 规范](https://api.semanticscholar.org/graph/v1/swagger.json)；[文档页](https://api.semanticscholar.org/api-docs/graph)）。

**Elicit**
- 三种工作流：Research Agent、Research Report（全部计划）、Systematic Review（Pro 及以上，检索→题摘筛选→全文筛选→数据抽取→PRISMA 式报告）（[Getting started](https://support.elicit.com/en/articles/14757543-getting-started-with-elicit-which-workflow-should-i-use)；[Systematic Reviews](https://support.elicit.com/en/articles/14759154-systematic-reviews-in-elicit)）。
- **Alerts 正在退役**：2026-09-30 起不能新建，2026-10-31 停止运行，由消耗用量的 Routines 取代（[Alerts (Legacy)](https://support.elicit.com/en/articles/14757570-elicit-alerts-legacy-tool)）。
- 价格：Basic 免费；Pro $49/用户/月（年付）；Scale $169/用户/月（年付）；Basic 含「Import from Zotero」（[Pricing](https://elicit.com/pricing)）。

**Consensus**
- Consensus Meter：针对是/否问题分析前 20 篇论文，至少 5 篇相关才显示 Yes/No/Possibly/Mixed 分布（[Consensus Meter](https://help.consensus.app/en/articles/10069920-the-consensus-meter)）。
- Study Snapshot：AI 抽取人群、样本量、时长、地点、方法、结局、结果（[Study Snapshot](https://help.consensus.app/en/articles/10065008-using-the-study-snapshot)）。
- 价格：Free（10 次 Snapshot/月等）、Pro $20/月或 $144/年、Deep $65/月或 $540/年（[Subscription Plans](https://help.consensus.app/en/articles/10087865-subscription-plans)）。

**scite**
- Smart Citations：深度学习模型按修辞功能把引文语句分为 supporting / contrasting / mentioning（不是情感极性）（[分类说明](https://help.scite.ai/en-us/article/how-are-citations-classified-1a9j78t/)）。
- 免费 Zotero 插件：在 Zotero 库中增加 Supporting / Contrasting / Mentioning / Total Smart Citations / Distinct Citing Publications 列，无需账户或 key（[Zotero 插件文档](https://docs.scite.ai/guides/zotero-plugin)）。

**Undermind**
- 深度检索：异步运行数分钟，自行规划检索、跟随引用与关键作者，在新检索不再找到相关论文时停止，产出排序列表与综述；提供 MCP 工具（`launch_deep_search`、`search_papers` 等）（[Undermind MCP](https://www.undermind.ai/mcp)）。
- 「Stay up to date: Get notified whenever relevant papers are published」（[官网](https://www.undermind.ai/)）。价格未从官方页面获取 **（未核实）**。

### 2.3 参考文献管理与 Obsidian 生态

**Zotero 本地 API**
- Zotero 桌面端在 `localhost:23119/api/` 暴露 Web API v3 的本地实现，离线、无速率限制；需在设置中开启「Allow other applications on this computer to communicate with Zotero」，否则 403；**读请求无需认证**；写请求需 Zotero 10+ 且用户在弹窗中授权本地 key；只能访问本机登录用户（user ID 用 `0`）；默认不分页（[Zotero Local API](https://www.zotero.org/support/dev/web_api/v3/local_api)）。

**Better BibTeX（BBT）**
- 稳定、确定性的 citekey，可固定；支持拖放 `[@citekey]` 到 Markdown（[Citation Keys](https://retorque.re/zotero-better-bibtex/citing/)）。
- JSON-RPC：`http://localhost:23119/better-bibtex/json-rpc`，方法含 `item.search`、`item.export`、`item.bibliography`、`item.citationkey`、`item.collections`、`autoexport.add` 等（[JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/)）。
- Pull export：`http://127.0.0.1:23119/better-bibtex/collection?/0/<id>.<format>`，格式含 biblatex / bibtex / csljson / cslyaml（[Pull export](https://retorque.re/zotero-better-bibtex/exporting/pull/)）。

**Obsidian Zotero Integration**：依赖 BBT，把 Zotero 的引文、参考文献表、笔记和 PDF 注释插入/导入 Obsidian（[README](https://github.com/mgmeyers/obsidian-zotero-integration)）。

**Obsidian Citations**：读取 BibTeX/BibLaTeX 或 CSL-JSON 导出（推荐 BBT「Keep updated」），提供「打开文献笔记」「插入文献笔记链接」「插入 Pandoc 引文」，文献笔记标题/文件夹/内容可用 `{{citekey}}`、`{{DOI}}`、`{{abstract}}` 等变量模板化（[README](https://github.com/hans/obsidian-citation-plugin)）。

**Smart Connections**：内置本地 embedding 模型、默认私有离线、无需 API key，按语义相似度显示与当前笔记相关的笔记；Pro 提供 Bases 集成（`score_connection`、`list_connections`）（[README](https://github.com/brianpetro/obsidian-smart-connections)）。

**Obsidian 平台约束**
- `requestUrl()`：类似 `fetch()`，无 CORS 限制（[requestUrl](https://docs.obsidian.md/Reference/TypeScript+API/requestUrl)）。
- `FileManager.processFrontMatter()`：原子地读改写笔记 frontmatter（[processFrontMatter](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter)）。
- Bases：核心插件，以笔记 Properties 为数据的表格/卡片/列表等视图，数据存于本地 Markdown，可保存为 `.base` 或嵌入代码块；社区插件可增加布局（[Bases](https://help.obsidian.md/bases)）；插件用 `registerBasesView` 注册自定义 Bases 视图（[Build a Bases view](https://docs.obsidian.md/plugins/guides/bases-view)），相关 API 自 1.10.0 起提供（[BasesViewConfig](https://docs.obsidian.md/Reference/TypeScript+API/BasesViewConfig)）——本插件 `minAppVersion` 1.14.4 可用。
- Canvas 文件格式 JSON Canvas 1.0：nodes（text / file / link / group，含 x/y/width/height/color）与 edges（fromNode/toNode、fromEnd/toEnd 箭头、label、color）（[JSON Canvas Spec](https://jsoncanvas.org/spec/1.0/)）。
- 社区目录政策：禁止客户端遥测、禁止自更新；网络使用、访问 vault 之外文件须在 README 明示（[Developer policies](https://docs.obsidian.md/community-directory/developer-policies)）。

**OpenAlex（实现相关）**
- `cites:` / `cited_by:` 过滤语义（[filter-works](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md)）。
- `from_publication_date` 免费，但官方提示按出版日期取「最新」不可靠；`from_created_date` / `from_updated_date` 需付费计划（[filter-works](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md)；[Filtering](https://help.openalex.org/api/filtering/)）。
- 速率：无 key 10 RPS，免费 key 30 RPS；免费 key 日预算为无 key 的 10 倍；`per_page` 最大 100；cursor 翻页过第一页需 key（[Authentication](https://help.openalex.org/api/authentication/)）。
- `search.semantic`：对标题+摘要的 GTE Large EN 1024 维向量做余弦检索，输入 ≤2000 字符，最多 50 条，1 RPS，可与大多数 filter 组合（不支持 `cited_by_count`）（[Semantic Search](https://developers.openalex.org/guides/semantic-search)）。

---

## 3. 功能矩阵

图例：✓ 有；◐ 部分；✗ 无/未见官方说明；— 不适用。每格依据见第 2 节对应来源。

| 维度 | 本插件 | Connected Papers | Litmaps | ResearchRabbit | Inciteful | Local Citation Network | Semantic Scholar | Elicit / Consensus / Undermind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 共被引/耦合相似图 | ✓ | ✓ | ✓（Shared Citations） | ◐（引用地图） | ✓（link prediction） | ◐（Top Cited/Citing） | ✗ | ✗ |
| 多种子输入 | ✗ | ✓ multi-origin | ✓ | ✓（免费 50 / RR+ 300） | ✓ | ✓ | ◐（Feed 文件夹） | — |
| 从库/`.bib` 导入种子 | ✗ | ✗ | ✓ Zotero/BibTeX/RIS | ✓ Zotero/BibTeX | ✓ BibTeX | ✓ 扫描 DOI | ✗ | Elicit ✓ Zotero 导入 |
| 时间轴视图 | ✓ Timeline | ✗ | ✓ 可选坐标轴 | ◐（二手） | ✗ | ✗ | ✗ | ✗ |
| 先验/衍生列表 | ✓ | ✓ | ◐ | ✓ | ◐ | ✓ | ✗ | ✗ |
| 新文献追踪 | ✗ | ✗ | ✓ Monitor | ◐（二手 / RR+ Signals） | ✗ | ✗ | ✓ Alerts/Feeds | Elicit Routines（Alerts 退役）、Undermind ✓ |
| 基于用户反馈的推荐 | ✗ | ✗ | ✓ More Like This | ✓ | ✓ 迭代加图 | ✗ | ✓ 正/负信号 | ✓（Agent） |
| 集合/阅读状态 | ✓ 项目内暂存/已读/排除 | ◐ Saved papers | ✓ Tags | ✓ 多级 Collections | ✗ | ✗ | ✓ Library | ✓ |
| 引用语境（引文句） | ✓ S2 contexts/intents | ✗ | ✗ | ✗ | ✗ | ✗ | ✓（Reader 引用卡片） | scite ✓ 分类 |
| AI 摘要/综述 | ◐ 可选 BYO-LLM 研究脉络 | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ TLDR（限领域） | ✓ |
| 两点引用路径 | ✓ 预算内 | ✗ | ✗ | ✗ | ✓ ≤6 跳 | ✗ | ✗ | ✗ |
| 数据质量警示（撤稿等） | ✓ | ✗ | ✗ | ◐ RR+ Signals | ✗ | ✗ | ✗ | ✗ |
| 分享 | ✗（仅 vault 内嵌） | ✗ | ✓ Team | ✓ 公开链接/协作者 | ✗ | ✓ JSON 文件 | ✗ | Elicit 只读链接 |
| Zotero 往返 | ✗ | ✗ | ✓ 双向（Pro） | ◐ 导入 + BibTeX 导出 | ◐ 导出 | ◐ Zotero Cita 数据 | ✗ | ◐ |
| 导出格式 | BibTeX/YAML/MD 表 | ✗ | BibTeX/RIS 导入 | BibTeX/RIS/CSV | ✓ | JSON | ✗ | CSV 等 |
| 在笔记内工作 | ✓ 代码块嵌入 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 无账户、本地存储 | ✓ | ✗ | ✗ | ✗ | ◐ 免费；账户要求未核实 | ◐ 网络以 JSON 文件下载保存 | ✗ | ✗ |

Obsidian 生态对照：Zotero Integration / Citations 只处理「已入库文献 → 笔记」，不做发现；Smart Connections 做「笔记 ↔ 笔记」语义相似，不涉及外部文献。三者与本插件**互补而非重叠**。

---

## 4. 差异化与短板

**独有或领先**
1. **笔记内交互图谱**：代码块嵌入在 Reading / Live Preview 中渲染完整交互地图；竞品均为独立 Web 应用。
2. **本地、无账户、无遥测**：项目、视图、快照全部在 vault 的 `data.json`；符合 Obsidian「private and offline」导向（[Developer policies](https://docs.obsidian.md/community-directory/developer-policies)）。
3. **证据透明**：边证据多源标注、S2 引文语境、撤稿/错配/非研究类型警示、候选诊断。竞品官方文档中未见同等粒度的数据质量说明。
4. **开放数据 + 自带 key**：OpenAlex / S2 / Crossref / OpenCitations，无配额墙（Connected Papers 免费每月 5 张图）。

**落后**
1. **无「之后」的闭环**：不会告诉用户「项目里有新论文了」——这是 Litmaps、Semantic Scholar、Undermind、Elicit 的共同卖点。
2. **单种子**：Connected Papers 把 multi-origin 称为最多请求的功能；几乎所有竞品都支持多输入。
3. **与 vault / 文献库脱节**：图上看不出哪篇已经有笔记、已在 Zotero；导出笔记只有骨架且落在根目录。
4. **推荐不学习**：暂存/排除状态已有，但不反馈给候选生成；S2 Recommendations 原生支持正负例。
5. **无可分享产物**：快照只在插件数据里；Local Citation Network 的「下载 JSON 再加载」、VOSviewer Online 都说明「可携带的图文件」有价值。

---

## 5. 功能规划

原则：只做能复用现有模块、无需服务器、符合 Obsidian 本地优先的功能；每项都能指出至少一个竞品官方文档作为需求验证。

### P0（下一到两个版本）

#### P0-0 OpenAlex 分页参数对齐现行文档（前置风险修复）
- **是什么**：extended/deep 档 `per_page` 从 200 降到文档上限 100（页数相应加倍以保持采样量）；无 OpenAlex key 时 deep 档明确降级为单页并在状态栏说明，而不是静默少拿数据。
- **依据**：`per_page` 最大 100、cursor 过第一页需 key（[OpenAlex Authentication](https://help.openalex.org/api/authentication/)）。线上暂时仍接受 200（2026-10-18 实测），属文档与行为不一致。
- **实现**：`src/neighborhood.ts` 档位常量；`src/openalex.ts` `listFilter` 的 cursor 分支检查是否配置 key；`RetrievalStats` 记录「因无 key 截断」。
- **成本**：S。**风险**：请求数增加约一倍（deep 档约 20 → 30 次），需更新 USER_GUIDE 中的请求数说明。

#### P0-1 项目「检查新文献」（拉取式、无服务器）
- **是什么**：对每个研究项目记录 `lastCheckedAt` 与已见 ID 集合；用户点击「检查更新」（或可选：Obsidian 启动后对最近 N 个项目检查一次），列出自上次以来**新出现的、引用种子或引用已暂存论文的作品**，作为「新」徽标进入现有 derivative / staged 页签；可一键加入图或暂存。不发邮件、不后台常驻。
- **竞品验证**：Litmaps Monitor 对已有地图定期重跑检索（[Monitor](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)）；Semantic Scholar Paper Alerts 追踪「论文新引用」（[FAQ](https://www.semanticscholar.org/faq)）；Undermind「Get notified whenever relevant papers are published」（[官网](https://www.undermind.ai/)）。Elicit 把 Alerts 改为消耗用量的 Routines（[Elicit Alerts](https://support.elicit.com/en/articles/14757570-elicit-alerts-legacy-tool)），说明「追踪」仍是核心需求，但纯推送式提醒的形态在变化——本地拉取式正好不受账户/服务器成本约束。
- **为何契合**：数据留在 `data.json`；不需要服务器；与「研究项目」概念天然对齐（项目已经有 seed、staged、excluded）。
- **实现草图**：
  - 查询：`GET /works?filter=cites:{seed}|{staged1}|…,from_publication_date:{lastChecked-缓冲}&sort=publication_date:desc&per_page=100`。OR 值 ≤100（[Authentication](https://help.openalex.org/api/authentication/)），`cites` 语义见 [filter-works](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md)。
  - **不要只靠出版日期判断「新」**：官方提示出版日期不可靠，而 `from_created_date` 需付费（[filter-works](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md)）。因此用「出版日期回看窗口（如 lastChecked − 90 天）+ 本地 seenIds 差集」判定新增。
  - 可选第二信号：S2 Paper 的 citations 端点（[Graph API 规范](https://api.semanticscholar.org/graph/v1/swagger.json)）交叉补漏，复用 `SemanticScholarClient`。
  - 落位：`project-state.ts`（`ResearchProject` 增加 `watch?: { lastCheckedAt; seenIds; newIds }`，`version` 保持向后兼容的可选字段）；新纯函数 `src/project-watch.ts`（差集与排序，可离线单测）；`app.ts` 只做按钮与徽标接线；启动检查用 `registerInterval`/`onLayoutReady` 且默认关闭。
- **成本**：M。**风险**：OpenAlex 新作品入库滞后导致漏报（文案须写「OpenAlex 已收录的新引用」）；被引极多的种子单次返回过多，需要上限与「仅显示与项目语义相近的前 N 篇」（复用 `text-similarity.ts` 排序）。

#### P0-2 文献笔记管线 + 「已有笔记」标记
- **是什么**：
  1. 设置项：文献笔记文件夹、文件名模板、正文模板（变量：`{{title}} {{authors}} {{year}} {{doi}} {{openalex}} {{relation}} {{project}}`）。
  2. 笔记 frontmatter 写入稳定键（`doi`、`openalex`、`rc-project`、`rc-status`），阅读状态在 frontmatter 与项目 `reading` 之间同步（用 `processFrontMatter`）。
  3. 图上节点若 vault 中已有 `doi`/`openalex` 匹配的笔记，显示「已有笔记」标记，详情卡提供「打开笔记」；附一个示例 `.base` 文件，让用户用 Bases 表格管理「本项目的文献笔记」。
- **竞品验证**：Obsidian Citations 的文献笔记文件夹/模板变量（[README](https://github.com/hans/obsidian-citation-plugin)）；Zotero Integration 把文献导入笔记（[README](https://github.com/mgmeyers/obsidian-zotero-integration)）；Smart Connections 投入 Bases 集成（[README](https://github.com/brianpetro/obsidian-smart-connections)）；ResearchRabbit 把「探索暂存」与「整理集合」分开（[Collections](https://learn.researchrabbit.ai/en/articles/12454600-organizing-your-articles-with-collections)）——本插件的「暂存 → 写成笔记」即对应路径。
- **为何契合**：这是 Web 竞品**结构上做不到**的能力；数据以 Markdown + Properties 形式留在 vault（[Bases](https://help.obsidian.md/bases)），卸载插件也不丢。
- **实现草图**：扩展 `export-graph.ts` 的 `noteSkeleton` 为模板渲染；`vault-note.ts` 增加目标文件夹；用 `app.metadataCache` 遍历 frontmatter 建立 `doi → TFile` 索引（监听 `metadataCache.on("changed")` 增量更新）；`paper-actions.ts` 增加「打开笔记」按钮；状态同步走 `FileManager.processFrontMatter`（[文档](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter)）。
- **成本**：M。**风险**：用户已有 Zotero Integration / Citations 的笔记约定（如 `citekey` 键名）——允许配置「DOI 所在属性名」以识别他人生成的笔记；双向同步需定义冲突规则（以最后修改时间为准，或只做「笔记 → 项目」单向）。

### P1

#### P1-1 多种子（seed set）地图
- **是什么**：以 2–N 篇论文为 origin 建图：来源可以是当前图的节点（「加为 origin」）、项目暂存清单，或当前笔记 / 代码块中列出的多个 DOI（`seeds:` 语法）。
- **竞品验证**：Connected Papers multi-origin，「most requested feature」（[博客](https://medium.com/connectedpapers/announcing-premium-accounts-multi-origin-graphs-and-more-92e8dbd66848)）；Litmaps 多输入（[Search Algorithms](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)）；Local Citation Network 从 `.bib`/`.ris` 扫描 DOI 作种子（[FAQ](https://localcitationnetwork.github.io/)）；Inciteful、Citation Gecko 同样多种子（[Inciteful](https://inciteful.xyz/)；[gecko-react](https://github.com/CitationGecko/gecko-react)）。
- **为何契合**：笔记本身就是「一组相关论文」的天然容器——「从这篇笔记里的 DOI 建图」是 Obsidian 独有入口。
- **实现草图**：`neighborhood.ts` 对每个 origin 并集采样（共享预算），相似分取各 origin 的平均或最小值（需离线评测选择）；`ResearchProject.seedId` 改为由排序后的 seed 列表生成的稳定 key（迁移：单种子 key 不变）；`embed-syntax.ts` 增加 `seeds:`；`layout-modes.ts` 的 Radial 以「多 origin 的质心」为中心。
- **成本**：L。**风险**：**与 ROADMAP §1「单篇种子」定位冲突，需先做产品决策**；请求数随种子数线性增长（OpenAlex 预算）；Radial/「种子」双环等视觉语义要重新定义。

#### P1-2 基于暂存/排除的反馈推荐通道
- **是什么**：把项目中 `staged` 作为正例、`excluded` 作为负例，调用 S2 Recommendations 得到候选，放在独立的「推荐」列表（不进入结构边，延续「相似 ≠ 引用」口径），可一键加入图。
- **竞品验证**：Semantic Scholar Research Feeds 使用保存=正信号、「not relevant」=负信号（[Research Feeds](https://www.semanticscholar.org/faq/create-research-feeds)）；Litmaps「More Like This」（[Search 帮助](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps)）；ResearchRabbit「随探索学习」（[官网](https://www.researchrabbit.ai/)）。
- **实现草图**：`POST https://api.semanticscholar.org/recommendations/v1/papers/`，body 为正/负 paper ID 列表，`limit` ≤500（[规范](https://api.semanticscholar.org/recommendations/v1/swagger.json)）；DOI → S2 ID 复用 `bulkCounts` 返回的 `externalIds`；结果经现有 MMR（`diversity.ts`）去冗余。备选/补充：OpenAlex `search.semantic` 以种子摘要为查询（[Semantic Search](https://developers.openalex.org/guides/semantic-search)）。
- **成本**：M。**风险**：S2 key 入门限额 1 RPS、无 key 共享池可能被限流（[API Overview](https://www.semanticscholar.org/product/api)）；`forpaper` 的 `from` 只有 `recent` / `all-cs`，**非 CS 领域覆盖度未核实**；OpenAlex 语义检索仅英文模型（GTE Large EN），对中文文献效果存疑。

#### P1-3 Zotero 只读联动 + 更多导出格式
- **是什么**：（a）可选开启后，节点若在本机 Zotero 库中（按 DOI 匹配）显示「在 Zotero」标记；（b）导出增加 RIS 与 CSL-JSON；（c）若检测到 BBT，导出 BibTeX 时复用 BBT citekey 而不是自造 key。
- **竞品验证**：Litmaps Zotero 双向同步（[Zotero Sync](https://docs.litmaps.com/en/articles/9421968-sync-zotero-with-litmaps)）；ResearchRabbit Zotero Importer + BibTeX/RIS/CSV 导出（[Importer](https://learn.researchrabbit.ai/en/articles/12796541-using-the-zotero-importer)；[Sharing](https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections)）；scite 把引用信息做成 Zotero 列（[scite Zotero](https://docs.scite.ai/guides/zotero-plugin)）。
- **实现草图**：经 `requestUrl`（无 CORS，[文档](https://docs.obsidian.md/Reference/TypeScript+API/requestUrl)）请求 `http://localhost:23119/api/users/0/items?…`（读无需认证，需用户在 Zotero 中开启本地 API，[Zotero Local API](https://www.zotero.org/support/dev/web_api/v3/local_api)）；citekey 用 BBT JSON-RPC `item.search` / `item.citationkey`（[JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/)）；导出新增函数放在 `export-graph.ts`。
- **成本**：M。**风险**：README 需按政策明示访问本机服务（[Developer policies](https://docs.obsidian.md/community-directory/developer-policies)）；本地 API 的 DOI 检索能力与性能未实测（默认不分页，大库需分页或缓存）；**不做写入**（Zotero 写入需 10+ 且每次弹窗授权，且与 Zotero Integration 职责重叠）。

#### P1-4 导出为 Obsidian Canvas（`.canvas`）
- **是什么**：把当前视图（节点位置、关系类型颜色、方向箭头）导出为 JSON Canvas 文件；节点为 link（OpenAlex/DOI）或 file（若已有文献笔记，接 P0-2）。用户可在原生 Canvas 中自由批注、分组、与其他笔记连线。
- **竞品验证**：Local Citation Network 可下载网络 JSON 分享与重载（[FAQ](https://localcitationnetwork.github.io/)）；VOSviewer Online 用于分享和嵌入（[VOSviewer](https://www.vosviewer.com/)）；ResearchRabbit 官方甚至建议用截图分享地图（[Sharing](https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections)），说明可携带的图产物有需求。
- **实现草图**：从 `map-canvas.ts` 当前布局坐标取 x/y，按 [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) 生成 nodes/edges（`toEnd: "arrow"` 表示直接引用，`fromEnd/toEnd: "none"` 表示共被引/耦合，`label` 写关系简述）；`ExportKind` 加 `canvas`，写文件复用 `vault-note.ts`。
- **成本**：S。**风险**：导出是一次性快照，不随图更新（文案明示）；大图（300 节点）在 Canvas 中可能拥挤，默认只导出可见节点。

### P2（观察需求后再做）

| 功能 | 竞品验证 | 实现方向 | 成本 | 主要风险 |
| --- | --- | --- | --- | --- |
| 作者视角（种子图中的高频作者、其近期作品） | Litmaps Common Authors（[算法](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)）；S2 Author Alerts（[FAQ](https://www.semanticscholar.org/faq)）；ROADMAP §10 已允许 | `aggregates.ts` 聚合 `authorships`；OpenAlex `author.id` 过滤（[Filtering](https://help.openalex.org/api/filtering/)） | M | 作者消歧错误（USER_GUIDE 已列为已知问题） |
| 详情卡 TLDR | S2 TLDR（[TLDR](https://www.semanticscholar.org/product/tldr)） | `/paper/batch` 已在调用，加 `tldr` 字段（[规范](https://api.semanticscholar.org/graph/v1/swagger.json)） | S | 仅 CS 与生物医学（[FAQ](https://www.semanticscholar.org/faq)），其他领域大量空白 |
| 快照作为 vault 文件（可同步、可分享、可重载） | Local Citation Network JSON（[FAQ](https://localcitationnetwork.github.io/)） | `SavedGraphSnapshot` 序列化到 vault 内 `.json`，`data.json` 只存引用 | M | 文件体积（快照含 catalog 与引用列表）；版本迁移 |
| 自定义 Bases 视图：把一个 base 中带 DOI 的笔记画成引用图 | Bases 允许插件注册视图（[Build a Bases view](https://docs.obsidian.md/plugins/guides/bases-view)） | `registerBasesView` + 复用 `map-canvas.ts`，以 base 结果为 seed set（依赖 P1-1） | L | 依赖多种子；Bases API 较新 |
| 「相似文本」候选通道 | Litmaps Similar Text（[算法](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)）；OpenAlex `search.semantic`（[Semantic Search](https://developers.openalex.org/guides/semantic-search)） | 以种子标题+摘要查询，结果只作候选，不画结构边 | S–M | 1 RPS、最多 50 条、英文模型 |

### 明确不做

| 不做 | 理由 |
| --- | --- |
| 邮件/推送式提醒、后台常驻服务 | 需要服务器与账户，违背本地优先；P0-1 拉取式已覆盖核心价值。Elicit 也把 Alerts 改为计费的 Routines（[来源](https://support.elicit.com/en/articles/14757570-elicit-alerts-legacy-tool)），推送式运营成本不低 |
| 账户、协作者、公开链接分享 | 需服务器；Obsidian Sync / Git 已能同步 vault，P1-4 / P2 快照文件足够 |
| PDF 阅读、高亮注释 | Zotero + Zotero Integration（导入 PDF 注释，[README](https://github.com/mgmeyers/obsidian-zotero-integration)）与 Obsidian 本身已覆盖 |
| Zotero 双向同步 / 写入 | 与 Zotero Integration 重叠；本地写入需 Zotero 10+ 且逐次授权（[Local API](https://www.zotero.org/support/dev/web_api/v3/local_api)）；失败会污染用户主库 |
| 系统综述筛选/数据抽取工作流 | Elicit 的核心付费产品（[Systematic Reviews](https://support.elicit.com/en/articles/14759154-systematic-reviews-in-elicit)），需全文与大规模 LLM 调用，偏离「地图」定位 |
| supporting / contrasting 引文分类 | 依赖出版商全文与专有模型（[scite 分类说明](https://help.scite.ai/en-us/article/how-are-citations-classified-1a9j78t/)）；用户可直接装 scite Zotero 插件。现有 S2 contexts/intents 已是开放数据下的上限 |
| 是/否共识仪表、问答式 AI 搜索 | Consensus / Undermind 的领域（[Meter](https://help.consensus.app/en/articles/10069920-the-consensus-meter)；[Undermind](https://www.undermind.ai/mcp)）；与 ROADMAP §10「不把模型自评包装为结论」冲突 |
| 关键词主题聚类地图（Open Knowledge Maps 式） | 不同的问题（检索词 → 主题概览），且现有 Planar 社区着色已提供分组 |
| 笔记间语义相似 | Smart Connections 已以本地 embedding 完成（[README](https://github.com/brianpetro/obsidian-smart-connections)） |
| 机构网络 | ROADMAP §10 已明确不做 |

---

## 6. 建议排期

| 版本 | 内容 | 验收 |
| --- | --- | --- |
| 1.8.6 | P0-0 | 离线单测覆盖「无 key 时 deep 降级」；`npm run verify` 实测 per_page=100 采样量不降 |
| 1.9.0 | P0-1、P0-2 | `project-watch.ts` 差集单测（含出版日期回看窗口）；frontmatter 同步单测；vault 中已有笔记的节点标记在面板与嵌入中一致 |
| 1.10.x | P1-4、P1-3 | Canvas 导出在 Obsidian 中打开无报错；Zotero 未开启本地 API 时静默不可用 |
| 2.0（需定位决策） | P1-1、P1-2 | 多种子与单种子项目迁移兼容；推荐通道与结构边严格分离 |

---

## 7. 未能从一手来源核实的说法

1. Connected Papers 付费价格（Academic $6/月、Business $20/月）——仅见于高校图书馆指南与第三方公司档案（二手）。官方 about 页在抓取时未渲染正文。
2. Connected Papers 的具体相似度算法（共被引 + 文献耦合）——本仓库 USER_GUIDE 有描述，本次未在 Connected Papers 官方页面上找到原文。
3. ResearchRabbit 新版是否仍有每周「Email Updates / Rabbit Radar」新文献邮件及 Timeline 视图——仅见于图书馆指南（二手）；官方 pricing 只列出 RR+ 的「Signals alerts」。
4. Citation Gecko「已停止开发」——仅见于图书馆指南（二手）；官方只能确认旧仓库已归档。
5. Litmaps 免费版地图数量（价格页同时出现「2 Litmaps」与「1 Litmap」）。
6. Undermind 价格与提醒的具体频率/机制——官网仅有一句「Get notified whenever relevant papers are published」。
7. S2 Recommendations 的 `recent` 池对非计算机领域的覆盖度——规范只给出 `recent` / `all-cs` 两个取值，未说明覆盖范围。
8. OpenAlex `search.semantic` 是否必须 API key——仅见于 OpenAlex Developers quickstart 镜像页（openalex.mintlify.app），正式 Semantic Search 指南未写明。
9. Zotero 本地 API 对 DOI 精确查询的支持与性能——官方文档说明了接口形态，但未说明按 DOI 检索的方式，需实测。
10. Zotero「10+」版本当前是否已正式发布（决定本地写入是否可用）——本次未核实。
11. OpenAlex `per_page` 上限：文档写 100，2026-10-18 实测 200 仍可用；何时强制执行未知。
