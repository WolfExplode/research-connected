import { vaultPaperLibrary, invalidatePaperLibrary } from "./vault-paper-library";
import { migrateProjectBookmarks } from "./workflow/bookmark-migration";
import { addIcon, Notice, Plugin, TFile } from "obsidian";
import { dirname } from "path";
import { nodeResearchTools, researchToolsProblem } from "./research-tools";
import { ResearchLibrary, PAPERS, type LibraryHost } from "./research-library";
import { PaperAvailabilityModal, PaperLabelsModal } from "./paper-labels";
import { setProviderPauseStore } from "./provider-limits";
import { setFetchedEvidenceSink } from "./fetched-evidence";
import { providerPauseFiles } from "./provider-pause-file";
import { LOGO_ICON, LOGO_SVG } from "./logo";
import { tr } from "./i18n";
import { VIEW_TYPE } from "./constants";
import { registerConnectedPapersEmbed } from "./embed-block";
import { normalizeGrafted } from "./graph-edit";
import {
	ConnectedPapersSettingTab,
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
} from "./settings";
import { normalizeStagedList } from "./staging";
import { migrateProjectRecords, normalizeProjects } from "./project-state";
import { clamp } from "./visual";
import { invalidateLiteratureIndex } from "./vault-note";
import { ConnectedPapersView } from "./view";
import { DiscoveryGraphView, DISCOVERY_VIEW } from "./discovery-view";

