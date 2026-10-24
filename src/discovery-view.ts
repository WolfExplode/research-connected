import { ItemView, WorkspaceLeaf } from "obsidian";
import { tr } from "./i18n";
import { SimilarityMap } from "./map-canvas";
import { mountGraphSurface } from "./graph-surface";
import { paintLibraryAvailability, requestLibraryBridge } from "./library-bridge";
import { openExternal } from "./open-external";
import { buildDiscoveryGraph, vaultPath, type DiscoveryPayload, type DiscoveryRequest } from "./discovery-graph";
import type { PaperNode } from "./types";

export const DISCOVERY_VIEW = "research-connected-discovery";

export class DiscoveryGraphView extends ItemView {
	private map: SimilarityMap | null = null;
	private graph: ReturnType<typeof buildDiscoveryGraph> | null = null;
	private payload: DiscoveryPayload | null = null;
	private detail: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private mode!: HTMLSelectElement;
	private question!: HTMLSelectElement;
	private paper!: HTMLInputElement;
	private query!: HTMLInputElement;
	private limit!: HTMLSelectElement;
	private controls: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [];
	private revision = 0;
	private busy = false;
	private closed = false;
	private selected: PaperNode | null = null;

	constructor(leaf: WorkspaceLeaf) { super(leaf); }
	getViewType(): string { return DISCOVERY_VIEW; }
	getDisplayText(): string { return tr("相关论文", "Related papers"); }
	getIcon(): string { return "network"; }

	async onOpen(): Promise<void> {
		this.closed = false;
		const root = this.contentEl;
		root.empty(); root.addClass("cpo-root", "cpo-discovery-root");
		const controls = createDiv({ cls: "cpo-discovery-controls" }); root.append(controls);
		const select = (label: string, options: Array<[string, string]>): HTMLSelectElement => {
			const field = createEl("label", { text: label });
			const input = createEl("select", { attr: { "aria-label": label } });
			for (const [value, text] of options) input.append(createEl("option", { value, text }));
			field.append(input); controls.append(field); this.controls.push(input); return input;
		};
		const context = requestLibraryBridge()?.discovery?.context();
		this.mode = select(tr("方法", "Method"), [["rank", "ASReview question ranking"], ["similar", tr("题名与研究摘要相似度", "Title/summary similarity")], ["search", "PaperQA2 PDF search"]]);
		this.question = select(tr("研究问题", "Question"), [["", tr("选择问题", "Choose question")], ...(context?.questions || []).map(q => [q.path, q.title] as [string, string])]);
		const paperLabel = createEl("label", { text: tr("种子论文", "Source paper") });
		this.paper = createEl("input", { type: "text", attr: { "aria-label": "Source paper", list: "cpo-discovery-paper-choices" }, placeholder: "Research/Papers/…md" });
		const choices = createEl("datalist", { attr: { id: "cpo-discovery-paper-choices" } });
		for (const paper of context?.papers || []) choices.append(createEl("option", { value: paper.path, text: paper.title }));
		paperLabel.append(this.paper, choices); controls.append(paperLabel); this.controls.push(this.paper);
		const queryLabel = createEl("label", { text: tr("PDF 查询", "PDF query") });
		this.query = createEl("input", { type: "search", attr: { "aria-label": tr("PDF 查询", "PDF query") } });
		queryLabel.append(this.query); controls.append(queryLabel); this.controls.push(this.query);
		this.limit = select(tr("论文数量", "Paper limit"), [["30", "30"], ["10", "10"], ["50", "50"], ["100", "100"]]);
		const add = (text: string, action: () => void): HTMLButtonElement => {
			const button = createEl("button", { text }); button.type = "button"; button.addEventListener("click", action);
			controls.append(button); this.controls.push(button); return button;
		};
		add(tr("生成图谱", "Generate graph"), () => { void this.generate(false); });
		add(tr("建立前 12 篇 PDF 索引", "Index top 12 PDFs"), () => { void this.generate(true); });
		const layout = select(tr("布局", "Layout"), [["radial", tr("放射状", "Radial")], ["force2d", tr("平面", "Planar")], ["temporal", tr("时间线", "Timeline")]]);
		layout.addEventListener("change", () => this.map?.setLayout(layout.value as "radial" | "force2d" | "temporal"));
		this.limit.addEventListener("change", () => { if (this.payload) this.showPayload(this.payload); });
		this.status = createEl("p", { cls: "cpo-discovery-status", attr: { role: "status", "aria-live": "polite" }, text: context ? tr("选择方法后生成图谱。", "Choose a method and generate a graph.") : tr("请启用 Research Vault 插件。", "Enable Research Vault to use local discovery.") });
		root.append(this.status);
		const body = createDiv({ cls: "cpo-discovery-body" }); root.append(body);
		const surface = mountGraphSurface(body, { canvasLabel: "Related local papers", title: tr("相关论文", "Related papers"), hint: tr("尚未生成图谱", "No graph generated yet"), mutations: false });
		this.detail = createEl("aside", { cls: "cpo-discovery-detail" }); body.append(this.detail);
		const map = new SimilarityMap(surface.canvas, surface.tooltip, surface.stage); this.map = map;
		map.setKinds({ direct: false, cocitation: false, coupling: false, weak: true });
		map.setLayout("radial"); map.setColorMode("graph");
		map.libraryStatus = paper => paper.id === "discovery:query" ? null : requestLibraryBridge()?.read(paper) ?? null;
		map.onSelect = paper => this.showPaper(paper);
		map.onEdgeSelect = edge => { const node = this.graph?.nodes.find(n => n.id === edge.target); if (node) this.showPaper(node); };
		surface.zoomIn.addEventListener("click", () => map.zoomBy(1.2));
		surface.zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
		surface.fit.addEventListener("click", () => map.fit(true));
		surface.reload.hidden = true;
		const observer = new ResizeObserver(() => map.resize()); observer.observe(surface.stage);
		this.register(() => observer.disconnect());
		this.registerDomEvent(window, "research-connected-library-changed", () => {
			if (this.graph) requestLibraryBridge()?.prefetch?.(this.graph.nodes);
			map.refreshLibraryStatus(); if (this.selected) this.showPaper(this.selected);
		});
		this.registerDomEvent(window, "research-connected-theme", () => map.resize());
	}

