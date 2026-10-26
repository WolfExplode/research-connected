# Research Connected：插件说明页与反馈入口调研

调研日期：2026-10-20。范围：8 个成熟插件的官方仓库 README、可访问的社区目录页、Obsidian 与 GitHub 官方文档；浏览器实看 Tasks README、Research Connected 与 Excalidraw 社区页。下文「实施前现状」是调研当时的记录。

## 实施进度

1.9.3 已发布。对照本文建议：

- GitHub：默认分支已有 `bug_report.yml`、`feature_request.yml`、`config.yml`。空白 Issue 关闭。Issues 开启，Discussions 关闭。`bug` 与 `enhancement` 标签已存在。未登录打开两个表单链接会进入 GitHub 登录，并保留模板参数。尚未用已登录账号核对字段，也未提交测试 Issue。
- README：已按本文顺序重排。使用前须知包含桌面、网络、密钥、采样、笔记读写和 AI。文末中英文都区分报告问题与功能建议。社区 Overview 已显示同一正文；本次补上的两句须知和中文反馈句要合入 `main` 后才会出现在社区页。
- 设置页：1.9.3 有「帮助与反馈」，链到使用指南和同一组表单。
- 社区目录：短描述、侧栏说明，以及图谱与证据、时间线、笔记嵌入三张截图已在公开页。版本显示 1.9.3。头部仍是通用网络图标，不是 `docs/images/logo.svg`。截图尺寸为 1440×880 与 1160×880。
- 构建失败时再提供报告链接、以及非 GitHub 备用渠道：仍按原文暂缓。

## 建议

说明页负责让用户发现入口，GitHub Issues 负责提交、查重、交流与跟踪。Research Connected 第一阶段采用两个 Issue Forms：Bug report、Feature request。暂不开 Discussions，不建外部反馈系统。插件设置提供相同入口，避免已安装用户还要回社区目录查找。

这是针对当前维护规模的判断，不是所有成熟插件都采用同一种机制。

## 页面载体必须区分

1. GitHub README：可控制 Markdown 内容、图片、链接和顺序。
2. Obsidian 社区目录：统一的头部、安装按钮、Overview / Scorecard / Updates、侧栏信息，包含截图、长描述和 README 内容。开发者能编辑图标、短长描述、分类、付费类型与截图，不能把它当作任意 HTML/CSS 网站。
3. 插件设置：服务已安装用户，适合常驻帮助与反馈入口。

