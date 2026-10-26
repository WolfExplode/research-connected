import type { PaperLibrary } from "./paper-library";
import { createLiteratureSearch } from "./workflow/literature-search";
import { createInfoBar, graphInfo } from "./info-bar";
import { setHoverHint } from "./hover-hint";
import { readingChangePending, saveReadingState } from "./workflow/reading-state";
import { createComparisonCitations } from "./workflow/comparison-citations";
import { graphApiStatus } from "./api-status";
import { mountNodePopover } from "./node-popover";
import { paperRecords, workIndex, WORK_IDENTITY_VERSION } from "./work-identity";
import { isChinese, tr } from "./i18n";
import { mountSimilarityExplorer } from "./similarity-explorer";
import { comparisonData, type SimilarityKind, type StoredTextEvidence, type TextComparison } from "./paper-comparison";
import { paintComparisonCard } from "./detail-cards";
import { paintLocalPaperAction, type LibraryBridge } from "./library-bridge";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks, type RankedWork } from "./aggregates";
import { CrossrefClient, crossrefAbstract, semanticAbstract, SemanticScholarClient, OpenCitationsClient, doisFromOpenCitation, doiFromPaper, type PostJson } from "./citation-sources";
import { mergeOpenCitation } from "./citation-evidence";
import { edgeSourcesText, ORIGIN_TEXT, paintAbstractCard, paintAggregateCard, paintIdentitySources, paintLiteratureLink, paintMetadataCard, paintMeter, paintPaperWorkflowState, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { EMBED_HEIGHT_LIMIT, EMBED_WIDTH_LIMIT, parseEmbed, type EmbedSpec } from "./embed-syntax";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, visibleNodes, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { literatureFilename, literatureMarkdown, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { mountGraphSurface, placeNodeMenu } from "./graph-surface";
import { graftNodes, normalizeWorkGraph, omitNode, separateWorkRecords } from "./graph-edit";
import { diagnoseCandidate, loadNeighborhood, type LoadStage, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { referenceIds, shortId, toPaper } from "./paper";
import { findEdge } from "./relation";
import { paintPaperActions } from "./paper-actions";
import type { ConnectedPapersSettings } from "./settings-model";
import { acknowledgeIdentityStates, reconcileProjectIdentity, restoreGraphSnapshot, saveGraphSnapshot, updateProjectPaperState, type ReadingStatus } from "./project-state";
import type { GraphEdge, PaperNode } from "./types";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode } from "./responsive";

export interface EmbedDeps {
	source: string;
	getSettings: () => ConnectedPapersSettings;
	persistSettings?: () => Promise<void> | void;
	getJson: GetJson;
	postJson?: PostJson;
	openExternal: (url: string) => void;
	paperLibrary?: PaperLibrary;
	/** Holdings, availability and stored text from the research tools; null when none are configured. */
	libraryBridge?: () => LibraryBridge | null;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	createNote?: (filename: string, markdown: string, folder?: string) => Promise<string | void>;
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; reading: ReadingStatus | null; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	syncLiteratureReading?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
	rememberLiteratureNote?: (paper: PaperNode, path: string, reading: ReadingStatus) => void;
	/** Open the full graph pane on this seed, when the host supports it. */
	openGraph?: (target: { kind: "doi" | "openalex"; value: string }) => void;
}

const STAGE_TEXT: Record<LoadStage, string> = {
	resolving: tr("正在解析种子论文…", "Resolving the seed paper…"),
	fetching: tr("正在读取参考文献、施引文献和相关作品…", "Loading references, citing papers, and related works…"),
	scoring: tr("正在计算相似度…", "Calculating similarity…"),
};

const cache = new Map<string, SimilarityGraph>();

/** Filter and layout remembered per block key across remounts. */
interface EmbedViewState {
	distanceScale?: import("./layout-modes").DistanceScale;
	similarityKind?: SimilarityKind;
	filter: GraphFilter;
	layout: LayoutMode;
}
const viewStates = new Map<string, EmbedViewState>();

/** Reading view and Live Preview share this DOM. It does not import Obsidian. */
export function mountEmbed(root: HTMLElement, deps: EmbedDeps): () => void {
	const library = (): LibraryBridge | null => deps.libraryBridge?.() ?? null;
	const saveReading = (paper: PaperNode, seedId: string, reading: ReadingStatus, previous: ReadingStatus, source: string): Promise<void> =>
		saveReadingState({ projects: deps.getSettings().researchProjects, seedId, paper, reading, previous,
			persist: () => deps.stagePaper?.(paper, seedId, source), syncNote: deps.syncLiteratureReading }).catch((error: unknown) => {
			infoBar.notify(error instanceof Error ? error.message : tr("阅读状态保存失败", "Could not save reading status"), "error");
			throw error;
		});

	root.classList.add("cpo-embed-host");
	root.replaceChildren();
	const parsed = parseEmbed(deps.source);
	const shell = createDiv();
	shell.className = "cpo-embed";
	shell.lang = isChinese() ? "zh-CN" : "en";
	root.append(shell);

	const bar = createEl("header");
	bar.className = "cpo-bar";
	const topLine = createDiv();
	topLine.className = "cpo-topline";
	const brand = createDiv();
	brand.className = "cpo-brand";
	const brandMark = createSpan();
	brandMark.className = "cpo-brand-mark";
	brandMark.textContent = "R";
	const brandName = createEl("strong");
	brandName.textContent = "Research Connected";
	brand.append(brandMark, brandName);
	const status = createEl("p");
	status.className = "cpo-status";
	const infoBar = createInfoBar(status);
	status.setAttribute("role", "status");

	topLine.append(brand, status);
	bar.append(topLine);
	shell.append(bar);

	const body = createDiv();
	body.className = "cpo-body is-rail-collapsed";
	if (parsed.ok) body.style.height = `${parsed.spec.height}px`;
	shell.append(body);

	const rail = createEl("aside");
	rail.className = "cpo-rail";
	const layoutHost = createDiv();
	layoutHost.className = "cpo-rail-layouts";
	const scrubHost = createDiv();
	scrubHost.className = "cpo-rail-scrub";
	const railToggle = createEl("button");
	railToggle.type = "button";
	railToggle.className = "cpo-panel-toggle is-left";
	railToggle.textContent = "›";
	railToggle.setAttribute("aria-label", tr("展开左侧栏", "Expand left sidebar"));
	railToggle.setAttribute("aria-expanded", "false");
	rail.append(layoutHost, scrubHost, railToggle);

	body.append(rail);
	const surface = mountGraphSurface(body, { canvasLabel: tr("论文相似度图谱", "Paper similarity graph"), title: "", hint: "", mutations: false });
	const { stage, canvas, empty: message, messageText, tooltip, nodeMenu, seedItem, zoom, zoomIn, zoomOut, fit: zoomFit, reload } = surface;
	const openGraphAction = createEl("button");
	openGraphAction.type = "button";
	openGraphAction.className = "cpo-ghost cpo-open-graph";
	openGraphAction.append(createChromeIcon("external"), document.createTextNode(tr("在图谱中打开", "Open in graph")));
	topLine.append(openGraphAction);
	for (const button of [openGraphAction]) {
		button.hidden = true;
	}
	const sidebarResize = createDiv();
	sidebarResize.className = "cpo-sidebar-resizer";
	const sidebar = createEl("aside");
	sidebar.className = "cpo-evidence-sidebar";
	const sidebarToggle = createEl("button");
	sidebarToggle.type = "button";
	sidebarToggle.className = "cpo-panel-toggle is-right";
	sidebarToggle.textContent = "›";
	sidebarToggle.setAttribute("aria-label", tr("折叠右侧栏", "Collapse right sidebar"));
	sidebarToggle.setAttribute("aria-expanded", "true");
	sidebar.append(sidebarToggle);
	body.append(sidebarResize, sidebar);
	const evidenceHeader = createEl("header");
	evidenceHeader.className = "cpo-evidence-header";
	const evidenceTitle = createEl("h2");
	evidenceTitle.textContent = tr("论文详情与关联依据", "Paper details & evidence");
	const evidenceTools = createDiv();
	evidenceTools.className = "cpo-evidence-tools";
	evidenceTools.setAttribute("role", "toolbar");
	evidenceTools.setAttribute("aria-label", tr("论文操作", "Paper actions"));
	const diagnoseButton = createEl("button");
	diagnoseButton.type = "button";
	diagnoseButton.className = "cpo-diagnose";
	diagnoseButton.append(createChromeIcon("diagnose"), document.createTextNode(tr("诊断候选", "Inspect")));
	diagnoseButton.setAttribute("aria-label", tr("诊断候选", "Inspect candidate"));
	diagnoseButton.disabled = true;
	evidenceTools.append(diagnoseButton);
	evidenceHeader.append(evidenceTitle, evidenceTools);
	sidebar.append(evidenceHeader);
	const sheetHost = createEl("section");
	sidebar.append(sheetHost);
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = createDiv();
	detail.className = "cpo-detail";
	const listPanel = createDiv();
	listPanel.className = "cpo-agg";
	listPanel.hidden = true;
	sheet.body.append(detail, listPanel);
	const actionsBar = createDiv();
	actionsBar.className = "cpo-actions-bar";
	sidebar.append(actionsBar);

	if (!parsed.ok) {
		shell.classList.add("is-error");
		infoBar.notify(tr("代码块还不能建图", "This code block cannot build a graph yet"), "error");
		messageText.textContent = parsed.error;
		reload.hidden = true;
		rail.hidden = true;
		sidebar.hidden = true;
		sidebarResize.hidden = true;
		sheetHost.hidden = true;
		zoom.hidden = true;
		return () => {
			root.replaceChildren();
			root.classList.remove("cpo-embed-host");
		};
	}

	const spec = parsed.spec;
	canvas.classList.add("cpo-embed-canvas");
	const stateKey = cacheKey(spec.target, spec.maxNodes ?? deps.getSettings().maxNodes, spec.depth, deps.getSettings());
	const saved = viewStates.get(stateKey);
	let viewFilter = saved?.filter ?? filterFromSpec(spec);
	openGraphAction.hidden = !deps.openGraph;
	openGraphAction.onclick = deps.openGraph ? () => deps.openGraph?.(spec.target) : null;
	const map = new SimilarityMap(canvas, tooltip, stage, { wheel: "modifier" });
	const afterPanelToggle = (): void => {
		map.resize();
		window.setTimeout(() => map.resize(), 240);
	};
	railToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-rail-collapsed");
		railToggle.textContent = on ? "›" : "‹";
		railToggle.setAttribute("aria-expanded", on ? "false" : "true");
		railToggle.setAttribute("aria-label", on ? tr("展开左侧栏", "Expand left sidebar") : tr("折叠左侧栏", "Collapse left sidebar"));
		afterPanelToggle();
	});
	sidebarToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-sidebar-collapsed");
		sidebarToggle.textContent = on ? "‹" : "›";
		sidebarToggle.setAttribute("aria-expanded", on ? "false" : "true");
		sidebarToggle.setAttribute("aria-label", on ? tr("展开右侧栏", "Expand right sidebar") : tr("折叠右侧栏", "Collapse right sidebar"));
		afterPanelToggle();
	});
	const applyFilter = (): void => {
		map.setKinds(viewFilter.kinds);
		map.setScrubYear(viewFilter.scrubYear);
	};
	let layoutMode: LayoutMode = saved?.layout ?? spec.layout;
	let similarityKind: SimilarityKind = saved?.similarityKind ?? "text";
	let storedText: StoredTextEvidence[] = [];
	let comparison = { text: new Map<string, number>(), citations: new Map<string, number>(), details: new Map<string, TextComparison>() };
	let storedTextRevision = 0;
	let storedTextGraph: SimilarityGraph | null = null;
	surface.distanceScale.value = saved?.distanceScale ?? "relative";
	let scopedActive = false;
	let similaritySearch = false;
	const exploreTools = createDiv({ cls: "cpo-embed-explore" }); bar.append(exploreTools);
	const method = createEl("select"); method.setAttribute("aria-label", "Explore method");
	method.append(createEl("option", { value: "citation", text: tr("探索引用", "Explore citations") }),
		createEl("option", { value: "similar", text: tr("查找相似论文", "Find similar papers") }));
	exploreTools.append(method);
	method.addEventListener("change", () => {
		similaritySearch = method.value === "similar"; refreshSimilarityScores();
		const pool = similarityExplorer.result?.graph ?? currentGraph;
		if (pool) showDetail(pool.nodes.find(paper => paper.isSeed) ?? null, pool, null);
	});
	const similarityExplorer = mountSimilarityExplorer(stage, library, () => {
		if (!alive) return;
		refreshSimilarityScores();
		const current = similarityExplorer.result?.graph.nodes.find(paper => paper.id === selected?.id)
			?? similarityExplorer.result?.graph.nodes.find(paper => paper.isSeed);
		if (current && currentGraph) showDetail(current, currentGraph, null);
	}, paper => {
		const doi = paper.doiUrl?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
		if (doi) deps.openGraph?.({ kind: "doi", value: doi });
		else if (/^W\d+$/i.test(paper.id)) deps.openGraph?.({ kind: "openalex", value: paper.id });
	}, undefined, createComparisonCitations(() => new OpenAlexClient(deps.getJson, deps.getSettings())), { controlsHost: exploreTools,
		literature: createLiteratureSearch(() => new OpenAlexClient(deps.getJson, deps.getSettings()), () => deps.getSettings().excludeRetracted) });
	function refreshSimilarityScores(): void {
		surface.apiStatus.refresh();
		surface.diversifyResults.disabled = reload.disabled || similaritySearch || layoutMode === "radial";
		surface.diversityHint.textContent = layoutMode === "radial"
			? tr("相似度搜索直接按文本分数排序；多样化仅用于引用邻居筛选。", "Similarity search ranks directly by text score; diversity applies only to citation-neighbor selection.")
			: tr("减少重复候选，为不同论文留出空间。更改后重新构建引用图谱。", "Reduce redundant candidates to make room for different papers. Changes rebuild the citation graph.");
		map.setDistanceScale(surface.distanceScale.value === "absolute" ? "absolute" : "relative");
		setHoverHint(surface.diversifyResults.parentElement!, surface.diversityHint.textContent ?? "");
		root.classList.toggle("is-similarity", layoutMode === "radial");
		root.classList.toggle("is-citation-similarity", layoutMode === "radial" && similarityKind === "citations");
		const scoped = similarityExplorer.update(currentGraph, storedText, similaritySearch, similarityKind);
		syncInfoBar();
		if (scoped) {
			comparison = scoped.scores;
			map.adoptGraph(scoped.graph.nodes, scoped.graph.edges, comparison[similarityKind]);
			map.setComparisonScores(comparison[similarityKind], similarityKind);
			scopedActive = true; return;
		}
		if (scopedActive && currentGraph) map.adoptGraph(currentGraph.nodes, currentGraph.edges, currentGraph.seedScore);
		scopedActive = false;
		if (!currentGraph) return;
		comparison = comparisonData(currentGraph, storedText);
		map.setComparisonScores(layoutMode === "radial" ? comparison[similarityKind] : currentGraph.seedScore, similarityKind);
	}
	function syncInfoBar(): void {
		const key = `${tab}:${layoutMode}:${similarityKind}:${similarityExplorer.contextKey}:${currentGraph?.nodes.find(p => p.isSeed)?.id ?? ""}`;
		infoBar.context(key, tab !== "graph" ? { kind: "summary", text: tabTitles[tab] } : similarityExplorer.status ?? graphInfo(currentGraph, layoutMode));
	}
	function loadStoredText(): void {
		const revision = ++storedTextRevision, target = currentGraph;
		if (storedTextGraph !== target) { storedText = []; storedTextGraph = target; }
		refreshSimilarityScores();
		const bridge = library();
		if (!target || !bridge?.textEvidence) return;
		void bridge.textEvidence(target.nodes).then(rows => {
			if (!alive || storedTextRevision !== revision || currentGraph !== target) return;
			storedText = rows; refreshSimilarityScores();
			if (selected) showDetail(selected, target, null);
		}).catch(() => { /* Keep existing graph evidence when sidecars cannot be read. */ });
	}
	const graphKey = mountGraphKey(rail, () => viewFilter, (next) => {
		viewFilter = next;
		applyFilter();
		paintLists();
	}, () => {
		const seed = currentGraph?.nodes.find((node) => node.isSeed) ?? null;
		if (seed && currentGraph) showDetail(seed, currentGraph, null);
	});
	graphKey.paintColor(layoutMode);
	map.onVisibleConnections = edges => graphKey.setVisibleConnections(edges);
	surface.showAllConnections.addEventListener("change", () => map.setShowAllCitationConnections(surface.showAllConnections.checked));
	let tab: GraphTab = "graph";
	let currentGraph: SimilarityGraph | null = null;
	let sourceGraph: SimilarityGraph | null = null;
	let lastDepthNote = "";
	seedItem.textContent = tr("在图谱中打开", "Open in graph");
	seedItem.hidden = !deps.openGraph;
	let selected: PaperNode | null = null;
	let selectedLink: GraphEdge | null = null;
	let chrome: GraphChrome | null = null;
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !currentGraph || (!deps.openGraph && !scopedActive)) {
			nodeMenu.hidden = true;
			return;
		}
		seedItem.hidden = !scopedActive && !deps.openGraph;
		seedItem.disabled = paper.isSeed;
		seedItem.textContent = scopedActive ? tr("设为种子论文", "Set as seed paper") : tr("在图谱中打开", "Open in graph");
		paintLocalPaperAction(nodeMenu, paper, library(), true);
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		placeNodeMenu(stage, nodeMenu, x, y);
	};
	seedItem.addEventListener("click", () => {
		const paper = (scopedActive ? similarityExplorer.result?.graph : currentGraph)?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper && scopedActive) {
			nodeMenu.hidden = true;
			similarityExplorer.setCenter(paper);
			return;
		}
		if (paper) deps.openGraph?.({ kind: "openalex", value: paper.id });
		nodeMenu.hidden = true;
	});
	const hideNodeMenu = (): void => { nodeMenu.hidden = true; };
	stage.addEventListener("pointerdown", (event) => {
		if (!nodeMenu.contains(event.target as Node)) hideNodeMenu();
	});
	const onMenuKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape") hideNodeMenu();
	};
	window.addEventListener("keydown", onMenuKey);

	const tabTitles: Record<GraphTab, string> = {
		graph: tr("论文详情与关联依据", "Paper details & evidence"),
		prior: tr("先验工作", "Prior works"),
		derivative: tr("衍生工作", "Derivative works"),
		research: tr("研究脉络", "Research narrative"),
		staged: tr("暂存列表", "Saved papers"),
		excluded: tr("已排除论文", "Excluded papers"),
	};

	const paintLists = (): void => {
		syncInfoBar();
		evidenceTitle.textContent = tabTitles[tab] ?? tabTitles.graph;
		detail.hidden = tab !== "graph";
		if (!currentGraph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(visibleNodes(currentGraph.nodes, viewFilter).map((node) => node.id));
		const seed = currentGraph.nodes.find((node) => node.isSeed);
		const rows = (tab === "prior" ? priorWorks(currentGraph, visible) : derivativeWorks(currentGraph, visible))
			.filter((row) => !seed || !deps.getSettings().researchProjects[seed.id]?.paperStates?.[row.paper.id]?.excluded);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? tr("被本图引用", "Cited by this graph") : tr("引用本图", "Cites this graph");
		fillAggregate(listPanel, definition, rows, noun, (paper) => {
			const inGraph = currentGraph?.nodes.some((node) => node.id === paper.id) ?? false;
			if (inGraph && currentGraph) showDetail(paper, currentGraph, null);
		}, (card, paper) => {
			if (!seed) return;
			const settings = deps.getSettings();
			const state = settings.researchProjects[seed.id]?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
			paintPaperWorkflowState(card, paper, state, (reading, previous) => saveReading(paper, seed.id, reading, previous, state.source), async () => {
				updateProjectPaperState(settings.researchProjects, seed.id, paper, { excluded: true });
				try {
					await deps.stagePaper?.(paper, seed.id, state.source);
					if (currentGraph?.nodes.some((node) => node.id === paper.id) && sourceGraph) renderGraph(sourceGraph, lastDepthNote);
					else paintLists();
				} catch {
					updateProjectPaperState(settings.researchProjects, seed.id, paper, { excluded: false });
					card.querySelector<HTMLElement>(".cpo-paper-action-error")?.remove();
					const error = createSpan();
					error.className = "cpo-paper-action-error";
					error.setAttribute("role", "status");
					error.textContent = tr("保存失败，请重试", "Could not save. Try again.");
					card.append(error);
				}
			});
			paintPaperActions(card, paper, seed.id, null, null, {
				library: deps.paperLibrary,
				getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
				setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
				persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
				openExternal: deps.openExternal,
			});
		});
	};

	chrome = mountGraphChrome(layoutHost, {
		similarityKind,
		layouts: ["force2d", "temporal", "radial"],
		layout: layoutMode,
		noteButton: Boolean(deps.createNote),
		actionsHost: actionsBar,
		layoutHost,
		scrubHost,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(layoutMode);
			refreshSimilarityScores();
			if (selected && currentGraph) showDetail(selected, currentGraph, null);
			map.setColorMode(defaultColorMode(layoutMode));
			graphKey.paintColor(layoutMode);
		},
		onSimilarity: (kind) => {
			similarityKind = kind; refreshSimilarityScores();
			if (selected && currentGraph) showDetail(selected, currentGraph, null);
		},
		onScrub: (year) => {
			viewFilter = { ...viewFilter, scrubYear: year };
			applyFilter();
			paintLists();
		},
		onTab: (next) => {
			tab = next;
			listPanel.hidden = next === "graph";
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
		},
		onExport: (kind) => {
			void exportView(kind);
		},
	});
	const exportView = async (kind: ExportKind): Promise<void> => {
		if (!currentGraph) return;
		if (kind === "note") {
			const paper = selected ?? currentGraph.nodes.find((node) => node.isSeed) ?? null;
			if (!paper) return;
			if (deps.lookupLiteratureNote?.(paper)) { showDetail(paper, currentGraph, selectedLink); chrome?.setExportText(tr("已找到文献笔记，请从详情中选择打开", "Literature notes found. Open one from the paper details.")); return; }
			const settings = deps.getSettings();
			const seedId = currentGraph.nodes.find((node) => node.isSeed)?.id ?? paper.id;
			const fields = {
				project: settings.researchProjects[seedId]?.name || seedId,
				relation: ORIGIN_TEXT[paper.origin],
				status: settings.researchProjects[seedId]?.paperStates?.[paper.id]?.reading ?? "unread" as const,
			};
			const filename = literatureFilename(paper, settings.literatureFilename, fields);
			const markdown = literatureMarkdown(paper, settings.literatureTemplate, fields);
			if (deps.createNote) {
				try {
					const path = await deps.createNote(filename, markdown, settings.literatureFolder);
					deps.rememberLiteratureNote?.(paper, typeof path === "string" ? path : filename, fields.status);
					chrome?.setExportText(tr(`已写入笔记：${filename}`, `Written to note: ${filename}`));
					if (currentGraph) showDetail(paper, currentGraph, selectedLink);
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				}
				return;
			}
			await chrome?.copyText(markdown, tr("笔记内容", "Note contents"));
			return;
		}
		const nodes = orderedForExport(visibleNodes(similarityExplorer.result?.graph.nodes ?? currentGraph.nodes, viewFilter));
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		await chrome?.copyText(text, kind === "bibtex" ? "BibTeX" : kind === "yaml" ? "YAML" : tr("表格", "Table"));
	};

	const anchor = placementAnchor(root);
	const clearPlacement = applyPlacement(root, anchor, spec);
	const stopResize = mountResizeHandle(body, anchor, () => map.resize());
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, {
		defaultWidth: 260,
		onResize: () => map.resize(),
	});
	const narrowObserver = observeResponsiveMode(shell, () => map.resize());
	zoomIn.addEventListener("click", () => map.zoomBy(1.2));
	zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
	zoomFit.addEventListener("click", () => map.fit(true));
	let wheelHinted = false;
	stage.addEventListener(
		"wheel",
		(event) => {
			if (wheelHinted || event.ctrlKey || event.metaKey) return;
			wheelHinted = true;
			status.textContent += tr(" · 按住 ⌘/Ctrl 滚动可缩放", " · hold ⌘/Ctrl and scroll to zoom");
		},
		{ capture: true, passive: true },
	);
	let generation = 0;
	let alive = true;
	/** Abstract fallback: which source filled an abstract, or which DOI has no known abstract. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractFromCrossref = new Set<string>();
	const abstractMissing = new Set<string>();

	const embedAbstractText = (paper: PaperNode): string => {
		if (paper.abstract) {
			const source = abstractFromS2.has(paper.id) ? "Semantic Scholar" : abstractFromCrossref.has(paper.id) ? "Crossref" : "";
			return paper.abstract + (source ? tr(`（摘要来源：${source}）`, ` (abstract source: ${source})`) : "");
		}
		if (abstractMissing.has(paper.id)) return tr("OpenAlex、Semantic Scholar 和 Crossref 都没有这篇的摘要。", "No abstract is available from OpenAlex, Semantic Scholar, or Crossref.");
		return tr("OpenAlex 没有摘要，正在查询 Semantic Scholar / Crossref…", "No OpenAlex abstract; checking Semantic Scholar and Crossref…");
	};

	const placeDetailPlaceholder = (): void => {
		selected = null;
		selectedLink = null;
		detail.replaceChildren();
		const empty = createEl("p");
		empty.className = "cpo-side-tip";
		empty.textContent = tr("点选节点查看题名、年份、作者和证据。", "Select a node to view its title, year, authors, and evidence.");
		detail.append(empty);
		sheet.setSummary(tr("点选节点查看论文", "Select a node to view its paper"), "");
	};
	placeDetailPlaceholder();

	const showDetail = (paper: PaperNode | null, graph: SimilarityGraph, link: GraphEdge | null): void => {
		if (paper && selected?.id === paper.id && readingChangePending(deps.getSettings().researchProjects, currentGraph?.nodes.find(node => node.isSeed)?.id ?? paper.id, paper)) return;
		surface.announceSelection(paper?.title ?? "");
		if (!paper) {
			placeDetailPlaceholder();
			return;
		}
		selected = paper;
		selectedLink = link;
		detail.replaceChildren();
		if (similarityExplorer.paintDetail(detail, paper, similarityKind, deps.openExternal)) {
			// Keep workflow state tied to the saved project, even when the comparison center changes.
			const projectId = currentGraph?.nodes.find(node => node.isSeed)?.id ?? paper.id;
			const project = deps.getSettings().researchProjects[projectId];
			const state = { ...(project?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() }) };
			const noted = deps.lookupLiteratureNote?.(paper);
			if (noted?.reading && !readingChangePending(deps.getSettings().researchProjects, projectId, paper)) state.reading = noted.reading;
			paintPaperWorkflowState(detail, paper, state, (reading, previous) => saveReading(paper, projectId, reading, previous, state.source));
			paintPaperActions(detail, paper, projectId, null, null, {
				library: deps.paperLibrary,
				getPaperState: (seedId, paperId) => deps.getSettings().researchProjects[seedId]?.paperStates?.[paperId],
				setStaged: (target, seedId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, seedId, target, { staged, source }); },
				persist: deps.stagePaper ? source => deps.stagePaper!(paper, projectId, source) : undefined,
				openExternal: deps.openExternal,
			});
			map.setSelected(paper.id); sheet.setSummary(paper.title, tr("相似度搜索结果", "Similarity search result")); return;
		}
		paintMetadataCard(detail, paper, graph.crossCheck?.get(paper.id));
		const seed = graph.nodes.find((node) => node.isSeed) ?? null;
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		const seedId = seed?.id ?? paper.id;
		const project = deps.getSettings().researchProjects[seedId];
		paintIdentitySources(detail, paper, deps.openExternal, () => {
			if (!currentGraph) return;
			if (currentGraph.nodes.length + (paper.records?.length ?? 1) - 1 > deps.getSettings().maxNodes) { infoBar.notify(tr("分开记录将超过节点上限，请先移除其他论文", "Splitting these records would exceed the node limit. Remove another paper first."), "error"); return; }
			const next = separateWorkRecords(sourceGraph ?? currentGraph, paper);
			if (project) { reconcileProjectIdentity(project, next); project.snapshot = saveGraphSnapshot(next); }
			renderGraph(next, lastDepthNote);
			void deps.stagePaper?.(paper, seedId, "OpenAlex");
		}, project?.identityConflicts?.includes(paper.id), () => {
			if (!project) return;
			acknowledgeIdentityStates(project, paper);
			void deps.stagePaper?.(paper, seedId, "OpenAlex"); showDetail(paper, graph, link);
		});
		let paperState = project?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
		const noted = deps.lookupLiteratureNote?.(paper) ?? null;
		if (noted?.reading && noted.reading !== paperState.reading && !readingChangePending(deps.getSettings().researchProjects, seedId, paper)) {
			paperState = { ...paperState, reading: updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: noted.reading }).reading };
			void deps.stagePaper?.(paper, seedId, paperState.source);
		}
		paintPaperWorkflowState(detail, paper, paperState, (reading, previous) => saveReading(paper, seedId, reading, previous, paperState.source));
		if (noted && deps.openLiteratureNote) paintLiteratureLink(detail, noted.path, deps.openLiteratureNote, noted.alternatives);
		const getEvidence = (citingId: string, citedId: string) => graph.citationEvidence?.get(citingId, citedId) ?? null;
		const stageEdge = seed && !paper.isSeed ? findEdge(graph.edges, paper.id, seed.id) : null;
		const stageEvidence = seed && !paper.isSeed ? getEvidence(paper.id, seed.id) ?? getEvidence(seed.id, paper.id) : null;
		paintPaperActions(detail, paper, seed?.id ?? null, stageEdge, stageEvidence, {
			library: deps.paperLibrary,
			getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
			setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
			persist: deps.stagePaper && seed ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
			openExternal: deps.openExternal,
		});
		paintAbstractCard(detail, paper, embedAbstractText);
		if (!paper.isSeed && seed && layoutMode === "radial") {
			paintComparisonCard(detail, similarityKind, comparison[similarityKind].get(paper.id), comparison.details.get(paper.id));
		} else if (!paper.isSeed && seed) {
			const toSeed = findEdge(graph.edges, paper.id, seed.id);
			if (toSeed) {
				const from = byId.get(toSeed.source);
				const to = byId.get(toSeed.target);
				if (from && to) {
					paintRelationSection(detail, toSeed, from, to, {
						sources: edgeSourcesText(toSeed, getEvidence),
						getEvidence,
						seedScore: graph.seedScore.get(paper.id),
						semanticScore: graph.semanticScores?.get(paper.id),
						semanticHint: semanticHintFor(graph.semanticMode),
					});
				}
			} else {
				const score = graph.seedScore.get(paper.id);
				const card = createEl("section");
				card.className = "cpo-card";
				if (score !== undefined) paintMeter(card, tr("图谱候选选择分", "Graph selection score"), score, tr("用于候选选择的结构和文本/主题信号", "Structure and text/topic signals used for candidate selection"));
				const semantic = graph.semanticScores?.get(paper.id);
				if (semantic !== undefined) paintMeter(card, tr("文本/主题信号", "Text/topic signal"), semantic, semanticHintFor(graph.semanticMode), true);
				const note = createEl("p");
				note.className = "cpo-fact-note";
				note.textContent = score === undefined ? tr("与种子没有直接连线", "No direct link to the seed") : tr(`与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`, `No direct citation to the seed recorded · ${SIMILARITY_NOT_CITATION}`);
				card.append(note);
				detail.append(card);
			}
			const rankInfo = graph.selectionRank?.get(paper.id);
			if (rankInfo) paintSelectionReasons(detail, rankInfo, graph.seedScore.get(paper.id));
		}
		if (link && seed && !samePair(link, paper.id, seed.id)) {
			const from = byId.get(link.source);
			const to = byId.get(link.target);
			if (from && to) {
				paintRelationSection(detail, link, from, to, { sources: edgeSourcesText(link, getEvidence), getEvidence });
			}
		}
		if (!paper.abstract && !abstractMissing.has(paper.id) && !abstractRequested.has(paper.id)) {
			abstractRequested.add(paper.id);
			const token = generation;
			void (async () => {
				const s2Text = await semanticAbstract(deps.getJson, deps.getSettings().semanticScholarApiKey, paper);
				if (s2Text) return { text: s2Text, source: "s2" as const };
				const crossrefText = await crossrefAbstract(deps.getJson, deps.getSettings().contactEmail, paper);
				return crossrefText ? { text: crossrefText, source: "crossref" as const } : null;
			})().then((result) => {
				if (!alive || token !== generation) return;
				if (result) {
					paper.abstract = result.text;
					if (result.source === "s2") abstractFromS2.add(paper.id);
					else abstractFromCrossref.add(paper.id);
				} else {
					abstractMissing.add(paper.id);
				}
				if (selected === paper && currentGraph) showDetail(paper, currentGraph, null);
			});
		}
	};

	diagnoseButton.addEventListener("click", () => {
		if (!currentGraph) return;
		const returnPaper = selected;
		const returnLink = selectedLink;
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("候选诊断", "Candidate inspection"), tr("当前图谱的采样记录", "Sampling records for the current graph"));
		const back = createEl("button");
		back.type = "button";
		back.className = "cpo-diagnose-back";
		back.textContent = tr("‹ 返回论文", "‹ Back to paper");
		back.disabled = !returnPaper;
		back.onclick = () => currentGraph && showDetail(returnPaper, currentGraph, returnLink);
		detail.append(back);
		const form = createEl("form");
		form.className = "cpo-diagnose-form";
		const query = createEl("input");
		query.placeholder = tr("DOI 或 OpenAlex ID", "DOI or OpenAlex ID");
		query.setAttribute("aria-label", tr("要诊断的论文", "Paper to inspect"));
		const submit = createEl("button");
		submit.type = "submit";
		submit.className = "cpo-primary";
		submit.textContent = tr("查询", "Search");
		form.append(query, submit);
		const result = createDiv();
		result.className = "cpo-diagnose-result";
		detail.append(form, result);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (!currentGraph) return;
			const finding = diagnoseCandidate(currentGraph, query.value, new Set(), viewFilter.scrubYear);
			result.replaceChildren();
			const title = createEl("strong");
			title.textContent = finding.title;
			const text = createEl("p");
			text.className = "cpo-side-tip";
			text.textContent = finding.detail;
			result.append(title, text);
			const paper = finding.paperId && currentGraph.nodes.find((item) => item.id === finding.paperId);
			if (paper) {
				const open = createEl("button");
				open.type = "button";
				open.className = "cpo-text-btn";
				open.textContent = tr("查看论文", "View paper");
				open.onclick = () => { if (currentGraph) showDetail(paper, currentGraph, null); };
				result.append(open);
			}
		});
		query.focus();
	});

	const snapshotView = (): void => {
		rememberViewState(stateKey, { filter: viewFilter, layout: layoutMode, similarityKind, distanceScale: map.getViewState().distanceScale });
	};

	const incompleteCitationChecks = new WeakSet<SimilarityGraph>();
	surface.apiStatus.read = () => graphApiStatus(currentGraph, layoutMode === "radial" && similarityKind === "text" ? library() : null, similarityExplorer.apiError, Boolean(currentGraph && incompleteCitationChecks.has(currentGraph)));
	const nodePopover = mountNodePopover(stage, canvas, map, () => !body.classList.contains("is-sidebar-collapsed"));
	map.onSelect = (paper) => {
		nodePopover.show(paper, similarityKind, comparison[similarityKind].get(paper?.id ?? ""), comparison.details.get(paper?.id ?? ""), library());
		if (paper && currentGraph) showDetail(paper, currentGraph, null);
		else placeDetailPlaceholder();
	};
	map.onEdgeSelect = (edge) => {
		nodePopover.hide();
		if (!currentGraph || !edge) {
			placeDetailPlaceholder();
			return;
		}
		const from = currentGraph.nodes.find((node) => node.id === edge.source);
		showDetail(from ?? currentGraph.nodes.find((node) => node.id === edge.target) ?? null, currentGraph, edge);
	};

	const renderGraph = (graph: SimilarityGraph, depthNote: string): void => {
		graph = normalizeWorkGraph(graph);
		snapshotView();
		message.hidden = true;
		sourceGraph = graph;
		lastDepthNote = depthNote;
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		const savedProject = seedId ? deps.getSettings().researchProjects[seedId] : undefined;
		if (savedProject) reconcileProjectIdentity(savedProject, graph);
		const excluded = seedId ? Object.entries(deps.getSettings().researchProjects[seedId]?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id) : [];
		for (const id of excluded) graph = omitNode(graph, id) ?? graph;
		graph.excludedIds = excluded;
		currentGraph = graph;
		diagnoseButton.disabled = false;
		map.setGraph(graph.nodes, graph.edges, graph.seedScore);
		graphKey.setStats(graph.nodes, graph.edges);
		graphKey.paintColor(layoutMode);
		map.setLayout(layoutMode);
		map.setColorMode(layoutMode === spec.layout ? spec.color : defaultColorMode(layoutMode));
		loadStoredText();
		applyFilter();
		const span = yearSpan(graph.nodes);
		if (span) chrome?.setYears(...span);
		else chrome?.clearYears();
		paintLists();
		const seed = graph.nodes.find((node) => node.isSeed);
		infoBar.clearProgress();
		syncInfoBar();
		if (seed) showDetail(seed, graph, null);
	};

	/** OpenCitations pass: verify and add citation links between visible nodes, then re-render if edges changed. */
	const enrichOpenCitations = async (graph: SimilarityGraph, depthNote: string): Promise<void> => {
		const token = generation;
		const doiToId = new Map<string, string>();
		for (const paper of graph.nodes.flatMap(paperRecords)) {
			const doi = doiFromPaper(paper)?.toLowerCase();
			if (doi) doiToId.set(doi, paper.id);
		}
		if (doiToId.size === 0) return;
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		const papers = graph.nodes.flatMap(paperRecords).filter((paper) => doiFromPaper(paper)).slice(0, 10);
		const edgesBefore = graph.edges.length;
		for (const paper of papers) {
			if (!alive || token !== generation || currentGraph !== graph) return;
			try {
				const rows = await client.references(doiFromPaper(paper)!);
				if (!alive || token !== generation || currentGraph !== graph) return;
				for (const row of rows) {
					const ids = doisFromOpenCitation(row);
					const citing = ids.citing.map((doi) => doiToId.get(doi)).find(Boolean);
					const cited = ids.cited.map((doi) => doiToId.get(doi)).find(Boolean);
					if (citing && cited) mergeOpenCitation(graph, citing, cited);
				}
			} catch {
				incompleteCitationChecks.add(graph);
				surface.apiStatus.refresh();
			}
		}
		if (!alive || token !== generation || currentGraph !== graph) return;
		const added = graph.edges.length - edgesBefore;
		if (added > 0) {
			map.updateGraphData(graph.edges);
			graphKey.setStats(graph.nodes, graph.edges);
		}
	};

	const load = async (bypassCache: boolean): Promise<void> => {
		const token = ++generation;
		placeDetailPlaceholder();
		tooltip.hidden = true;
		message.hidden = true;
		infoBar.notify(STAGE_TEXT.resolving, "busy");
		reload.disabled = true;
		surface.diversifyResults.disabled = true;
		surface.diversifyResults.checked = deps.getSettings().diversifyResults !== false;
		const settings = { ...deps.getSettings() };
		const cap = spec.maxNodes ?? settings.maxNodes;
		const key = cacheKey(spec.target, cap, spec.depth, settings);
		try {
			let graph = bypassCache ? undefined : cache.get(key);
			if (graph) graph = cloneGraph(graph);
			let depthNote = "";
			if (!graph) {
				const firstCap = spec.depth === 2 ? Math.min(cap, Math.max(15, cap - 10)) : cap;
				graph = await loadNeighborhood(
					clientFor(deps, settings),
					spec.target,
					{ ...settings, maxNodes: firstCap },
					(stage) => {
						if (token === generation) {
							infoBar.notify(STAGE_TEXT[stage], "busy");
						}
					},
					reconcileFor(deps, settings),
					new CrossrefClient(deps.getJson, settings.contactEmail),
				);
				if (spec.depth === 2) {
					const expanded = await expandDepth(clientFor(deps, settings), graph, cap);
					graph = expanded.graph;
					depthNote = expanded.note;
				}
				remember(key, graph);
			}
			if (!alive || token !== generation) return;
			renderGraph(graph, depthNote);
			if (currentGraph) void enrichOpenCitations(currentGraph, depthNote);
		} catch (error) {
			if (!alive || token !== generation) return;
			message.hidden = false;
			messageText.textContent = error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph.");
			infoBar.notify(error instanceof Error ? error.message : tr("图谱没有建起来", "The graph could not be built"), "error");
		} finally {
			if (token === generation) {
				infoBar.clearProgress();
				reload.disabled = false;
				surface.diversifyResults.disabled = layoutMode === "radial";
			}
		}
	};

	reload.addEventListener("click", () => {
		const settings = { ...deps.getSettings() };
		cache.delete(cacheKey(spec.target, spec.maxNodes ?? settings.maxNodes, spec.depth, settings));
		void load(true);
	});
	void load(false);
	surface.distanceScale.addEventListener("change", () => {
		map.setDistanceScale(surface.distanceScale.value === "absolute" ? "absolute" : "relative");
		snapshotView();
	});
	surface.diversifyResults.addEventListener("change", () => {
		const settings = deps.getSettings();
		const previous = settings.diversifyResults !== false;
		settings.diversifyResults = surface.diversifyResults.checked;
		surface.diversifyResults.disabled = true;
		void (async () => {
			try {
				await deps.persistSettings?.();
				if (alive) await load(true);
			} catch (error) {
				settings.diversifyResults = previous;
				if (alive) infoBar.notify(tr("图谱选项保存失败：", "Could not save graph options: ") + String(error), "error");
			} finally {
				if (alive) { surface.diversifyResults.checked = settings.diversifyResults !== false; surface.diversifyResults.disabled = false; }
			}
		})();
	});

	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);
	const onProject = (): void => {
		if (!sourceGraph || !currentGraph) return;
		const seedId = sourceGraph.nodes.find((node) => node.isSeed)?.id;
		const savedProject = seedId ? deps.getSettings().researchProjects[seedId] : undefined;
		if (savedProject) reconcileProjectIdentity(savedProject, sourceGraph);
		const excluded = seedId ? Object.entries(deps.getSettings().researchProjects[seedId]?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id) : [];
		if (excluded.join("\0") !== (currentGraph.excludedIds ?? []).join("\0")) renderGraph(sourceGraph, lastDepthNote);
	};
	window.addEventListener("research-connected-project", onProject);
	const onLibraryChanged = (): void => { similarityExplorer.invalidate(); loadStoredText(); if (selected && currentGraph) showDetail(selected, currentGraph, null); };
	window.addEventListener("research-connected-library-changed", onLibraryChanged);

	return () => {
		alive = false;
		generation += 1;
		snapshotView();
		window.removeEventListener("research-connected-theme", onTheme);
		window.removeEventListener("research-connected-project", onProject);
		window.removeEventListener("research-connected-library-changed", onLibraryChanged);
		window.removeEventListener("keydown", onMenuKey);
		map.destroy();
		similarityExplorer.destroy();
		infoBar.destroy();
		chrome?.destroy();
		sheet.destroy();
		stopResize();
		stopSidebarResize();
		narrowObserver.disconnect();
		clearPlacement();
		root.replaceChildren();
		root.classList.remove("cpo-embed-host");
	};
}

