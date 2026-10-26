import { tr } from "./i18n";
import { App, Plugin, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
	type SampleDepth,
} from "./settings-model";
import { clamp } from "./visual";

export { DEFAULT_SETTINGS, type ConnectedPapersSettings };

export interface SettingsStore {
	settings: ConnectedPapersSettings;
	saveSettings(): Promise<void>;
	/** One sentence on whether the research tools were found. */
	researchToolsStatus?(): string;
}

export class ConnectedPapersSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly store: SettingsStore,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [];

		items.push({
			name: tr("OpenAlex API 密钥", "OpenAlex API key"),
			desc: tr("在 openalex.org/settings/api 免费创建。不填也能查询，但匿名每日额度很小，用尽后会返回 429。免费密钥大约是匿名额度的 10 倍。密钥只保存在本机插件数据里，请求通过 Authorization 头发送。", "Create a free key at openalex.org/settings/api. Searches can run without one, but the anonymous daily limit is small and returns HTTP 429 when exhausted. A free key offers roughly ten times the anonymous allowance. It is stored only in local plugin data and sent in the Authorization header."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text
						.setPlaceholder(tr("粘贴 API key", "Paste API key"))
						.setValue(this.store.settings.apiKey)
						.onChange(async (value) => {
							this.store.settings.apiKey = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("联系邮箱（mailto）", "Contact email (mailto)"),
			desc: tr("2026 年 2 月起 OpenAlex 已取消 polite pool，mailto 会被忽略，不能提高额度。如果填写，仍会附在请求上，只为兼容旧网关。", "OpenAlex retired the polite pool in February 2026. The mailto parameter is ignored and does not increase limits. If supplied, it is still sent for compatibility with older gateways."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("you@example.com")
						.setValue(this.store.settings.contactEmail)
						.onChange(async (value) => {
							this.store.settings.contactEmail = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("最大节点数", "Maximum nodes"),
			desc: tr("含种子论文。默认 50，标准采样建议 40–60；配合扩展或深度采样可到 300。下次构建图谱时生效。", "Includes the seed paper. Default: 50. Use 40–60 for standard sampling; extended or deep sampling can use up to 300. Applies to the next graph build."),
			render: (setting) => {
				setting.addSlider((slider) => {
					slider
						.setLimits(20, 300, 1)
						.setValue(this.store.settings.maxNodes)
						.onChange(async (value) => {
							this.store.settings.maxNodes = clamp(value, 20, 300);
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("采样深度", "Sampling depth"),
			desc: tr("标准：80 参考文献 + 40 施引 + 20 相关，约 5 次请求。扩展：参考文献和施引各最多 200，每页 100 条并自动翻页。深度：各检查最多 1000 条；没有 OpenAlex API 密钥时只取第一页，状态栏会说明。下次构建图谱时生效。", "Standard: 80 references, 40 citing papers, and 20 related works in about five requests. Extended: up to 200 references and citing papers, 100 per page. Deep: examines up to 1,000 each; without an OpenAlex API key it stops after the first page and the status bar says so. Applies to the next graph build."),
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					dropdown
						.addOption("standard", tr("标准", "Standard"))
						.addOption("extended", tr("扩展", "Extended"))
						.addOption("deep", tr("深度", "Deep"))
						.setValue(this.store.settings.sampleDepth)
						.onChange(async (value) => {
							this.store.settings.sampleDepth = value as SampleDepth;
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记文件夹", "Literature note folder"),
			desc: tr("导出的单篇笔记写到这个文件夹。留空则写到库根目录。文件夹不存在时会创建。", "Single-paper notes are written here. Leave empty to use the vault root. The folder is created if it does not exist."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder(tr("例如 Literature", "e.g. Literature"))
						.setValue(this.store.settings.literatureFolder)
						.onChange(async (value) => {
							this.store.settings.literatureFolder = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记文件名", "Literature note filename"),
			desc: tr("可用 {{title}} {{authors}} {{year}} {{doi}} {{openalex}} {{relation}} {{project}} {{status}}。留空则用「年份 题名」。", "Tokens: {{title}} {{authors}} {{year}} {{doi}} {{openalex}} {{relation}} {{project}} {{status}}. Empty uses “year title”."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("{{year}} {{title}}")
						.setValue(this.store.settings.literatureFilename)
						.onChange(async (value) => {
							this.store.settings.literatureFilename = value;
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记正文", "Literature note body"),
			desc: tr("留空则只写题名标题。插件总会写入 doi、openalex、rc-project、rc-status。打开论文时，笔记里的 rc-status 覆盖项目中的阅读状态；在面板里改阅读状态会写回笔记。", "Empty writes a title heading only. The plugin always adds doi, openalex, rc-project, and rc-status. Opening a paper copies rc-status into the project; changing reading status in the panel writes it back."),
			render: (setting) => {
				setting.addTextArea((text) => {
					text
						.setPlaceholder("# {{title}}\n\n{{authors}}")
						.setValue(this.store.settings.literatureTemplate)
						.onChange(async (value) => {
							this.store.settings.literatureTemplate = value;
							await this.store.saveSettings();
						});
					text.inputEl.rows = 4;
				});
			},
		});

		items.push({
			name: tr("DOI 属性名", "DOI property name"),
			desc: tr("用来识别库里已有笔记。默认 doi，也同时认这个名字。Zotero Integration 等插件若把 DOI 写在别的属性里，填那个名字。", "Used to recognize notes already in the vault. doi is always checked as well. If another plugin stores the DOI under a different property, enter that name."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("DOI")
						.setValue(this.store.settings.literatureDoiProperty)
						.onChange(async (value) => {
							this.store.settings.literatureDoiProperty = value.trim() || "doi";
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("研究工具仓库", "Research tools repository"),
			desc: tr("包含 Tools/research/cli.js 的文件夹。留空则使用库所在的上级文件夹。保存、收藏、可用性、SPECTER2 和发现功能都通过它运行；未配置时引用图谱仍可用。", "Folder containing Tools/research/cli.js. Empty uses the folder that contains this vault. Save, Bookmark, availability, SPECTER2 and discovery run through these tools; without them the citation graph still works.") + (this.store.researchToolsStatus ? ` ${this.store.researchToolsStatus()}` : ""),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder(tr("库的上级文件夹", "Vault's parent folder"))
						.setValue(this.store.settings.researchRepository)
						.onChange(async (value) => {
							this.store.settings.researchRepository = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("Node 可执行文件", "Node executable"),
			desc: tr("node.exe 的路径，或 PATH 中的命令。", "Path to node.exe, or a command on PATH."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder(tr("命令或路径", "Command or path"))
						.setValue(this.store.settings.researchNode)
						.onChange(async (value) => {
							this.store.settings.researchNode = value.trim() || "node";
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("自动查询开放获取", "Check open access automatically"),
			desc: tr("为显示中的图谱论文分批在后台查询。已缓存的链接会立即显示；Sci-Hub 仍需手动查询。", "Check papers in displayed graphs in background batches. Cached links appear immediately; Sci-Hub checks stay manual."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.autoOpenAccess).onChange(async (value) => {
						this.store.settings.autoOpenAccess = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("自动下载 SPECTER2", "Download SPECTER2 automatically"),
			desc: tr("图谱或文库相似度加载时，从 Semantic Scholar 获取缺失的向量，缓存在研究仓库中并在后台更新分数。使用下方的 Semantic Scholar API 密钥。", "Fetch missing embeddings from Semantic Scholar when graphs or library similarity load. They are cached in the research repository and scores update in the background. Uses the Semantic Scholar API key below."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.autoSpecter2).onChange(async (value) => {
						this.store.settings.autoSpecter2 = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("纳入参考文献", "Include references"),
			desc: tr("种子引用的作品。用于 bibliographic coupling（参考文献集合的重叠）。", "Works cited by the seed. Used to calculate bibliographic coupling (overlap between reference sets)."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeReferences).onChange(async (value) => {
						this.store.settings.includeReferences = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("排除已撤稿作品", "Exclude retracted works"),
			desc: tr("开启后，新建图谱时跳过 OpenAlex 标记为已撤稿的作品；关闭时保留警告并在候选排序中降权。", "When enabled, new graphs skip works marked as retracted by OpenAlex. Otherwise, they remain with a warning and a ranking penalty."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.excludeRetracted).onChange(async (value) => {
						this.store.settings.excludeRetracted = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("OpenCitations 访问令牌", "OpenCitations access token"),
			desc: tr("可选。用于补充 OpenAlex 缺失的引用关系。令牌只保存在本机。", "Optional. Adds citation links missing from OpenAlex. The token is stored locally only."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder(tr("可选 token", "Optional token")).setValue(this.store.settings.openCitationsToken).onChange(async (value) => {
						this.store.settings.openCitationsToken = value.trim();
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("Semantic Scholar API 密钥", "Semantic Scholar API key"),
			desc: tr("可选。点击引用边时读取引用意图和 Influential 标记。", "Optional. Fetches citation intent and the Influential flag when a citation edge is selected."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder(tr("可选 API key", "Optional API key")).setValue(this.store.settings.semanticScholarApiKey).onChange(async (value) => {
						this.store.settings.semanticScholarApiKey = value.trim();
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("Semantic Scholar 交叉比对", "Semantic Scholar cross-check"),
			desc: tr("建图时用 Semantic Scholar 批量核对每篇的被引数与参考文献数：差异悬殊的节点（通常是记录错配，如书评继承了原书引用）会在详情里标注；OpenAlex 缺失的参考文献列表会从 Semantic Scholar 回填并参与连线。失败不影响建图。", "During graph building, compare citation and reference counts against Semantic Scholar. Large discrepancies, often caused by mismatched records such as a review inheriting a book citations, are flagged in the details. Missing OpenAlex reference lists are backfilled from Semantic Scholar and used for links. Failures do not stop graph building."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.s2Reconcile).onChange(async (value) => {
						this.store.settings.s2Reconcile = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("语义向量（SPECTER2）", "Semantic embeddings (SPECTER2)"),
			desc: tr("随上面的批量核对一同取回 Semantic Scholar 的 SPECTER2 语义向量，用于文本相似度打分（不增加请求数，向量只存内存）。接口不可用或某篇缺向量时自动退回本地文本相似度。需先开启交叉比对。", "Fetch Semantic Scholar SPECTER2 embeddings during the cross-check for text similarity scoring. This adds no requests; embeddings stay in memory. If unavailable, scoring falls back to local text similarity. Requires the cross-check above."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.semanticEmbedding).onChange(async (value) => {
						this.store.settings.semanticEmbedding = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("启用 LLM 研究脉络", "Enable LLM research narrative"),
			desc: tr("关闭时不显示研究脉络入口，也不会发送任何 LLM 请求。", "When disabled, the research narrative entry is hidden and no LLM requests are sent."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.llmEnabled).onChange(async (value) => {
						this.store.settings.llmEnabled = value;
						await this.store.saveSettings();
						this.update();
					});
				});
			},
		});

		if (this.store.settings.llmEnabled) {
			items.push({
				name: tr("LLM 接口地址", "LLM endpoint"),
				desc: tr("兼容 OpenAI 风格 chat/completions 的接口地址。", "Endpoint compatible with the OpenAI-style chat/completions API."),
				render: (setting) => {
					setting.addText((text) => {
						text.setPlaceholder(tr("接口 URL", "Endpoint URL")).setValue(this.store.settings.llmEndpoint).onChange(async (value) => {
							this.store.settings.llmEndpoint = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("LLM API 密钥", "LLM API key"),
				desc: tr("只保存在本机；生成总结时才发送。", "Stored locally; sent only when generating a summary."),
				render: (setting) => {
					setting.addText((text) => {
						text.inputEl.type = "password";
						text.setPlaceholder("API key").setValue(this.store.settings.llmApiKey).onChange(async (value) => {
							this.store.settings.llmApiKey = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("LLM 模型", "LLM model"),
				desc: tr("填写所配置服务商支持的模型名。", "Enter a model name supported by the configured provider."),
				render: (setting) => {
					setting.addText((text) => {
						text.setPlaceholder(tr("模型名", "Model name")).setValue(this.store.settings.llmModel).onChange(async (value) => {
							this.store.settings.llmModel = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("发送摘要", "Send abstracts"),
				desc: tr("关闭时只发送标题、作者、年份和引用关系；开启可提高总结质量。", "When off, only titles, authors, years, and citation links are sent. Enabling abstracts may improve summary quality."),
				render: (setting) => {
					setting.addToggle((toggle) => {
						toggle.setValue(this.store.settings.llmSendAbstracts).onChange(async (value) => {
							this.store.settings.llmSendAbstracts = value;
							await this.store.saveSettings();
						});
					});
				},
			});
		}

		items.push({
			name: tr("纳入施引文献", "Include citing papers"),
			desc: tr("引用了种子的作品。它们的参考文献列表同时作为共被引的上下文。", "Works that cite the seed. Their reference lists also provide co-citation context."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeCitations).onChange(async (value) => {
						this.store.settings.includeCitations = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("纳入相关作品", "Include related works"),
			desc: tr("OpenAlex 的 related_works，按主题相近补充候选节点，不直接当作边的权重。", "OpenAlex related_works add topically similar candidates; they do not directly determine edge weights."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeRelated).onChange(async (value) => {
						this.store.settings.includeRelated = value;
						await this.store.saveSettings();
					});
				});
			},
		});
		items.push({
			name: tr("帮助与反馈", "Help and feedback"),
			desc: tr("使用指南、报告问题与功能建议。支持中文或英文；提交需要 GitHub 账户，内容公开可见。请勿附上密钥或私人笔记。", "User guide, bug reports, and feature requests. English or Chinese is welcome. Submitting requires a GitHub account and is public; do not include keys or private notes."),
			render: (setting) => {
				setting.controlEl.addClass("cpo-help-links");
				for (const [text, href] of [
					[tr("使用指南", "User guide"), "https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md"],
					[tr("报告问题", "Report a bug"), "https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml"],
					[tr("功能建议", "Request a feature"), "https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml"],
				]) {
					setting.controlEl.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener noreferrer" } });
				}
			},
		});
		return items;
	}
}