	setSource(paper: string): void { this.paper.value = paper; this.mode.value = "similar"; }

	showPayload(payload: DiscoveryPayload): void {
		const graph = buildDiscoveryGraph(payload, Number(this.limit.value));
		this.revision++; this.payload = payload; this.graph = graph;
		this.question.value = payload.question || ""; this.query.value = payload.query || "";
		this.mode.value = payload.mode === "search" ? "search" : payload.mode;
		if (payload.source?.note) this.paper.value = payload.source.note;
		this.map?.setGraph(graph.nodes, graph.edges, graph.seedScore);
		requestLibraryBridge()?.prefetch?.(graph.nodes);
		this.contentEl.querySelector<HTMLElement>(".cpo-empty")!.hidden = true;
		this.showPaper(graph.nodes[0]!);
		if (this.status) this.status.textContent = `${payload.engine === "paperqa" ? "PaperQA2" : payload.mode === "rank" ? "ASReview" : tr("题名与研究摘要相似度", "Title/summary similarity")}: ${graph.nodes.length - 1}/${graph.total} ${tr("篇论文", "papers")}. ${payload.notice || ""} ${tr("连线表示查询结果，不代表引用关系或论文之间的关联。", "Edges show results for this query/source, not citations or pairwise relationships.")}`;
	}

	private async generate(index: boolean): Promise<void> {
		if (this.busy) return;
		const discovery = requestLibraryBridge()?.discovery;
		if (!discovery) { if (this.status) this.status.textContent = tr("请启用 Research Vault 以运行发现工具。", "Enable Research Vault to run discovery."); return; }
		const request: DiscoveryRequest = { engine: index || this.mode.value === "search" ? "paperqa" : "asreview", mode: this.mode.value === "similar" ? "similar" : "rank", question: this.question.value, paper: this.paper.value, query: this.query.value };
		if (index) {
			request.action = "index";
			if (this.payload?.engine === "asreview" && this.payload.question === request.question) request.selection = this.payload.papers;
		}
		const revision = ++this.revision;
		this.busy = true; for (const control of this.controls) control.disabled = true;
		if (this.status) this.status.textContent = index ? "Indexing selected PDFs locally…" : "Generating related-paper graph…";
		try {
			const payload = await discovery.run(request);
			if (this.closed || revision !== this.revision) return;
			if (index) { if (this.status) this.status.textContent = `${payload.indexed} PDFs indexed. Choose PaperQA2 PDF search and enter query words.`; this.mode.value = "search"; }
			else this.showPayload(payload);
		} catch (error) {
			if (!this.closed && revision === this.revision && this.status) this.status.textContent = error instanceof Error ? error.message : String(error);
		} finally { this.busy = false; for (const control of this.controls) control.disabled = false; }
	}

	private showPaper(paper: PaperNode | null): void {
		this.selected = paper;
		if (!this.detail || !this.payload || !this.graph) return;
		this.detail.replaceChildren();
		if (!paper) return;
		this.map?.setSelected(paper.id);
		this.detail.append(createEl("h3", { text: paper.title }));
		const row = this.graph.rows.get(paper.id);
		if (!row) {
			this.detail.append(createEl("p", { text: tr("此节点代表研究问题或查询。选择论文查看结果及本地全文。", "This node represents the question or query. Select a paper to inspect its result and local full text.") })); return;
		}
		const text = this.payload.mode === "rank" ? `ASReview priority percentile: ${row.priority ?? "training seed"}. Screening order, not a relevance probability.`
			: this.payload.mode === "similar" ? `Title/summary TF-IDF cosine similarity: ${row.similarity ?? "source"}${row.similarity == null ? "" : "%"}.`
				: `PaperQA2 retrieval rank: ${row.rank ?? "unknown"}. This is a retrieval position, not a calibrated similarity score.`;
		this.detail.append(createEl("p", { text }));
		if (row.label) this.detail.append(createEl("p", { text: `Question judgment: ${row.label}` }));
		const bridge = requestLibraryBridge();
		if (bridge) {
			// Use exact result paths for DOI-less local papers, including deliberately short titles.
			const note = vaultPath(row.note), file = vaultPath(row.pdf || row.file);
			for (const [target, label] of [[note, tr("打开笔记", "Open result note")], [file, tr("打开 PDF", "Open result PDF")]]) if (target) {
				const button = createEl("button", { text: label! }); button.type = "button";
				button.addEventListener("click", () => bridge.open(target)); this.detail.append(button);
			}
			paintLibraryAvailability(this.detail, paper, bridge, openExternal);
		}
	}

	async onClose(): Promise<void> { this.closed = true; this.revision++; this.map?.destroy(); this.map = null; this.contentEl.empty(); }
}