const PLACEMENT_CLASSES = [
	"cpo-embed-anchor",
	"cpo-pos-inline",
	"cpo-pos-float-left",
	"cpo-pos-float-right",
	"cpo-pos-full",
	"cpo-align-left",
	"cpo-align-center",
	"cpo-align-right",
	"cpo-span",
	"cpo-user-resized",
];

function placementAnchor(root: HTMLElement): HTMLElement {
	const parent = root.parentElement;
	const widget = parent?.closest(".cm-embed-block, .cm-preview-code-block");
	return widget instanceof HTMLElement ? widget : root;
}

/** Float or widen the fence element (and the Live Preview widget, when present). */
function applyPlacement(root: HTMLElement, anchor: HTMLElement, spec: EmbedSpec): () => void {
	const previousWidth = anchor.style.width;
	const previousMaxWidth = anchor.style.maxWidth;
	const span = spec.position === "full" && spec.width === "100%";
	const classes = [`cpo-pos-${spec.position}`, `cpo-align-${spec.align}`, ...(span ? ["cpo-span"] : [])];
	anchor.classList.add("cpo-embed-anchor", ...classes);
	anchor.style.width = span ? "" : spec.width;
	return () => {
		anchor.classList.remove(...PLACEMENT_CLASSES);
		anchor.style.width = previousWidth;
		anchor.style.maxWidth = previousMaxWidth;
	};
}

