# Obsidian 插件反馈入口调研

调研日期：2026-10-20。实施进度见 `docs/archive/plans/obsidian-listing-and-feedback-plan.md` 的「实施进度」。本文其余部分保持调研当时的记录。只采用维护者仓库、维护者文档及 GitHub 官方文档。检查公开网页及部分模板源码；未向任何项目提交内容，未在 Obsidian 内逐个安装验证。这里的“说明页”指 README/维护者文档，不把仓库导航中的 Issues 标签当作 README 已设计了反馈入口。

## 结论

Research Connected 应在说明页展示反馈入口，实际收件与跟踪放在 GitHub Issues。两者承担不同工作：说明页负责让普通用户找到入口并判断点哪个，GitHub 负责表单、去重、讨论、状态和版本关联。初期只设“报告问题”“提出功能建议”两种 Issue Form，避免同时引入 Discussions 和独立网站表单造成分流。

## 成熟插件证据

| 插件 | 已核实的说明页/反馈方式 | 可以借鉴什么 |
| --- | --- | --- |
| [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) | README 顶部集中 User Guide、Contributing Guide、Roadmap；有截图、入门、安装、发布记录、捐助。其 [chooser 配置源码](https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/.github/ISSUE_TEMPLATE/config.yml) 禁用普通用户空白 Issue，把“Ask a question”导向 Discussions Q&A。 | 先回答使用问题，再让可执行缺陷进入跟踪；反馈选择器可直接分流，无须自建客服站。 |
| [Dataview](https://github.com/blacksmithgu/obsidian-dataview) | README 用实际查询示例说明产品，另有安全说明、贡献与支持段。[chooser 配置](https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/master/.github/ISSUE_TEMPLATE/config.yml) 禁用空白 Issue，提供 Discussions、Discord、论坛 snippet showcase。[桌面 Bug Form](https://raw.githubusercontent.com/blacksmithgu/obsidian-dataview/master/.github/ISSUE_TEMPLATE/bug_report.yml) 收集现象、DQL/JS、插件版本、Obsidian 版本和操作系统。 | 模板应围绕产品真实排查信息；Research Connected 应收集种子论文标识与发生问题的操作，而非照搬通用长问卷。 |
| [Templater](https://github.com/SilentVoid13/Templater#template-showcase--questions--ideas--help) | README 有明确的 Questions / Ideas / Help 段，链接 Discussions；另有文档、安全提醒、资源、替代品、贡献与支持。[贡献说明](https://raw.githubusercontent.com/SilentVoid13/Templater/master/CONTRIBUTING.md) 规定 Bug 到 Issue，功能建议可 Issue 或 Discussion。 | 反馈文案使用用户语言，比仅写“Contributing”更易找到；问答和缺陷可以区分。 |
| [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin#feedback-questions-ideas-problems) | README 有中英文切换、社区 Wiki、入门课程、视频、详细功能；尾部单设“Feedback, questions, ideas, problems”，论坛承接交流，GitHub Issues 承接 Bug 与 enhancement。 | 把报告入口写进说明正文，不能只依赖 GitHub 标签栏；独立文档可承担深入教学。 |
| [Git](https://github.com/Vinzent03/obsidian-git#contact--credits) | README 顶部给完整文档，含功能、UI previews、常用命令、平台限制；Contact & Credits 明确邀请所有反馈与问题到 GitHub Issues。 | 对规模较小的维护团队，统一收件也是成熟实践；无需为了“成熟感”强行开多个社区渠道。 |
| [Omnisearch](https://github.com/scambier/obsidian-omnisearch) | README 包含文档、安装/测试版、变更记录、特性、中文检索依赖、生态项目及支持。[贡献说明](https://raw.githubusercontent.com/scambier/obsidian-omnisearch/master/CONTRIBUTING.md) 要求贡献代码前先提 Issue/feature request，仓库也开有 Discussions。 | 已启用 Discussions 不等于所有需求都必须先发 Discussion；应写清产品自己的入口规则。 |
| [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) | README 大量展示设置、样式自定义、兼容性、FAQ、技巧、迁移提示与视频。本轮没有在 README 正文找到明确反馈分流段。 | 成熟插件也存在入口不醒目的情况；不应照单全收。FAQ 适合提前解决高频疑问，但无法替代显眼的报告入口。 |

补充：原 mgmeyers/obsidian-kanban 链接本轮重定向到 [community-archive/obsidian-kanban](https://github.com/community-archive/obsidian-kanban)。本轮不将其当作仍由原作者积极维护的样板，不从名称推断仓库的归档状态。

模板进一步核实：[Tasks 的 Bug Form](https://raw.githubusercontent.com/obsidian-tasks-group/obsidian-tasks/main/.github/ISSUE_TEMPLATE/bug-report.yaml) 使用 YAML，并要求确认当前版本与搜索重复问题；[Omnisearch 的 Bug 模板](https://raw.githubusercontent.com/scambier/obsidian-omnisearch/master/.github/ISSUE_TEMPLATE/bug_report.md) 则是 Markdown 预填文本，收集索引文档数量、缓存重置与非笔记索引相关线索。两者说明“有模板”不等于“有必填校验的网页表单”；应依据所需信息量选择。

## GitHub 的能力与限制

- [Issue Forms 官方文档](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)：YAML 放在 `.github/ISSUE_TEMPLATE`，支持输入框、下拉、复选及验证；配置合入默认分支后生效。`config.yml` 可控制空白 Issue 和跳转帮助链接。它是 GitHub 上的表单，不是在插件说明页内嵌一个匿名收件箱。
- [创建 Issue 官方说明](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)：支持从模板及 URL 参数预填；URL 过长会失败；自定义表单字段也可预填。不要把完整日志、笔记正文或访问凭据放在 URL 里。
- 提交 Issue 或 Discussion 需要 GitHub 身份登录。公开浏览不等于匿名提交。本轮匿名网页工具无法打开 `issues/new/choose` 和登录路径；因此没有把未登录工具错误当成已验证的登录后表单体验，也没有实际提交测试。
- [Discussions 官方说明](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions)：适合社区交流、提问和开放式讨论；Issues 更适合有明确后续动作的工作项。将来如问答量明显上升，可再开 Q&A 与 Ideas；当前没有必要先增加维护渠道。

## Research Connected 最小完整方案

### 入口位置

1. README 标识、短介绍之后给一行：`使用指南 · 报告问题 · 功能建议 · 更新记录`。用户不用读到文末。
2. README 后部增加“帮助与反馈”，简述两种选择以及提交后会公开、需要 GitHub 账户。提供“查看已有问题”链接，鼓励先搜索，避免设置长篇门槛。
3. 插件设置页末尾放同一组“报告问题 / 功能建议”链接，让使用中遇错的人无需先找仓库。设置页不应占用图谱主要工作区；本项是规划，未修改实现。
4. 首期不要在说明页内造收件表单、匿名代理、数据库或邮件自动转发系统。那会额外引入垃圾信息、附件、隐私、通知和回执维护。

建议文案：

> **帮助与反馈**
> 遇到无法正常工作的情况？[报告问题]。希望改进某个研究流程？[提出功能建议]。
> 提交前可以先[查看已有问题]。反馈会在 GitHub 公开显示，提交需要 GitHub 账户。请勿附上 API Key、私密笔记或未公开的研究材料。

### 表单字段

Bug 必填：问题概述、复现步骤、预期与实际结果、插件版本、Obsidian 版本、操作系统/桌面或移动端。可选：种子论文 DOI/OpenAlex ID/公开 URL、截图、已脱敏日志、主题或相关插件。针对“找不到文献/图谱不正确”的情况，公开论文标识比要求导出整个 vault 更有效。

功能建议必填：正在完成什么研究任务、现在卡在哪里、希望获得什么结果。可选：目前如何绕过、相关截图或例子。不要要求用户设计完整技术方案或承诺排期。

建议两个表单共用同一 Issues 列表，用 `bug` 与 `enhancement` 分类，维护者自行判定是否接受及关联版本。标签需先存在，不能假定模板会自动创建标签。首期保留自由描述空间，不要求禁用其他所有插件、上传完整数据或填大量环境字段才能报告。

### 规划中的 URL

当前仓库身份由主报告再次核实；若仍为 `Abe-Junwei/research-connected`：

- `https://github.com/Abe-Junwei/research-connected/issues`：已有问题。
- `https://github.com/Abe-Junwei/research-connected/issues/new/choose`：统一反馈选择器。
- 创建表单后，报告按钮可用 `issues/new?template=bug_report.yml`，建议按钮可用 `issues/new?template=feature_request.yml`。文件名必须与实际模板一致；现在不能声称这两个模板已经部署。

本轮没有新增 Issue 模板、修改 README/插件、启用 Discussions 或公开创建任何反馈。未验证所有样本的模板文件及 Obsidian 里的实际渲染；部分 GitHub 页面抓取受限，已把观察和建议分开。
