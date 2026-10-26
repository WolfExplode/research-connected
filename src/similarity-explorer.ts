import { literatureQuery } from "./workflow/literature-search";
import { createCountControl } from "./count-control";
import type { InfoMessage } from "./info-bar";
import { tr } from "./i18n";
import { paintLibraryAvailability, type LibraryBridge, type DoiRecoveryAction } from "./library-bridge";
import { paintAbstractCard, paintComparisonCard, paintMetadataCard } from "./detail-cards";
import type { SimilarityGraph } from "./neighborhood";
import { comparisonData, type SimilarityKind, type StoredTextEvidence } from "./paper-comparison";
import { searchSimilarity, type LibraryTextPaper, type SearchResult, type SearchScope } from "./similarity-search";
import type { PaperNode } from "./types";
import type { CitationComparisonResult } from "./workflow/comparison-citations";

/** Transient search UI: never writes library files or replaces a saved citation graph. */
export function mountSimilarityExplorer(stage: HTMLElement, bridge: () => LibraryBridge | null,
	onChange: () => void, onNeighbors: (paper: PaperNode) => Promise<boolean> | void,
	onNeighborActionChange?: () => void,
	loadCitations?: (graph: SimilarityGraph) => Promise<CitationComparisonResult>,
	options?: { controlsHost?: HTMLElement; before?: HTMLElement; literature?: (paper: PaperNode, refresh?: boolean) => Promise<readonly PaperNode[]> }) {
	const bar = createDiv(); bar.className = "cpo-similarity-search"; bar.hidden = true;
	const scope = createEl("select"); scope.setAttribute("aria-label", "Similarity search scope");
	for (const [value, title] of [["library", tr("我的文库", "My library")], ["external", options?.literature ? tr("更广泛文献", "Wider literature") : tr("已获取论文", "Fetched papers")], ["both", tr("两者", "Both")]]) {
		const option = createEl("option"); option.value = value!; option.textContent = title!; scope.append(option);
	}
	scope.value = bridge()?.textLibrary ? "library" : "external";
	const count = createCountControl({ label: "Similarity result limit", presetLabel: "Choose result limit preset",
		initial: 50, max: 300, presets: [20, 50, 100, 300], onChange });
	const limitLabel = count.element, limit = count.input;
	const neighbors = createEl("button"); neighbors.type = "button"; neighbors.className = "cpo-ghost";
	neighbors.textContent = tr("探索引用", "Explore citations");
	const retry = createEl("button"); retry.type = "button"; retry.className = "cpo-ghost";
	retry.textContent = tr("重试文库检索", "Retry library search"); retry.hidden = true;
	const retryCitations = createEl("button"); retryCitations.type = "button"; retryCitations.className = "cpo-ghost";
	retryCitations.textContent = tr("重试引用数据", "Retry citation data"); retryCitations.hidden = true;
	const retryLiterature = createEl("button", { text: tr("重试文献搜索", "Retry literature search") });
	retryLiterature.type = "button"; retryLiterature.className = "cpo-ghost"; retryLiterature.hidden = true;
	bar.append(scope, limitLabel, retry, retryLiterature, retryCitations); (options?.controlsHost ?? stage).insertBefore(bar, options?.before ?? null);
	if (options?.controlsHost) bar.classList.add("cpo-similarity-toolbar");
	let info: InfoMessage | null = null;
	let library: LibraryTextPaper[] | null = null;
	let pending = false, error = "", alive = true, revision = 0;
	let remote: readonly PaperNode[] | undefined, remoteKey = "", remotePending = false, remoteError = "", remoteRevision = 0;
	let refreshRemote = false;
	let extraText: readonly StoredTextEvidence[] = [], textKey = "", textRevision = 0;
	let base: SimilarityGraph | null = null, center: PaperNode | undefined;
	let active = false, result: SearchResult | null = null;
	const citationAttempts = new WeakSet<SimilarityGraph>();
	let citationPending: SimilarityGraph | null = null, citationFailed = 0;
	retryCitations.addEventListener("click", () => {
		if (result) citationAttempts.delete(result.graph);
		changed();
	});
	let last: { graph: SimilarityGraph; evidence: readonly StoredTextEvidence[]; center?: PaperNode; library: LibraryTextPaper[] | null; scope: string; limit: string; remote?: readonly PaperNode[]; extraText: readonly StoredTextEvidence[] } | null = null;
	const changed = (): void => { onChange(); };
	retry.addEventListener("click", () => { invalidate(); changed(); });
	scope.addEventListener("change", changed);
	retryLiterature.addEventListener("click", () => { refreshRemote = true; remoteKey = ""; changed(); });
	let neighborsLoading = false;
	const syncNeighbors = (): void => {
		const seed = result?.graph.nodes.find(paper => paper.isSeed);
		neighbors.disabled = neighborsLoading || (!seed?.doiUrl && !/^W\d+$/i.test(seed?.id ?? ""));
		neighbors.textContent = neighborsLoading ? tr("加载中…", "Loading…")
			: tr("探索引用", "Explore citations");
		onNeighborActionChange?.();
	};
	neighbors.addEventListener("click", () => {
		const seed = result?.graph.nodes.find(paper => paper.isSeed);
		if (!seed || neighborsLoading) return;
		neighborsLoading = true; syncNeighbors();
		void (async () => {
			try {
				await onNeighbors(seed);
			} catch {
				// Keep the action available for retry; the graph host reports load errors.
			} finally {
				neighborsLoading = false;
				if (alive) syncNeighbors();
			}
		})();
	});
	function invalidate(): void { revision++; library = null; pending = false; error = ""; textKey = ""; textRevision++; }
	function load(): void {
		const provider = bridge();
		if (typeof provider?.textLibrary !== "function" || library || pending || error) return;
		const token = revision; pending = true;
		void provider.textLibrary().then(rows => {
			if (!alive || token !== revision) return;
			library = rows; pending = false; changed();
		}).catch(reason => {
			if (!alive || token !== revision) return;
			error = reason instanceof Error ? reason.message : String(reason); pending = false; changed();
		});
	}
	function loadLiterature(paper: PaperNode): void {
		if (!options?.literature || scope.value === "library") return;
		const key = `${paper.id}:${literatureQuery(paper)}`;
		if (remoteKey === key) return;
		remoteKey = key; remote = []; remoteError = ""; remotePending = true;
		const token = ++remoteRevision, refresh = refreshRemote; refreshRemote = false;
		void options.literature(paper, refresh).then(papers => {
			if (!alive || !active || token !== remoteRevision) return;
			remote = papers; remotePending = false; changed();
		}).catch(reason => {
			if (!alive || !active || token !== remoteRevision) return;
			remoteError = reason instanceof Error ? reason.message : String(reason); remotePending = false; changed();
		});
	}
	return {
		get contextKey() { return active ? `${scope.value}:${limit.value}:${center?.id ?? ""}` : ""; },
		get status() { return active ? info : null; },
		get searching() { return active && (scope.value !== "library" && remotePending || scope.value !== "external" && pending); },
		get apiError() { return active ? [scope.value !== "external" ? error : "", scope.value !== "library" ? remoteError : ""].filter(Boolean).join("; ") : ""; },
		get result() { return active ? result : null; },
		invalidate,
		seedLibrary(rows: LibraryTextPaper[]): void { library = rows; scope.value = "library"; last = null; },
		refresh(): void { refreshRemote = true; remoteKey = ""; invalidate(); changed(); },
		setScope(value: SearchScope): void { scope.value = value; changed(); },
		setCenter(paper: PaperNode): void { center = paper; changed(); },
		paintDetail(parent: HTMLElement, paper: PaperNode, kind: SimilarityKind, openExternal: (url: string) => void, recovery?: DoiRecoveryAction): boolean {
			if (!active || !result?.graph.nodes.some(node => node.id === paper.id)) return false;
			paintMetadataCard(parent, paper, result.graph.crossCheck?.get(paper.id));
			if (paper.isSeed && !neighbors.disabled) {
				const actions = parent.querySelector(".cpo-paper-actions") ?? createDiv({ cls: "cpo-paper-actions" });
				if (!actions.parentElement) parent.append(actions);
				actions.append(neighbors);
			}
			if (!paper.isSeed) {
				paintComparisonCard(parent, kind, result.scores[kind].get(paper.id), result.scores.details.get(paper.id));
				if (kind === "citations" && !result.scores.citations.has(paper.id)) {
					const hint = createEl("p"); hint.textContent = tr("尚未加载此论文的引用证据；不可用不代表没有相似性。", "Citation evidence has not been loaded for this paper; unavailable does not mean unrelated."); parent.append(hint);
				}
				const compare = createEl("button"); compare.type = "button"; compare.textContent = tr("设为比较中心", "Compare with this paper");
				compare.addEventListener("click", () => { center = { ...paper, isSeed: true }; changed(); }); parent.append(compare);
			}
			paintAbstractCard(parent, paper, () => paper.abstract || tr("没有摘要或研究总结。", "No abstract or study summary available."));
			const provider = bridge();
			if (provider) {

				paintLibraryAvailability(parent, paper, provider, openExternal, recovery);
			}
			return true;
		},
		update(graph: SimilarityGraph | null, evidence: readonly StoredTextEvidence[], enabled: boolean, kind: SimilarityKind = "text"): SearchResult | null {
			active = enabled && Boolean(graph); bar.hidden = !active;
			if (!active || !graph) {
				if (remotePending) { remoteRevision++; remotePending = false; remoteKey = ""; }
				textRevision++; textKey = "";
				info = null; return null;
			}
			if (base !== graph) {
				base = graph; center = undefined;
			}
			const available = library !== null || typeof bridge()?.textLibrary === "function";
			for (const option of Array.from(scope.options)) option.disabled = option.value !== "external" && !available;
			if (!available) scope.value = "external";
			// Local evidence also improves paired scores for the external pool without downloading anything.
			if (available) load();
			const source = center ?? graph.nodes.find(paper => paper.isSeed);
			if (source) loadLiterature(source);
			const provider = bridge();
			const enrichment = source ? [source, ...(remote ?? [])] : [];
			const key = enrichment.map(paper => `${paper.id}:${paper.abstract}`).join("\n");
			if (provider?.textEvidence && enrichment.length && textKey !== key) {
				textKey = key; const token = ++textRevision;
				void provider.textEvidence(enrichment).then(rows => {
					if (!alive || !active || token !== textRevision) return;
					extraText = rows; changed();
				}).catch(() => { /* Existing text and word scores remain usable. */ });
			}
			if (!last || last.graph !== graph || last.evidence !== evidence || last.center !== center || last.library !== library || last.scope !== scope.value || last.limit !== limit.value || last.remote !== remote || last.extraText !== extraText) {
				result = searchSimilarity(graph, library ?? [], scope.value as SearchScope, Number(limit.value), [...evidence, ...extraText], center, options?.literature ? remote ?? [] : undefined);
				last = { graph, evidence, center, library, scope: scope.value, limit: limit.value, remote, extraText };
			}
			if (!result) return null;
			if (kind === "citations" && loadCitations && !citationAttempts.has(result.graph)) {
				const target = result;
				citationAttempts.add(target.graph); citationPending = target.graph; citationFailed = 0;
				void loadCitations(target.graph).then(loaded => {
					if (!alive || result !== target) return;
					target.graph = loaded.graph; citationAttempts.add(loaded.graph);
					citationPending = null; citationFailed = loaded.failed; changed();
				}).catch(() => {
					if (!alive || result !== target) return;
					citationPending = null; citationFailed = 1; changed();
				});
			}
			// Reference lists can be enriched in place; refresh citations without reranking papers.
			result.scores.citations = comparisonData(result.graph).citations;
			retryCitations.hidden = kind !== "citations" || !citationFailed;
			syncNeighbors();
			const localScope = scope.value !== "external", widerScope = scope.value !== "library";
			bar.setAttribute("aria-busy", String(localScope && pending || widerScope && remotePending || kind === "citations" && citationPending === result.graph));
			retry.hidden = !localScope || !error;
			retryLiterature.hidden = !widerScope || !remoteError;
			const label = kind === "text" ? tr("文本相似度", "Text similarity") : tr("引用相似度", "Citation similarity");
			const counts = tr(`已比较 ${result.compared} 篇 · 显示 ${result.shown} 篇`, `Compared ${result.compared} · showing ${result.shown}`);
			info = widerScope && remoteError ? { kind: "error", text: tr(`文献搜索失败：${remoteError}`, `Literature search failed: ${remoteError}`) }
				: widerScope && remotePending ? { kind: "busy", text: tr("正在搜索更广泛文献…", "Searching wider literature…") }
				: localScope && error ? { kind: "error", text: tr(`文库检索失败：${error}`, `Library search failed: ${error}`) }
				: localScope && pending ? { kind: "busy", text: tr("正在读取文库…", "Loading library…") }
				: kind === "citations" && citationPending === result.graph ? { kind: "busy", text: tr("正在加载比较论文的引用数据…", "Loading citation data for comparison papers…") }
				: kind === "citations" && citationFailed ? { kind: "error", text: tr("部分引用数据加载失败。请重试。", "Some citation data failed to load. Please retry.") }
				: { kind: "summary", text: result.compared ? `${label} · ${counts}` : `${label} · ${tr("当前范围内没有可比较的论文。", "No comparison papers in this scope.")}`,
					detail: [widerScope && options?.literature ? tr("OpenAlex 语义检索每次最多获取 50 篇候选，再按本地文本分数排序。", "OpenAlex retrieves up to 50 candidates per query, then local Text scores rank them.") : "",
						kind === "text" && result.fallback ? tr(`${result.fallback} 篇使用词语重合度。`, `${result.fallback} papers use word overlap.`) : ""].filter(Boolean).join(" ") || undefined };
			return result;
		},
		destroy(): void { alive = false; revision++; remoteRevision++; textRevision++; bar.remove(); },
	};
}