export default class ConnectedPapersPlugin extends Plugin {
	settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS };
	private migratingBookmarks = false;
	private pendingSave: Promise<void> = Promise.resolve();
	private library: ResearchLibrary | null = null;
	/** Repository and Node executable the current library was made for, so settings edits rebuild it. */
	private libraryKey: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.importResearchVaultSettings();
		this.applyResearchTools();
		// Vectors and open-access fields that graph builds fetch go to the research tools' caches.
		setFetchedEvidenceSink(evidence => this.researchLibrary()?.queueFetched(evidence));
		this.register(() => { setProviderPauseStore(null); setFetchedEvidenceSink(null); this.library?.dispose(); this.library = null; });

		// Main-area tab. The graph pane is the product, not a sidebar card list.
		this.registerView(VIEW_TYPE, (leaf) => new ConnectedPapersView(leaf, this));
		this.registerView(DISCOVERY_VIEW, leaf => new DiscoveryGraphView(leaf));
		this.addCommand({ id: "open-related-papers", name: tr("打开本地相关论文图谱", "Open local related-paper graph"), callback: () => { void this.openDiscovery(); } });
		this.registerDomEvent(window, "research-connected-label-paper", event => { this.labelPaper(event.detail?.note); });
		this.addCommand({ id: "check-paper-availability", name: tr("查询论文可用性（开放获取和 Sci-Hub）", "Check paper availability (OA and Sci-Hub)"), callback: () => {
			const library = this.researchLibrary();
			if (library) new PaperAvailabilityModal(this.app, library).open();
			else new Notice(this.researchToolsStatus(), 10000);
		} });
		this.addCommand({ id: "label-paper", name: tr("标注这篇论文", "Label this paper"), checkCallback: checking => {
			const file = this.app.workspace.getActiveFile();
			if (!file || !file.path.startsWith(PAPERS) || file.extension !== "md") return false;
			if (!checking) this.labelPaper(file.path);
			return true;
		} });
		this.registerDomEvent(window, "research-connected-open-discovery", event => {
			const detail = event.detail ?? {};
			void this.openDiscovery(detail.paper, detail.question, detail.mode).catch(error => new Notice(error instanceof Error ? error.message : "Could not open related papers"));
		});

		addIcon(LOGO_ICON, LOGO_SVG);

		this.addRibbonIcon(LOGO_ICON, "Research Connected", () => {
			void this.openView();
		});

		this.addCommand({
			// Preserve the published ID used by existing hotkeys and external links.
			id: "open-research-connected",
			name: tr("打开 Research Connected", "Open Research Connected"),
			callback: () => {
				void this.openView();
			},
		});

		this.addCommand({
			id: "find-doi-citation-path",
			name: tr("查找 DOI 引用路径（预算内）", "Find DOI citation path (budgeted)"),
			callback: () => {
				void (async () => {
					await this.openView();
					const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
					if (view instanceof ConnectedPapersView) view.openDoiPathSearch();
				})();
			},
		});

		this.registerEvent(this.app.workspace.on("css-change", () => {
			window.dispatchEvent(new Event("research-connected-theme"));
		}));
		// With research tools, the library decides which vault changes open graphs can show.
		const dropLiteratureIndex = (path: string, kind: "modify" | "create" | "delete" | "rename"): void => {
			invalidateLiteratureIndex(); invalidatePaperLibrary(this.app, path);
			const library = this.researchLibrary();
			if (library) library.vaultChanged(path, kind);
			else window.dispatchEvent(new Event("research-connected-library-changed"));
		};
		this.registerEvent(this.app.metadataCache.on("changed", file => dropLiteratureIndex(file.path, "modify")));
		this.registerEvent(this.app.vault.on("delete", file => dropLiteratureIndex(file.path, "delete")));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { dropLiteratureIndex(oldPath, "rename"); dropLiteratureIndex(file.path, "rename"); }));
		this.registerEvent(this.app.vault.on("create", file => { if ("extension" in file && file.extension !== "md") dropLiteratureIndex(file.path, "create"); }));
		// Sidecar edits change stored summaries; Markdown edits arrive through the metadata cache.
		this.registerEvent(this.app.vault.on("modify", file => { if ("extension" in file && file.extension === "json") this.library?.vaultChanged(file.path, "modify"); }));
		this.addSettingTab(new ConnectedPapersSettingTab(this.app, this, this));
		registerConnectedPapersEmbed(this);
		this.addCommand({ id: "migrate-legacy-bookmarks", name: tr("迁移旧项目收藏到文库", "Migrate legacy bookmarks to library"), callback: () => {
			void this.migrateBookmarks().catch(error => new Notice(error instanceof Error ? error.message : "Bookmark migration failed. Legacy entries are retained."));
		} });
		this.app.workspace.onLayoutReady(() => {
			void this.migrateBookmarks().catch(error => new Notice(error instanceof Error ? error.message : "Bookmark migration failed. Legacy entries are retained."));
		});
	}

	getSettings(): ConnectedPapersSettings {
		return this.settings;
	}

	private async openDiscovery(paper?: string, question?: string, mode?: "rank" | "search"): Promise<void> {
		await this.openView();
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
		if (view instanceof ConnectedPapersView) view.openDiscovery({ paper, question, mode });
		for (const leaf of this.app.workspace.getLeavesOfType(DISCOVERY_VIEW)) leaf.detach();
	}

	/** Note embeds call this to jump to the full graph pane on their seed. */
	openGraph(target: { kind: "doi" | "openalex"; value: string }): void {
		void (async () => {
			await this.openView();
			const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
			if (view instanceof ConnectedPapersView) view.openSeed(target);
		})();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as (Partial<ConnectedPapersSettings> & { stagedPapers?: unknown }) | null;
		const migrateIdentity = Object.values(stored?.researchProjects ?? {}).some((project) => project.snapshot?.version === 1);
		if (migrateIdentity && this.manifest.dir) {
			const path = `${this.manifest.dir}/data-before-work-identity-v2.json`;
			if (!await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.write(path, JSON.stringify(stored));
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		const maxNodes = Number(this.settings.maxNodes);
		this.settings.maxNodes = Number.isFinite(maxNodes) ? clamp(maxNodes, 20, 300) : DEFAULT_SETTINGS.maxNodes;
		this.settings.stagedPapers = normalizeStagedList(stored?.stagedPapers);
		this.settings.graftedBySeed = normalizeGrafted(stored?.graftedBySeed);
		this.settings.researchProjects = migrateProjectRecords(
			normalizeProjects(stored?.researchProjects),
			this.settings.stagedPapers,
			this.settings.graftedBySeed,
		);
		if (migrateIdentity && Object.entries(stored?.researchProjects ?? {}).some(([id, project]) => project.snapshot && !this.settings.researchProjects[id.toUpperCase()])) {
			throw new Error(tr("项目迁移未完成，已保留原数据及备份；请检查保存的项目格式", "Project migration could not complete. Original data and backup are retained; review the saved project format."));
		}
		this.settings.stagedPapers = [];
		this.settings.graftedBySeed = {};
		if (migrateIdentity) await this.saveSettings(false);
	}

	async migrateBookmarks(): Promise<void> {
		if (this.migratingBookmarks || !Object.values(this.settings.researchProjects).some(project => Object.values(project.paperStates ?? {}).some(state => state.staged))) return;
		this.migratingBookmarks = true;
		try {
			if (!this.manifest.dir) throw new Error("Plugin folder unavailable; legacy bookmarks are retained.");
			const path = `${this.manifest.dir}/data-before-vault-bookmarks.json`;
			if (!await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.write(path, JSON.stringify(this.settings));
			await migrateProjectBookmarks(this.settings.researchProjects, vaultPaperLibrary(this.app, () => this.settings, () => this.researchLibrary()), () => this.saveSettings(false));
			window.dispatchEvent(new Event("research-connected-library-changed"));
		} finally { this.migratingBookmarks = false; }
	}

	async saveSettings(notify = true): Promise<void> {
		const data = { ...this.settings } as Partial<ConnectedPapersSettings> & { stagedPapers?: unknown; graftedBySeed?: unknown };
		delete data.stagedPapers;
		delete data.graftedBySeed;
		const snapshot: unknown = JSON.parse(JSON.stringify(data));
		const save = this.pendingSave.catch(() => {}).then(async () => {
			await this.saveData(snapshot);
			window.dispatchEvent(new Event(notify ? "research-connected-settings" : "research-connected-project"));
		});
		this.pendingSave = save;
		await save;
		if (notify) this.applyResearchTools();
	}

	private vaultBase(): string | null {
		return (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? null;
	}

	/** The research repository: the setting, or the folder containing this vault. */
	researchRepository(): string | null {
		const base = this.vaultBase();
		return this.settings.researchRepository || (base ? dirname(base) : null);
	}

	researchToolsStatus(): string {
		const repository = this.researchRepository();
		if (!repository) return tr("此平台无法运行研究工具。", "Research tools cannot run on this platform.");
		const problem = researchToolsProblem(repository);
		return problem ? `${problem}. ${tr("保存、收藏和可用性功能已隐藏。", "Save, Bookmark and availability are hidden.")}` : tr(`已找到研究工具：${repository}`, `Research tools found at ${repository}.`);
	}

	private toolsKey(): string { return `${this.researchRepository() ?? ""}|${this.settings.researchNode}`; }

	/** Shares rate-limit pauses with the configured repository and rebuilds the library when it changed. */
	private applyResearchTools(): void {
		const repository = this.researchRepository();
		try { setProviderPauseStore(repository ? providerPauseFiles(repository) : null); } catch { setProviderPauseStore(null); /* In-memory pauses still apply. */ }
		if (this.toolsKey() === this.libraryKey) return;
		this.library?.dispose(); this.library = null; this.libraryKey = null;
		window.dispatchEvent(new Event("research-connected-library-changed"));
	}

	/** The paper library, or null when no research tools are configured (citation graphs still work). */
	researchLibrary(): ResearchLibrary | null {
		const key = this.toolsKey();
		if (key === this.libraryKey) return this.library;
		this.library?.dispose(); this.library = null; this.libraryKey = key;
		const repository = this.researchRepository(), vault = this.vaultBase();
		if (!repository || !vault || researchToolsProblem(repository)) return null;
		const app = this.app;
		const fileAt = (path: string): TFile | null => { const file = app.vault.getAbstractFileByPath(path); return file instanceof TFile ? file : null; };
		const host: LibraryHost = {
			files: () => app.vault.getFiles(),
			frontmatter: path => { const file = fileAt(path); return file ? app.metadataCache.getFileCache(file)?.frontmatter ?? null : null; },
			resolveLink: (link, from) => app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null,
			read: path => app.vault.adapter.read(path),
			async processFrontMatter(path, update) {
				const file = fileAt(path);
				if (!file) throw new Error(`The paper note ${path} is missing.`);
				await app.fileManager.processFrontMatter(file, update);
			},
			open: path => { void app.workspace.openLinkText(path, "", true); },
		};
		// Keys flow one way: the child processes get this plugin's keys and contact email.
		const env = (): Record<string, string | undefined> => ({ ...process.env,
			...(this.settings.contactEmail.trim() ? { RESEARCH_MAILTO: this.settings.contactEmail.trim() } : {}),
			...(this.settings.apiKey ? { OPENALEX_API_KEY: this.settings.apiKey } : {}),
			...(this.settings.semanticScholarApiKey ? { SEMANTIC_SCHOLAR_API_KEY: this.settings.semanticScholarApiKey } : {}) });
		const tools = nodeResearchTools({ repository, node: this.settings.researchNode || "node", vault, env });
		this.library = new ResearchLibrary(host, tools, () => this.settings);
		return this.library;
	}

	private labelPaper(note: string | undefined): void {
		const file = note ? this.app.vault.getAbstractFileByPath(note) : null;
		if (file instanceof TFile) new PaperLabelsModal(this.app, file).open();
	}

	/**
	 * Research Vault held these settings before Research Connected ran the tools itself. They are
	 * copied once; Python and model settings now belong to the research CLI.
	 */
	private async importResearchVaultSettings(): Promise<void> {
		if (this.settings.researchToolsImported) return;
		let old: Record<string, unknown> | null = null;
		try { old = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/research-vault/data.json`)) as Record<string, unknown>; } catch { /* Nothing to import. */ }
		if (old) {
			if (typeof old.repository === "string") this.settings.researchRepository = old.repository.trim();
			if (typeof old.node === "string" && old.node.trim()) this.settings.researchNode = old.node.trim();
			if (typeof old.autoOpenAccess === "boolean") this.settings.autoOpenAccess = old.autoOpenAccess;
			if (typeof old.autoSpecter2 === "boolean") this.settings.autoSpecter2 = old.autoSpecter2;
			if (["asreviewPython", "paperqaPython", "paperqaApiKey"].some(key => typeof old[key] === "string" && old[key])) {
				new Notice(tr("Research Vault 中的 Python 和模型密钥设置不再使用。研究工具会在仓库的 .cache/research-tools 中查找环境，并从 .deepseek-key 或环境变量读取密钥。", "Research Vault's Python and model key settings are no longer used. The research tools find environments in the repository's .cache/research-tools and keys in .deepseek-key or the environment."), 15000);
			}
		}
		this.settings.researchToolsImported = true;
		await this.saveSettings(false);
	}

	private async openView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		const leaf = existing[0] ?? workspace.getLeaf("tab");
		if (existing.length === 0) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}
}