function mountResizeHandle(graphArea: HTMLElement, anchor: HTMLElement, onResize: () => void): () => void {
	const grip = createDiv();
	grip.className = "cpo-resize";
	grip.setAttribute("role", "button");
	grip.tabIndex = 0;
	grip.setAttribute("aria-label", tr("调整图谱大小：拖动，或用方向键（Shift 加速）", "Resize graph: drag or use arrow keys (Shift for faster movement)"));
	graphArea.append(grip);
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let startW = 0;
	let startH = 0;

	const applySize = (width: number, height: number): void => {
		const clampedWidth = Math.min(EMBED_WIDTH_LIMIT.max, Math.max(EMBED_WIDTH_LIMIT.min, Math.round(width)));
		const clampedHeight = Math.min(EMBED_HEIGHT_LIMIT.max, Math.max(EMBED_HEIGHT_LIMIT.min, Math.round(height)));
		anchor.classList.add("cpo-user-resized");
		anchor.style.width = `${clampedWidth}px`;
		graphArea.style.height = `${clampedHeight}px`;
		onResize();
	};

	const onPointerDown = (event: PointerEvent): void => {
		dragging = true;
		startX = event.clientX;
		startY = event.clientY;
		startW = anchor.getBoundingClientRect().width;
		startH = graphArea.getBoundingClientRect().height;
		try {
			grip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer id that is not active cannot be captured.
		}
		event.preventDefault();
		event.stopPropagation();
	};
	const onPointerMove = (event: PointerEvent): void => {
		if (!dragging) return;
		applySize(startW + (event.clientX - startX), startH + (event.clientY - startY));
	};
	const onPointerUp = (event: PointerEvent): void => {
		if (!dragging) return;
		dragging = false;
		try {
			if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
		} catch {
			// The pointer was never captured.
		}
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		const step = event.shiftKey ? 160 : 40;
		const width = anchor.getBoundingClientRect().width;
		const height = graphArea.getBoundingClientRect().height;
		if (event.key === "ArrowLeft") applySize(width - step, height);
		else if (event.key === "ArrowRight") applySize(width + step, height);
		else if (event.key === "ArrowUp") applySize(width, height - step);
		else if (event.key === "ArrowDown") applySize(width, height + step);
		else return;
		event.preventDefault();
		event.stopPropagation();
	};
	grip.addEventListener("pointerdown", onPointerDown);
	grip.addEventListener("pointermove", onPointerMove);
	grip.addEventListener("pointerup", onPointerUp);
	grip.addEventListener("pointercancel", onPointerUp);
	grip.addEventListener("keydown", onKeyDown);
	return () => {
		grip.removeEventListener("pointerdown", onPointerDown);
		grip.removeEventListener("pointermove", onPointerMove);
		grip.removeEventListener("pointerup", onPointerUp);
		grip.removeEventListener("pointercancel", onPointerUp);
		grip.removeEventListener("keydown", onKeyDown);
		grip.remove();
	};
}

