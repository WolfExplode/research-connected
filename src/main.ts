import { invalidatePaperLibrary } from "./vault-paper-library";
import { addIcon, Notice, Plugin, TFile } from "obsidian";
import { dirname } from "path";
import { nodeResearchTools, researchToolsProblem, workerOpenAlexCache, type AvailabilityWorker } from "./research-tools";
import { ResearchLibrary, PAPERS, type LibraryHost } from "./research-library";
import { PaperAvailabilityModal, PaperLabelsModal } from "./paper-labels";
import { setProviderPauseStore } from "./provider-limits";
import { setFetchedEvidenceSink } from "./fetched-evidence";
import { providerPauseFiles } from "./provider-pause-file";
import { OpenAlexClient, setOpenAlexCache } from "./openalex";
import { obsidianGetJson } from "./obsidian-http";
import { LOGO_ICON, LOGO_SVG } from "./logo";
import { tr } from "./i18n";
import { VIEW_TYPE } from "./constants";
import { registerConnectedPapersEmbed } from "./embed-block";
import {
	ConnectedPapersSettingTab,
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
} from "./settings";
import { migrateProjectRecords, normalizeProjects } from "./project-state";
import { clamp } from "./visual";
import { invalidateLiteratureIndex } from "./vault-note";
import { ConnectedPapersView } from "./view";
import { cachedDoiRecovery, doiRecoveryKey, recoverDoi } from "./doi-recovery";
import { normalizeDoi } from "./paper";
import type { PaperNode } from "./types";
import { PAPER_REQUESTS_VIEW, PaperRequestsView } from "./paper-requests-view";

export interface LibraryDoiStatus {
	doi?: string;
	state: "found" | "not-found" | "ambiguous" | "skipped" | "failed";
	reason: string;
}

