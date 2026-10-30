import { BasesView, type QueryController } from "obsidian";
import type ConnectedPapersPlugin from "./main";
import { vaultPaperLibrary } from "./vault-paper-library";
import { normalizeDoi } from "./paper";
import { acquisitionMessage } from "./paper-actions";
import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import type { PaperNode } from "./types";

export const PAPER_REQUESTS_VIEW = "research-connected-paper-requests";

/** Bases owns filtering/sorting; the shared library owns acquisition and in-flight saves. */
export class PaperRequestsView extends BasesView {
	readonly type = PAPER_REQUESTS_VIEW;
	private readonly container: HTMLElement;
	private readonly feedback = new Map<string, string>();
	private readonly pending = new Map<string, "checking" | "finding" | "downloading">();
	private readonly progress = new Map<string, string>();
	private active = false;

	constructor(controller: QueryController, parent: HTMLElement, private readonly plugin: ConnectedPapersPlugin) {
		super(controller);
		this.container = parent.createDiv({ cls: "cpo-paper-requests" });
	}

	onload(): void {
		this.active = true;
		this.registerDomEvent(window, "research-connected-library-changed", () => this.onDataUpdated());
	}

	onunload(): void { this.active = false; this.container.empty(); }

	onDataUpdated(): void {
		if (!this.data) return;
		this.container.empty();
		const library = vaultPaperLibrary(this.app, () => this.plugin.settings, () => this.plugin.researchLibrary());
		const order = this.config.getOrder();
		const table = this.container.createEl("table");
		const heading = table.createEl("thead").createEl("tr");
		for (const prop of order) heading.createEl("th", { text: this.config.getDisplayName(prop) });
		heading.createEl("th", { text: tr("下载", "Download") });
		const body = table.createEl("tbody");
		for (const group of this.data.groupedData) {
			if (group.hasKey()) {
				const cell = body.createEl("tr").createEl("th", { text: group.key?.toString() ?? "" });
				cell.colSpan = order.length + 1;
			}
			for (const entry of group.entries) {
				const file = entry.file;
				const row = body.createEl("tr");
				for (const prop of order) {
					const cell = row.createEl("td");
					if (prop === "file.name") {
						const link = cell.createEl("a", { text: file.basename, cls: "internal-link", href: file.path });
						link.addEventListener("click", event => { event.preventDefault(); void this.app.workspace.openLinkText(file.path, "", event.ctrlKey || event.metaKey); });
					} else cell.textContent = entry.getValue(prop)?.toString() ?? "";
				}
				const props = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
				const doiProperty = this.plugin.settings.literatureDoiProperty?.trim() || "doi";
				const doi = typeof props[doiProperty] === "string" ? normalizeDoi(props[doiProperty]) : null;
				const authors = Array.isArray(props.authors) ? props.authors.filter((a: unknown): a is string => typeof a === "string") : [];
				const paper: PaperNode = { id: `local:${file.path}`, title: typeof props.title === "string" ? props.title : file.basename,
					year: Number(props.year) || null, authors: authors.join(", "), authorList: authors, doiUrl: doi ? `https://doi.org/${doi}` : null,
					openAlexUrl: typeof props.openalex === "string" ? props.openalex : "", abstract: "", citedByCount: 0,
					isSeed: false, origin: "related", language: null, workType: null, venue: null, concepts: [], retracted: false };
				const attempted = typeof props.acquisition_attempted_at === "string" && props.acquisition_attempted_at !== "";
				const phase = this.pending.get(file.path);
				const state = library.read(paper), busy = !!phase || library.busy?.(paper);
				const cell = row.createEl("td");
				const button = cell.createEl("button", { text: phase === "checking" ? tr("检查文库…", "Checking library…") : phase === "finding" ? tr("查找 DOI…", "Finding DOI…") : busy ? (this.progress.get(file.path) || tr("等待下载…", "Waiting to download…")) : state.held ? tr("核对并清除请求", "Check / clear request") : attempted ? tr("重试下载", "Retry download") : tr("下载", "Download") });
				button.type = "button";
				button.disabled = !!busy;
				const skip = cell.createEl("button", { text: tr("标记为无法获取", "Mark unobtainable") });
				skip.type = "button";
				skip.disabled = !!busy;
				setHoverHint(skip, tr("记录为无法获取并从待获取列表移除；今后不再请求。", "Record as unobtainable and remove it from this list; it will not be requested again."));
				skip.addEventListener("click", () => {
					if (this.pending.has(file.path)) return;
					this.feedback.delete(file.path);
					this.pending.set(file.path, "checking");
					this.onDataUpdated();
					void (async () => {
						const service = this.plugin.researchLibrary();
						if (!service) throw new Error(tr("请在 Research Connected 设置中配置研究工具仓库。", "Set the research tools repository in Research Connected settings."));
						if (!await service.markUnobtainable(file.path)) throw new Error(tr("未能标记为无法获取。", "Could not mark this paper unobtainable."));
					})().catch((error: unknown) => {
						this.feedback.set(file.path, error instanceof Error ? error.message : tr("未能标记为无法获取。", "Could not mark this paper unobtainable."));
					}).finally(() => { this.pending.delete(file.path); if (this.active) this.onDataUpdated(); });
				});
				setHoverHint(button, tr("先核对本地全文并清除已完成请求，否则查找缺失 DOI 并下载。", "Check local full text and clear fulfilled requests first; otherwise find a missing DOI and download."));
				const message = this.feedback.get(file.path) || state.error || (state.ambiguous ? tr("匹配到多份文献笔记，请先核对。", "Multiple library notes match. Review them before saving.") : "");
				if (message) cell.createDiv({ text: message, attr: { role: "status" } });
				button.addEventListener("click", () => {
					if (this.pending.has(file.path)) return;
					this.feedback.delete(file.path);
					this.pending.set(file.path, "checking");
					this.onDataUpdated();
					void (async () => {
						const service = this.plugin.researchLibrary();
						if (!service) throw new Error(tr("请在 Research Connected 设置中配置研究工具仓库。", "Set the research tools repository in Research Connected settings."));
						if (await service.reconcileRequest(file.path)) return;
						if (state.held || state.ambiguous) throw new Error(tr("未能确认匹配的本地 PDF，请核对文件或导入全文后重试。", "Could not confirm a matching local PDF. Review the files or import full text and retry."));
						let lookupMessage = "";
						if (!doi) {
							this.pending.set(file.path, "finding");
							if (this.active) this.onDataUpdated();
							const recovered = await this.plugin.recoverLibraryDoiStatus(file.path);
							if (recovered.state === "found" && recovered.doi) paper.doiUrl = `https://doi.org/${recovered.doi}`;
							else if (recovered.state === "not-found") lookupMessage = recovered.reason;
							else throw new Error(recovered.reason);
						}
						this.pending.set(file.path, "downloading");
						if (this.active) this.onDataUpdated();
						const result = await library.save(paper, message => { this.progress.set(file.path, message); if (this.active) this.onDataUpdated(); });
						if (!result.held) this.feedback.set(file.path, [lookupMessage, acquisitionMessage(result.reason || "")].filter(Boolean).join(" "));
					})().catch((error: unknown) => {
						this.feedback.set(file.path, error instanceof Error ? error.message : tr("下载失败，请重试。", "Download failed. Try again."));
					}).finally(() => { this.pending.delete(file.path); this.progress.delete(file.path); if (this.active) this.onDataUpdated(); });
				});
			}
		}
		if (!this.data.data.length) this.container.createEl("p", { text: tr("没有待获取的论文。", "No papers to obtain.") });
	}
}