function filterFromSpec(spec: EmbedSpec): GraphFilter {
	return {
		...emptyFilter(),
		minCoCitedBy: spec.minCoCite,
		minSharedRefs: spec.minShared,
		yearFrom: spec.yearFrom,
		yearTo: spec.yearTo,
		language: spec.language,
		workType: spec.workType,
		concept: spec.concept,
	};
}

function samePair(edge: GraphEdge, a: string, b: string): boolean {
	return (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);
}

function clientFor(deps: EmbedDeps, settings: ConnectedPapersSettings): OpenAlexClient {
	return new OpenAlexClient(deps.getJson, {
		apiKey: settings.apiKey,
		contactEmail: settings.contactEmail,
	});
}

function reconcileFor(deps: EmbedDeps, settings: ConnectedPapersSettings): SemanticScholarClient | null {
	if (!deps.postJson || !settings.s2Reconcile) return null;
	return new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
}

async function expandDepth(
	client: OpenAlexClient, graph: SimilarityGraph, cap: number,
): Promise<{ graph: SimilarityGraph; note: string }> {
	const hubs = graph.nodes.filter((node) => !node.isSeed)
		.sort((a, b) => (graph.seedScore.get(b.id) ?? 0) - (graph.seedScore.get(a.id) ?? 0)).slice(0, 2);
	const room = cap - graph.nodes.length;
	if (room <= 0) return { graph, note: tr("已到节点上限", "Node limit reached") };
	const extra: PaperNode[] = [];
	const seen = new Set(graph.nodes.flatMap((paper) => paperRecords(paper).map((record) => record.id)));
	let failed = false;
	let added = 0;
	for (const hub of hubs) {
		try {
			for (const raw of await client.referencedBySeed(hub.id, 12)) {
				const paper = toPaper(raw, "reference");
				if (!paper || seen.has(paper.id)) continue;
				const index = workIndex([...graph.nodes, ...extra, paper], graph.nodes.map((node) => node.id), graph.workIdentity?.separatedIds);
				const nextAdded = index.papers.length - graph.nodes.length;
				if (nextAdded > room) continue;
				seen.add(paper.id); extra.push(paper); added = nextAdded;
			}
		} catch { failed = true; }
	}
	if (!extra.length) return { graph, note: failed ? tr("第二层没有读到", "The second layer could not be loaded") : "" };
	const lists = new Map<string, readonly string[]>();
	try {
		for (const raw of await client.worksByIds(extra.flatMap((paper) => paperRecords(paper).map((record) => record.id)))) {
			const id = shortId(raw.id ?? "");
			if (id) lists.set(id, referenceIds(raw.referenced_works));
		}
	} catch { failed = true; }
	return {
		graph: graftNodes(graph, extra, lists),
		note: tr(`含第二层 ${added} 篇${failed ? "；部分来源未读取" : ""}`, `Includes ${added} second-layer papers${failed ? "; some source data could not be loaded" : ""}`),
	};
}