export default class ConnectedPapersPlugin extends Plugin {
	settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS };
	private pendingSave: Promise<void> = Promise.resolve();
	private library: ResearchLibrary | null = null;
	/** Repository and Node executable the current library was made for, so settings edits rebuild it. */
	private libraryKey: string | null = null;
	private doiLookups = new Map<string, Promise<LibraryDoiStatus>>();

	/** Recover from the note's own bibliography and fill only an empty DOI field. */
	recoverLibraryDoi(path: string): Promise<string | null> {
		return this.recoverLibraryDoiStatus(path).then(result => result.doi ?? null);
	}

	recoverLibraryDoiStatus(path: string): Promise<LibraryDoiStatus> {
		const pending = this.doiLookups.get(path);
		if (pending) return pending;
		const task = this.recoverNoteDoi(path);
		this.doiLookups.set(path, task);
		void task.finally(() => this.doiLookups.delete(path)).catch(() => {});
		return task;
	}

	private async recoverNoteDoi(path: string): Promise<LibraryDoiStatus> {
		if (!path.startsWith(PAPERS) || !path.endsWith(".md") || path.split(/[\\/]/).includes("..")) return { state: "skipped", reason: "Not a library paper note." };
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return { state: "skipped", reason: "The library note could not be found." };
		const property = this.settings.literatureDoiProperty.trim() || "doi";
		const props: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!props) return { state: "skipped", reason: "The note's bibliographic metadata is not available yet; search again to retry." };
		if (props[property]) {
			const doi = typeof props[property] === "string" ? normalizeDoi(props[property]) : null;
			return doi ? { state: "found", doi, reason: "DOI already recorded in the note." } : { state: "skipped", reason: "The note's DOI field is populated but invalid; review it before retrying." };
		}
		const makePaper = (fm: Record<string, unknown>): PaperNode => {
			const authors = Array.isArray(fm.authors) ? fm.authors.filter((name): name is string => typeof name === "string") : typeof fm.authors === "string" ? [fm.authors] : [];
			return { id: path, title: typeof fm.title === "string" ? fm.title : "", year: Number(fm.year) || null,
				authorList: authors, authors: authors.join(", "), venue: typeof fm.venue === "string" ? fm.venue : null,
				citedByCount: 0, abstract: "", doiUrl: null, openAlexUrl: "", isSeed: false, origin: "related",
				language: null, workType: null, concepts: [], retracted: false };
		};
		const paper = makePaper(props);
		const missing = [!paper.title && "title", !paper.year && "year", !paper.authorList.length && "authors"].filter(Boolean);
		if (missing.length) return { state: "skipped", reason: `Missing note metadata: ${missing.join(", ")}. Add it and search again.` };
		const key = doiRecoveryKey(paper);
		let result = cachedDoiRecovery(paper, this.settings.doiRecoveries);
		if (!result) {
			try { result = await recoverDoi(paper, obsidianGetJson, this.settings.contactEmail); }
			catch { return { state: "failed", reason: "The metadata services could not complete the lookup (connection, rate limit, or service error). Search again to retry." }; }
			this.settings.doiRecoveries = Object.fromEntries(Object.entries({ ...this.settings.doiRecoveries, [key]: result })
				.sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 500));
			try { await this.saveSettings(false); }
			catch { return { state: "failed", reason: "The lookup result could not be saved to Research Connected's cache. Search again to retry." }; }
		}
		if (result.state === "not-found") return { state: "not-found", reason: "No DOI matched the full title, compatible year, and author in Crossref or Europe PMC. A DOI may exist but could not be verified. Automatically checked again after one day." };
		if (result.state === "ambiguous") return { state: "ambiguous", reason: `${result.candidates.length} DOI candidates matched the bibliography; none was assigned. Review with Find DOI in Research Connected.` };
		const doi = normalizeDoi(result.candidates[0]?.doi);
		if (!doi) return { state: "failed", reason: "The metadata service returned an invalid DOI." };
		const verified = result;
		let saved: string | null = null;
		try { await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (fm[property]) { saved = typeof fm[property] === "string" ? normalizeDoi(fm[property]) : null; return; }
			// A user may edit the bibliography while the request is in flight.
			if (doiRecoveryKey(makePaper(fm)) !== key) return;
			fm[property] = doi;
			fm.doi_source = verified.candidates[0]!.source;
			fm.doi_verified_at = new Date(verified.checkedAt).toISOString();
			saved = doi;
		}); } catch { return { state: "failed", reason: "A verified DOI was found, but the library note could not be updated. Search again to retry." }; }
		return saved ? { state: "found", doi: saved, reason: "DOI recorded in the note." }
			: { state: "skipped", reason: "The note's bibliography or DOI field changed during lookup; no DOI was written. Search again to retry." };
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyResearchTools();
		this.registerBasesView(PAPER_REQUESTS_VIEW, {
			name: tr("论文下载", "Paper downloads"),
			icon: "download",
			factory: (controller, container) => new PaperRequestsView(controller, container, this),
		});
		// Vectors and open-access fields that graph builds fetch go to the research tools' caches.
		setFetchedEvidenceSink(evidence => this.researchLibrary()?.queueFetched(evidence));
		this.register(() => { setProviderPauseStore(null); setOpenAlexCache(null); setFetchedEvidenceSink(null); this.library?.dispose(); this.library = null; });

		// Main-area tab. The graph pane is the product, not a sidebar card list.
		this.registerView(VIEW_TYPE, (leaf) => new ConnectedPapersView(leaf, this));
		this.addCommand({ id: "open-related-papers", name: tr("查找相似论文", "Find similar papers"), callback: () => { void this.openSimilar(); } });
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
		this.registerDomEvent(window, "research-connected-find-similar", event => {
			void this.openSimilar(event.detail?.paper).catch(error => new Notice(error instanceof Error ? error.message : "Could not open similar papers"));
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
	}

	getSettings(): ConnectedPapersSettings {
		return this.settings;
	}

	private async openSimilar(paper?: string): Promise<void> {
		await this.openView();
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
		if (view instanceof ConnectedPapersView) view.openSimilar(paper);
	}

	/** Note embeds call this to jump to the full graph pane on their seed. */
	openGraph(target: { kind: "doi" | "openalex"; value: string }, options?: { newTab?: boolean }): void {
		void (async () => {
			const leaf = await this.openView(options?.newTab);
			const view = leaf.view;
			if (view instanceof ConnectedPapersView) view.openSeed(target);
		})();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<ConnectedPapersSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		// Research questions were retired; their selection has no remaining use.
		delete (this.settings as { activeQuestion?: unknown }).activeQuestion;
		const maxNodes = Number(this.settings.maxNodes);
		this.settings.maxNodes = Number.isFinite(maxNodes) ? clamp(maxNodes, 20, 300) : DEFAULT_SETTINGS.maxNodes;
		this.settings.researchProjects = migrateProjectRecords(normalizeProjects(stored?.researchProjects));
	}

	async saveSettings(notify = true): Promise<void> {
		const snapshot: unknown = JSON.parse(JSON.stringify(this.settings));
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

	/** Citation metadata for other vault views; networking, pacing and disk caching stay here. */
	async getCitationCounts(targets: Array<{ doi?: string; openalex?: string }>): Promise<Array<{ doi?: string; openalex?: string; citationCount: number }>> {
		const client = new OpenAlexClient(obsidianGetJson, this.settings);
		const dois = targets.map(target => target.doi?.trim().toLowerCase()).filter((doi): doi is string => !!doi && /^10\.\d{4,9}\/[^\s|,]+$/.test(doi));
		const ids = targets.filter(target => !target.doi).map(target => /(?:^|\/)(W\d+)\/?$/i.exec(target.openalex ?? "")?.[1]).filter((id): id is string => !!id);
		const works = [...await client.worksByDois(dois), ...await client.worksByIds(ids, "id,doi,cited_by_count")];
		return works.filter(work => Number.isInteger(work.cited_by_count) && work.cited_by_count! >= 0).map(work => ({
			doi: work.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase(),
			openalex: work.id, citationCount: work.cited_by_count!,
		}));
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

	/** Shares rate-limit pauses and OpenAlex responses with the configured repository and rebuilds the library when it changed. */
	private applyResearchTools(): void {
		const repository = this.researchRepository();
		// The research CLI's worker writes both; without research tools, pauses stay in memory and
		// requests go uncached.
		const worker = (): AvailabilityWorker | null => this.researchLibrary()?.worker() ?? null;
		try { setProviderPauseStore(repository ? providerPauseFiles(repository, async (service, pause) => worker()?.pause(service, pause.state, pause.until)) : null); } catch { setProviderPauseStore(null); }
		setOpenAlexCache(repository ? workerOpenAlexCache(worker) : null);
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

	private async openView(newTab = false) {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		const leaf = (!newTab && existing[0]) || workspace.getLeaf("tab");
		if (newTab || existing.length === 0) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf;
	}
}