依据：[社区页说明](https://obsidian.md/help/community-directory)、[目录管理](https://docs.obsidian.md/community-directory/manage-entry)。官方规定桌面截图最多 5 张、1200×800，移动端最多 5 张、900×1600，单张不超过 5 MB，支持 JPEG/PNG/WebP。当前项目只支持桌面，因此只规划桌面截图。

调研当时，目录头部是旧图标，顶部还没有独立截图，图谱截图只出现在 Overview 的 README 里。目录更新与 GitHub 发布不是同一个完成边界。当时页面文本显示版本 1.9.0。

## 8 个样本：布局与内容

| 样本 | 官方页面中的结构与信息 | 对本项目的取舍 |
| --- | --- | --- |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | 居中标题与一句话说明，靠前的 User Guide / Contributing / Roadmap 导航；截图逐一解释任务来源与查询结果；安装、最小使用示例、文档与捐赠 | 借鉴短导航、真实截图配说明、跑通一次的示例；不照搬全部查询语法 |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | 产品定义后直接给查询示例与输出；深入介绍数据和查询；JS 权限说明、贡献与支持；完整文档独立承载 | 借鉴输入→结果示例，让用户知道 DOI 输入后得到什么；算法细节移到指南 |
| [Templater](https://github.com/SilentVoid13/Templater) | 说明、文档入口、执行代码的风险说明，单独列模板分享／问题／想法／帮助，外链 Discussions；资源、替代品、贡献、许可与赞助 | 借鉴明确区分帮助与故障；不因对方有 Discussions 就同时开多个空渠道 |
| [Excalidraw](https://community.obsidian.md/plugins/obsidian-excalidraw-plugin) | 社区页顶部有独立产品截图；正文有语言切换、教程与 wiki、权限披露、视频、功能和反馈分区；Bug 和 enhancement 指向 GitHub，普通交流指向论坛 | 借鉴顶部真实截图、双语文档入口、反馈分区；不复制很长的生态课程与视频目录 |
| [Obsidian Git](https://github.com/Vinzent03/obsidian-git) | 一句话价值、完整文档、移动端限制提示、功能清单、按具体视图介绍 UI、命令与兼容性、权限说明 | 借鉴按工作流组织截图，准确展示平台支持与外部能力 |
| [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | 获奖信息、价值说明、文档、安装／测试版／更新记录、能力与依赖、中文支持条件、生态项目、许可及赞助 | 借鉴必要依赖与使用条件；没有实际奖项或社区规模时不制造社会证明 |
| [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) | 简短定位、Usage、Features、设置默认值、主题定制、Compatibility、FAQ 和使用技巧 | 借鉴明确的启动位置和默认行为；定制 CSS 不应占据本项目说明页主体 |
| [Kanban](https://github.com/community-archive/obsidian-kanban) | 当前首页突出寻找维护者，再给一句话定位、Bug/Issues/Feature Requests、Roadmap 和独立文档 | 适合参考显眼的反馈链接；当前存在维护者招募，不能把历史知名度当作活跃维护证明 |

社区目录的导航、评分条和右栏属于平台外观；它们不说明 README 作者设计了自定义卡片。不同样本信息量相差很大，不能推断“成熟等于更长”。

## 实施前现状

- README 已有真实图谱、时间线、笔记嵌入截图，以及安装、快速开始、网络与隐私、限制、指南和路线图；主要缺口是层级与反馈引导，不是缺一整套文档。
- Features 一次列出九项，用户需要读较多文字才能判断主要工作流。
- 当前反馈仅在文末 Documentation and support 中写通用 Issues，未区分故障与功能需求。
- 2026-10-20 通过 GitHub API 核实仓库启用了 Issues，未启用 Discussions；默认分支没有 `.github/ISSUE_TEMPLATE/`。本地 `.github/workflows/release.yml` 尚未纳入已发布分支，不能把本地文件当作线上反馈设施。
- `src/settings.ts` 的设置从 OpenAlex API key 开始，未见文档／Bug／功能建议的常驻入口。

## 建议的页面顺序

### GitHub README

1. 紧凑品牌区：新版 logo、名称、一句话说明；版本与平台徽章保持少量。
2. 一行导航：Quick start · User guide · Report a bug · Request a feature。
3. 一张主截图：真实图谱与右侧关系证据，说明“输入一篇论文，看到它与哪些论文相关，以及为什么”。
4. 三组核心用途：发现相关研究；检查关系证据；整理阅读并写入笔记。每组短说明，详细能力留给指南。
5. 三步上手：安装启用 → 输入 DOI/题名 → 构建后查看一条关系。给一个可复制的公开 DOI；不承诺每次得到固定节点数量。
6. 两个补充场景：时间线；笔记嵌入。每张图只解释一种结果。
7. Before you start / FAQ：桌面支持；是否需要账号／服务密钥；联网服务；图谱是采样；是否读取或修改笔记；AI 是否必需。费用／额度文字实施前再核实服务商现行规则，不在 README 写容易过时的倍数承诺。
8. Help & feedback：分开的 Bug / 功能需求 / 已有问题 / 使用指南。
9. 更新、路线图、贡献、许可、独立项目声明。

说明页以单列内容为基础，使用正常链接、图片与短段落；不依赖按钮 CSS、复杂表格布局或嵌入表单。首屏导航与文末反馈区各出现一次，方便新访客和读完说明的用户。

### 社区目录

- 替换目录图标为新版 logo；透明图标在浅色与深色底上分别检查。
- 配置 3 张独立桌面截图：图谱＋关系证据；时间线；笔记嵌入。采用项目实际运行截图，测试内容需明确，不用设计稿冒充运行界面。
- 短描述强调结果，长描述解释三种用途与关键前提，避免重复大段 README。
- 如长描述编辑器支持链接，在靠前位置提供反馈链接；具体链接渲染能力实施时核实。README 本身仍保留反馈导航，作为已知可用路径。
- 版本、下载量和评分让平台提供，避免额外手写数字造成不同步。评分是自动检查结果，不能把绿色当作产品质量担保。

## 反馈入口的具体方案

| 位置 | 用户看见什么 | 去向 |
| --- | --- | --- |
| README 顶部导航 | Report a bug / Request a feature | 分别直达两个 GitHub 表单 |
| README 文末 | Help & feedback，解释用途、可中文提交、公开可见、需要 GitHub 登录 | 同一表单＋已有问题搜索＋指南 |
| 设置页的帮助分区 | 使用指南／报告问题／功能建议，短链接或普通次要按钮 | 同一组 URL；不抢占 API key 等设置空间 |
| 构建失败提示 | 帮助与排查链接；确有需要时再增加报告问题链接 | 先解释错误并保留重试；不把第三方限流一律引导为插件 Bug |

首期只做前两项和 GitHub 表单；设置页入口可作为第二个小改动。错误场景接入按真实需求再做。

### Bug report 表单

必填：问题简述；插件版本；Obsidian 版本；系统；复现步骤；预期与实际结果。

可选：公开论文 DOI/OpenAlex ID；图谱面板还是笔记嵌入；布局／采样深度；精简截图或错误文本；在干净测试库能否复现（允许“不知道”）。涉及关系或数据错误时，再补预期依据和来源。不能要求所有用户都做复杂诊断才允许提交。

请求用户删除密钥和私人笔记内容。不索要完整 `data.json`、整个库、环境变量或账号凭据；这些不应成为报告模板的默认附件。复制诊断信息如以后实施，先展示内容并由用户主动复制，不能自动上传。

### Feature request 表单

必填：研究任务／使用场景；目前哪里受阻；希望得到的结果。

可选：现有替代办法；建议交互；相关示例。中文与英文均可，不要求先设计实现方案或提供代码。不把需求提交当作交付承诺。

### GitHub 结构

拟新增 `.github/ISSUE_TEMPLATE/bug_report.yml`、`feature_request.yml`、`config.yml`。模板名与标签字段在上线前核实；自动标签应预先存在。建议最小标签：`bug`、`enhancement`、`needs-info`，必要时再增加状态标签。

不开放第三个通用空白入口，防止两份表单形同虚设；通过 chooser 的联系链接提供使用指南和已有问题。不得先放指向不存在模板的链接。

规划中的直达 URL：

- `https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml`
- `https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml`
- 已有问题：`https://github.com/Abe-Junwei/research-connected/issues`

这些模板已在默认分支生效。GitHub 支持 YAML Issue Forms 和链接参数；提交需要登录，不能当作匿名反馈。依据：[配置表单](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)、[创建问题](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)、[URL 参数](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue-from-a-url-query)。

## 为什么暂时不选其他渠道

- Issues 同时容纳 Bug 与具体功能请求，能关联提交、发布和处理状态。当前没有必要把少量反馈拆成多个列表。
- Discussions 适合问答、想法和社区分享，Templater 等已有大量用户内容；本项目后续出现持续的使用问答或开放讨论，再启用 Q&A / Ideas。依据：[GitHub Discussions](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions)。
- 外部表单可以减少 GitHub 账户门槛，但会增加转录、去重、回访和双系统状态维护。先观察用户是否确实被账户或网络阻挡；有明确需求且已有维护中的邮箱／表单时，再提供真实的备用通道，不虚构地址。
- 独立官网、Discord、微信群和公开邮箱都增加维护面，本轮不建议新建。

## 实施与验收

1. GitHub 两个表单及 chooser：在默认分支存在；已登录／未登录访问分别检查；两个链接打开正确模板；不创建公开测试 Issue。
2. README：压缩功能说明、增加顶部导航和文末明确反馈区；图片与链接使用跨载体可访问的绝对地址；浅深主题和窄宽度检查。
3. 社区目录：设置新版 logo 与三张截图；核实短长描述；确认公开页出现的是实际保存内容，版本更新单独检查。
4. 插件设置帮助链接：复用项目已有外部链接方式和中英翻译；检查键盘焦点与可访问名称；需要代码变更时才构建发版。

纯 README／模板调整无需为了入口本身发布插件版本。设置 UI 改动才需要随插件构建发布。表单、README 主体和设置入口已随 1.9.3 上线。目录图标仍要在社区目录的 Edit listing 里单独替换。登录后的表单字段尚未打开核对。

配套的反馈机制逐样本证据见 `docs/research/obsidian-feedback-entry-research-2026-10-20.md`。