function cacheKey(
	target: { kind: string; value: string },
	maxNodes: number,
	depth: number,
	settings: ConnectedPapersSettings,
): string {
	return [
		`identity-${WORK_IDENTITY_VERSION}`,
		JSON.stringify(Object.values(settings.researchProjects).map((project) => [project.seedId, project.snapshot?.workIdentity?.separatedIds ?? []])),
		target.kind,
		target.value,
		maxNodes,
		depth,
		settings.includeReferences ? "1" : "0",
		settings.includeCitations ? "1" : "0",
		settings.includeRelated ? "1" : "0",
		// 会改变候选采样与评分语义的设置必须进 key，避免展示陈旧解释。
		settings.sampleDepth,
		settings.diversifyResults === false ? "nodiversity" : "diversity",
		settings.s2Reconcile ? "s2" : "nos2",
		settings.semanticEmbedding ? "emb" : "noemb",
		settings.apiKey.trim() ? "keyed" : "anon",
		settings.semanticScholarApiKey.trim() ? "s2k" : "s2anon",
	].join("|");
}

function cloneGraph(graph: SimilarityGraph): SimilarityGraph {
	return restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph)))) ?? graph;
}

function remember(key: string, graph: SimilarityGraph): void {
	if (cache.size >= 12) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(key, cloneGraph(graph));
}

function rememberViewState(key: string, state: EmbedViewState): void {
	if (viewStates.size >= 12) {
		const oldest = viewStates.keys().next().value;
		if (oldest) viewStates.delete(oldest);
	}
	viewStates.set(key, state);
}

function fillAggregate(
	host: HTMLElement,
	definition: string,
	rows: readonly RankedWork[],
	noun: string,
	onPick: (paper: PaperNode) => void,
	onActions: (card: HTMLElement, paper: PaperNode) => void,
): void {
	host.hidden = false;
	host.replaceChildren();
	const copy = createEl("p");
	copy.className = "cpo-agg-def";
	copy.textContent = definition;
	host.append(copy);
	if (rows.length === 0) {
		const empty = createEl("p");
		empty.className = "cpo-agg-empty";
		empty.textContent = AGGREGATE_EMPTY_TEXT;
		host.append(empty);
		return;
	}
	const list = createEl("ol");
	list.className = "cpo-agg-list";
	for (const row of rows) paintAggregateCard(list, row, noun, onPick, onActions);
	host.append(list);
}

function yearSpan(nodes: readonly PaperNode[]): [number, number] | null {
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	if (years.length === 0) return null;
	return [Math.min(...years), Math.max(...years)];
}
