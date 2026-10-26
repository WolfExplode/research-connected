import type { PaperLibrary } from "./paper-library";
import { createLiteratureSearch } from "./workflow/literature-search";
import { createCountControl } from "./count-control";
import { createInfoBar, graphInfo } from "./info-bar";
import { setHoverHint } from "./hover-hint";
import { ReadingSaveError, readingChangePending, readingChangesPending, saveReadingState } from "./workflow/reading-state";
import { createProjectSave } from "./workflow/project-save";
import { createComparisonCitations } from "./workflow/comparison-citations";
import { graphApiStatus } from "./api-status";
import { mountNodePopover } from "./node-popover";
import { paperHasId, paperRecords, resolveWorkQuery } from "./work-identity";
import { graphsForQuestion, linkGraphToQuestion, questionPath } from "./question-workspace";
import { buildDiscoveryGraph, vaultPath, type DiscoveryPayload, type DiscoveryRequest } from "./discovery-graph";
import { isChinese, tr } from "./i18n";
import { comparisonData, type SimilarityKind, type StoredTextEvidence, type TextComparison } from "./paper-comparison";
import { paintComparisonCard } from "./detail-cards";
import { applyRecoveredDoi, cachedDoiRecovery, doiRecoveryKey, recoverDoi, type DoiRecovery } from "./doi-recovery";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, registerPopover, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { edgeSourcesText, ORIGIN_TEXT, paintAbstractCard, paintAggregateCard, paintJumpStrip, paintIdentitySources, paintLiteratureLink, paintMetadataCard, paintMeter, paintPaperWorkflowState, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { paintPaperActions } from "./paper-actions";
import { paintLocalPaperAction, paintLibraryAvailability, type PaperLibraryService } from "./library-panel";
import { literatureFilename, literatureMarkdown, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import {
	EXPAND_CAP,
	graftNodes,
	normalizeWorkGraph,
	separateWorkRecords,
	omitNode,
	refreshDerived,
} from "./graph-edit";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { mountSimilarityExplorer } from "./similarity-explorer";
import { mountGraphSurface, placeNodeMenu } from "./graph-surface";
import {
	diagnoseCandidate,
	beginDeepDive,
	endDeepDive,
	expandAround,
	loadNeighborhood,
	restoreGraftedMembers,
	type SimilarityGraph,
} from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { CrossrefClient, OpenCitationsClient, SemanticScholarClient, crossrefAbstract, doisFromOpenCitation, semanticAbstract } from "./citation-sources";
import {
	CitationEvidenceStore,
	edgeDetailStillCurrent,
	edgePairNeedingS2Context,
	mergeOpenCitation,
	mergeS2CitationsForPair,
} from "./citation-evidence";
import { buildNarrativeEvidence, type ResearchNarrative, type NarrativeEvidence } from "./narrative";
import { summarizeWithLlmPost } from "./llm";
import {
	DEFAULT_PATH_BUDGET,
	findBudgetedCitationPath,
	resolvePathEndpoint,
	type CitationPathResult,
} from "./doi-path";
import { classifyQuery, normalizeDoi, shortId, toPaper, toSearchHit } from "./paper";
import { findEdge } from "./relation";
import type { ConnectedPapersSettings } from "./settings";
import type { GraphEdge, PaperNode, SearchHit } from "./types";
import { formatCount } from "./visual";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode } from "./responsive";
import { displayStageSource, groupStagedBySeed } from "./staging";
import { matchingSeedProjects, projectExcludedPapers, projectStagedPapers, acknowledgeIdentityStates, reconcileProjectIdentity, restoreGraphSnapshot, savedProjectForSeed, saveGraphSnapshot, updateProjectPaperState, type DeepDiveBatch, type ProjectPaperState, type ReadingStatus, type ResearchProject, type SavedView } from "./project-state";

export interface GraphAppHandle {
	destroy(): void;
	openDiscovery(options?: { paper?: string; question?: string; mode?: "rank" | "search" }): void;
	/** Command-palette DOI path search over already-fetched reference lists. */
	openDoiPathSearch(): void;
}

export interface AppDeps {
	researchLibrary?: () => PaperLibraryService | null;
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<unknown>;
	openExternal: (url: string) => void;
	createNote?: (filename: string, markdown: string, folder?: string) => Promise<string | void>;
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; reading: ReadingStatus | null; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	syncLiteratureReading?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
	rememberLiteratureNote?: (paper: PaperNode, path: string, reading: ReadingStatus) => void;
	paperLibrary?: PaperLibrary;
	retryBookmarkMigration?: () => Promise<void>;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	/** Persist settings (grafted members, staging, …). */
	persistSettings?: () => Promise<void> | void;
	loadSavedProject?: () => ResearchProject | null;
	saveProject?: (project: ResearchProject) => Promise<void> | void;
	/** Optional native view-header slot for the live graph status. */
	statusHost?: HTMLElement;
	initialDoi?: string;
	/** Seed to build immediately; wins over initialDoi when both are set. */
	initialTarget?: { kind: "doi" | "openalex"; value: string };
}

const STAGE_TEXT: Record<"resolving" | "fetching" | "scoring" | "searching", string> = {
	resolving: tr("正在解析种子论文…", "Resolving the seed paper…"),
	fetching: tr("正在读取参考文献、施引文献和相关作品…", "Loading references, citing papers, and related works…"),
	scoring: tr("正在计算参考文献重叠与共被引…", "Calculating shared references and co-citations…"),
	searching: tr("正在搜索 OpenAlex…", "Searching OpenAlex…"),
};

/** Pane UI shared by the Obsidian view and the browser preview. */
export function mountGraphApp(root: HTMLElement, deps: AppDeps): GraphAppHandle {
	const saveReading = (paper: PaperNode, seedId: string, reading: ReadingStatus, previous: ReadingStatus, source: string): Promise<void> =>
		saveReadingState({ projects: deps.getSettings().researchProjects, seedId, paper, reading, previous,
			persist: () => deps.persistSettings ? deps.persistSettings() : deps.stagePaper?.(paper, seedId, source), syncNote: deps.syncLiteratureReading }).catch((error: unknown) => {
			infoBar.notify(error instanceof Error ? error.message : tr("阅读状态保存失败", "Could not save reading status"), "error");
			throw error;
		});

	root.classList.add("cpo-root");
	root.lang = isChinese() ? "zh-CN" : "en";
	root.replaceChildren();

	const bar = el(root, "header", "cpo-bar");
	const projectTools = el(bar, "div", "cpo-project-tools");
	const form = el(projectTools, "form", "cpo-form");
	const input = el(form, "input", "cpo-input");
	input.type = "text";
	input.placeholder = tr("DOI、OpenAlex ID 或论文标题", "DOI, OpenAlex ID, or paper title");
	input.autocomplete = "off";
	input.spellcheck = false;
	input.setAttribute("aria-label", tr("种子论文", "Seed paper"));
	const submit = el(form, "button", "cpo-primary", tr("构建", "Build"));
	submit.type = "submit";
	const workspaceControls = el(projectTools, "div", "cpo-workspace-controls");
	const workspaceToggles = el(workspaceControls, "div", "cpo-workspace-toggles");
	workspaceToggles.setAttribute("role", "toolbar");
	workspaceToggles.setAttribute("aria-label", tr("工作区菜单", "Workspace menus"));
	const questionToggle = el(workspaceToggles, "button", "cpo-workspace-toggle");
	questionToggle.type = "button";
	setHoverHint(questionToggle, tr("研究问题", "Question"));
	questionToggle.setAttribute("aria-label", tr("研究问题", "Question"));
	questionToggle.setAttribute("aria-expanded", "false");
	questionToggle.append(createChromeIcon("note"));
	const graphToggle = el(workspaceToggles, "button", "cpo-workspace-toggle");
	graphToggle.type = "button";
	setHoverHint(graphToggle, tr("引用图谱", "Citation graph"));
	graphToggle.setAttribute("aria-label", tr("引用图谱", "Citation graph"));
	graphToggle.setAttribute("aria-expanded", "false");
	graphToggle.append(createChromeIcon("project"));
	const questionGroup = el(workspaceControls, "div", "cpo-workspace-menu cpo-project-group cpo-question-group");
	questionGroup.hidden = true;
	const questionSelect = el(questionGroup, "select", "cpo-project-select cpo-question-select");
	questionSelect.setAttribute("aria-label", "Research question");
	let activeQuestion = questionPath(deps.getSettings().activeQuestion) ?? "";
	const questionTools = el(questionGroup, "div", "cpo-question-actions");
	const questionAction = (text: string, action: () => void): HTMLButtonElement => {
		const button = el(questionTools, "button", "cpo-ghost", text); button.type = "button";
		button.addEventListener("click", action); return button;
	};
	const openQuestion = questionAction(tr("打开问题", "Open question"), () => deps.researchLibrary?.()?.open(activeQuestion));
	const exploreTools = el(projectTools, "div", "cpo-explore-tools");
	projectTools.insertBefore(exploreTools, workspaceControls);
	projectTools.insertBefore(form, workspaceControls);
	const method = el(exploreTools, "select", "cpo-explore-method");
	method.setAttribute("aria-label", tr("探索方式", "Explore method"));
	for (const [value, text] of [["citation", tr("探索引用", "Explore citations")], ["similar", tr("查找相似论文", "Find similar papers")], ["rank", tr("筛选论文", "Screen papers")], ["search", tr("搜索 PDF", "Search PDFs")]]) method.append(createEl("option", { value, text }));
	const choices = el(exploreTools, "datalist"); choices.id = `cpo-source-${Math.random().toString(36).slice(2)}`;
	const sourcePaperPaths = new Map<string, string>();
	const sourcePaperLabels = new Map<string, string>();
	for (const paper of deps.researchLibrary?.()?.discovery?.context().papers ?? []) {
		const label = paper.path.split("/").pop()?.replace(/\.md$/i, "").trim() || paper.title;
		sourcePaperPaths.set(label, paper.path);
		sourcePaperLabels.set(paper.path, label);
		choices.append(createEl("option", { value: label }));
	}
	const pdfLabel = el(exploreTools, "label", "cpo-explore-field cpo-explore-query");
	const pdfQuery = el(pdfLabel, "input"); pdfQuery.type = "search"; pdfQuery.placeholder = tr("全文查询", "PDF query"); pdfQuery.setAttribute("aria-label", tr("全文查询", "PDF query"));
	const discoveryCount = createCountControl({ label: "Discovery paper limit", presetLabel: "Choose discovery paper limit preset",
		initial: 30, max: 100, presets: [10, 30, 50, 100],
		onChange: () => { if (discoveryPayload) displayDiscovery(discoveryPayload); } });
	const limitLabel = discoveryCount.element, discoveryLimit = discoveryCount.input;
	exploreTools.append(limitLabel);
	const runDiscovery = el(exploreTools, "button", "cpo-primary", tr("筛选论文", "Rank papers")); runDiscovery.type = "button";
	const indexPdfs = el(exploreTools, "button", "cpo-ghost", tr("索引前 12 篇 PDF", "Index top 12 PDFs")); indexPdfs.type = "button";
	indexPdfs.classList.add("cpo-index-pdfs");
	setHoverHint(indexPdfs, tr("索引前 12 篇 PDF", "Index top 12 PDFs"));
	indexPdfs.replaceChildren(createChromeIcon("refresh"));
	const projectGroup = el(workspaceControls, "div", "cpo-workspace-menu cpo-project-group");
	projectGroup.hidden = true;
	const menuId = `cpo-workspace-${Math.random().toString(36).slice(2)}`;
	questionGroup.id = `${menuId}-question`;
	projectGroup.id = `${menuId}-graph`;
	questionToggle.setAttribute("aria-controls", questionGroup.id);
	graphToggle.setAttribute("aria-controls", projectGroup.id);
	workspaceControls.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || (questionGroup.hidden && projectGroup.hidden)) return;
		event.preventDefault();
		event.stopPropagation();
		const toggle = questionGroup.hidden ? graphToggle : questionToggle;
		setWorkspaceMenu(null);
		toggle.focus();
	});
	const projectSelect = el(projectGroup, "select", "cpo-project-select");
	projectSelect.setAttribute("aria-label", tr("引用图谱", "Citation graph"));
	setHoverHint(projectSelect, tr("选择此问题的图谱，或关联已有图谱", "Choose a graph for this question, or link an existing graph"));
	const viewGroup = el(projectGroup, "div", "cpo-project-group cpo-view-group");
	const viewLabel = el(viewGroup, "span", "cpo-project-label", tr("视图", "View"));
	viewLabel.prepend(createChromeIcon("views"));
	const viewSelect = el(viewGroup, "select", "cpo-project-select cpo-view-select");
	viewSelect.setAttribute("aria-label", tr("保存的视图", "Saved views"));
	setHoverHint(viewSelect, tr("恢复保存的视图", "Restore saved view"));
	viewSelect.disabled = true;
	const viewNameInput = el(viewGroup, "input", "cpo-project-name-input");
	viewNameInput.placeholder = tr("新视图名称", "New view name");
	viewNameInput.setAttribute("aria-label", tr("新视图名称", "New view name"));
	viewNameInput.hidden = true;
	const saveViewButton = el(viewGroup, "button", "cpo-ghost", tr("保存视图", "Save view"));
	const saveViewText = createSpan();
	saveViewText.textContent = tr("保存视图", "Save view");
	saveViewButton.replaceChildren(createChromeIcon("save"), saveViewText);
	saveViewButton.type = "button";
	saveViewButton.disabled = true;
	const renameProjectInput = el(projectGroup, "input", "cpo-project-name-input cpo-project-rename-input");
	renameProjectInput.placeholder = tr("项目新名称", "New project name");
	renameProjectInput.setAttribute("aria-label", tr("项目新名称", "New project name"));
	renameProjectInput.hidden = true;
	const renameProjectButton = el(projectGroup, "button", "cpo-ghost", tr("重命名", "Rename"));
	const renameProjectText = createSpan();
	renameProjectText.textContent = tr("重命名", "Rename");
	renameProjectButton.replaceChildren(createChromeIcon("edit"), renameProjectText);
	renameProjectButton.type = "button";
	renameProjectButton.disabled = true;
	const libraryButton = el(workspaceToggles, "button", "cpo-workspace-toggle cpo-library-open");
	libraryButton.type = "button";
	libraryButton.append(createChromeIcon("bookmark"));
	setHoverHint(libraryButton, tr("收藏与当前项目排除项", "Bookmarks and current-project exclusions"));
	const setWorkspaceMenu = (menu: "question" | "graph" | null): void => {
		const showQuestion = menu === "question";
		const showGraph = menu === "graph";
		questionGroup.hidden = !showQuestion;
		projectGroup.hidden = !showGraph;
		questionToggle.classList.toggle("is-active", showQuestion);
		graphToggle.classList.toggle("is-active", showGraph);
		questionToggle.setAttribute("aria-expanded", String(showQuestion));
		graphToggle.setAttribute("aria-expanded", String(showGraph));
	};
	questionToggle.addEventListener("click", () => setWorkspaceMenu(questionGroup.hidden ? "question" : null));
	graphToggle.addEventListener("click", () => setWorkspaceMenu(projectGroup.hidden ? "graph" : null));

	const status = createEl("p");
	status.className = "cpo-status";
	const infoBar = createInfoBar(status);
	infoBar.notify(tr("从一篇种子论文开始。", "Start with a seed paper."));
	status.setAttribute("role", "status");
	const statusIsExternal = Boolean(deps.statusHost);
	if (deps.statusHost) deps.statusHost.replaceChildren(status);
	const results = el(bar, "div", "cpo-results");
	results.hidden = true;

	const banner = el(root, "div", "cpo-banner");
	banner.hidden = true;
	banner.setAttribute("role", "alert");

	const body = el(root, "div", "cpo-body");
	body.classList.add("is-rail-collapsed");
	const statusBar = el(root, "footer", "cpo-statusbar");
	statusBar.hidden = statusIsExternal;
	if (!statusIsExternal) statusBar.append(status);
	const undoButton = el(statusBar, "button", "cpo-text-btn cpo-undo", tr("撤销", "Undo"));
	undoButton.type = "button";
	undoButton.hidden = true;
	undoButton.disabled = true;
	setHoverHint(undoButton, tr("撤销（Ctrl+Z）", "Undo (Ctrl+Z)"));
	const redoButton = el(statusBar, "button", "cpo-text-btn cpo-undo", tr("重做", "Redo"));
	redoButton.type = "button";
	redoButton.hidden = true;
	redoButton.disabled = true;
	setHoverHint(redoButton, tr("重做（Ctrl+Shift+Z）", "Redo (Ctrl+Shift+Z)"));
	const rail =el(body, "aside", "cpo-rail");
	const layoutHost = el(rail, "div", "cpo-rail-layouts");
	const scrubHost = el(rail, "div", "cpo-rail-scrub");
	const railToggle = el(rail, "button", "cpo-panel-toggle is-left", "›");
	railToggle.type = "button";
	railToggle.setAttribute("aria-label", tr("展开左侧栏", "Expand left sidebar"));
	railToggle.setAttribute("aria-expanded", "false");
	const surface = mountGraphSurface(body, {
		canvasLabel: tr("论文相似度图谱", "Paper similarity graph"),
		title: tr("从一篇种子论文开始", "Start with a seed paper"),
		hint: tr("输入 DOI、OpenAlex 链接或作品 ID，也可以按标题搜索后点选。圆点按参考文献重叠和共被引聚在一起，不是引用列表。", "Enter a DOI, OpenAlex URL, or work ID, or search by title and select a result. Nodes cluster by shared references and co-citations; this is not a citation list."),
	});
	const { stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, zoomIn, zoomOut, fit, reload } = surface;

	const sidebar = el(body, "aside", "cpo-evidence-sidebar");
	const sidebarToggle = el(sidebar, "button", "cpo-panel-toggle is-right", "›");
	sidebarToggle.type = "button";
	sidebarToggle.setAttribute("aria-label", tr("折叠右侧栏", "Collapse right sidebar"));
	sidebarToggle.setAttribute("aria-expanded", "true");
	const sidebarResize = el(body, "div", "cpo-sidebar-resizer");
	body.insertBefore(sidebarResize, sidebar);
	const evidenceHeader = el(sidebar, "header", "cpo-evidence-header");
	const evidenceHeading = el(evidenceHeader, "h2", undefined, tr("论文详情与关联依据", "Paper details & evidence"));
	const evidenceTools = el(evidenceHeader, "div", "cpo-evidence-tools");
	evidenceTools.setAttribute("role", "toolbar");
	evidenceTools.setAttribute("aria-label", tr("论文操作", "Paper actions"));
	const diagnoseButton = el(evidenceTools, "button", "cpo-diagnose", "");
	diagnoseButton.append(createChromeIcon("diagnose"), document.createTextNode(tr("诊断候选", "Inspect")));
	diagnoseButton.setAttribute("aria-label", tr("诊断候选", "Inspect candidate"));
	diagnoseButton.type = "button";
	diagnoseButton.disabled = true;
	const sheetHost = el(sidebar, "section");
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = el(sheet.body, "div", "cpo-detail");
	const listPanel = el(sheet.body, "div", "cpo-agg");
	listPanel.hidden = true;
	const actionsBar = el(sidebar, "div", "cpo-actions-bar");
	const map = new SimilarityMap(canvas, tooltip, stage);
	surface.showAllConnections.addEventListener("change", () => map.setShowAllCitationConnections(surface.showAllConnections.checked));
	map.libraryStatus = paper => paper.id === "discovery:query" ? null : deps.researchLibrary?.()?.read(paper) ?? null;
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, { onResize: () => map.resize() });
	let mapFilter: GraphFilter = emptyFilter();
	map.setKinds(mapFilter.kinds);
	const graphKey = mountGraphKey(rail, () => mapFilter, (next) => {
		mapFilter = next;
		map.setKinds(next.kinds);
	}, () => {
		const seed = graph?.nodes.find((node) => node.isSeed) ?? null;
		if (!seed) return;
		activateGraphTab();
		showDetail(seed);
		scheduleProjectSave();
	});
	graphKey.paintColor("force2d");
	map.onVisibleConnections = edges => graphKey.setVisibleConnections(edges);
	let graph: SimilarityGraph | null = null;
	type ExploreMode = "citation" | "rank" | "search" | "similar";
	let exploreMode: ExploreMode = "citation";
	let similarityBase: SimilarityGraph | null = null;
	let discoveryPayload: DiscoveryPayload | null = null;
	let discoveryGraph: ReturnType<typeof buildDiscoveryGraph> | null = null;
	let discoveryRevision = 0;
	let discoveryBusy = false;
	const discoveryCache = new Map<string, DiscoveryPayload>();
	let citationSession: { graph: SimilarityGraph; view: SavedView; deepDives: DeepDiveBatch[] } | null = null;
	type Checkpoint = { snapshot: ReturnType<typeof saveGraphSnapshot>; view: SavedView; hidden: Set<string>; deepDives: DeepDiveBatch[]; paperStates: Record<string, ProjectPaperState> };
	const UNDO_LIMIT = 50;
	let undoStack: Checkpoint[] = [];
	let redoStack: Checkpoint[] = [];
	let deepDiveBatches: DeepDiveBatch[] = [];
	let expanding = false;
	let persistProjectNow: (current: SimilarityGraph) => void = () => {};
	const projectSave = createProjectSave(() => { if (graph && exploreMode === "citation") persistProjectNow(graph); });
	const flushProjectSave = (): void => projectSave.flush();
	const scheduleProjectSave = (): void => projectSave.schedule();
	let tab: GraphTab = "graph";
	let releaseLibraryMenu: (() => void) | undefined;
	let narrative: ResearchNarrative | null = null;
	let narrativeInput: NarrativeEvidence | null = null;
	let narrativeMeta = "";
	let narrativeError = "";
	let scrubYear: number | null = null;
	let chrome: GraphChrome | null = null;
	let selectedPaper: PaperNode | null = null;
	let selectedEdge: GraphEdge | null = null;
	const s2EvidenceRequests = new Map<string, Promise<import("./citation-sources").SemanticCitation[]>>();
	/** 轨道按钮持有的布局；建图后回灌给画布，保持按钮与实际渲染一致。 */
	let layoutMode: LayoutMode = "force2d";
	let similarityKind: SimilarityKind = "text";
	let storedText: StoredTextEvidence[] = [];
	let comparison = { text: new Map<string, number>(), citations: new Map<string, number>(), details: new Map<string, TextComparison>() };
	let storedTextRevision = 0;
	let storedTextGraph: SimilarityGraph | null = null;
	let scopedActive = false;
	let graphBusy = false;
	let queryEdited = false;
	function syncSubmitAction(): void {
		submit.textContent = graphBusy ? tr("正在加载…", "Loading…") : exploreMode === "similar"
			? tr("查找相似论文", "Find similar papers") : tr("构建", "Build");
		submit.disabled = graphBusy || exploreMode === "similar" && !queryEdited && similarityExplorer.searching;
	}
	const similarityExplorer = mountSimilarityExplorer(stage, () => deps.researchLibrary?.() ?? null, () => {
		if (disposed) return;
		refreshSimilarityScores();
		const current = similarityExplorer.result?.graph.nodes.find(paper => paper.id === selectedPaper?.id)
			?? similarityExplorer.result?.graph.nodes.find(paper => paper.isSeed);
		if (current && tab === "graph") showDetail(current);
		if (exploreMode === "similar") {
			const seed = similarityExplorer.result?.graph.nodes.find(paper => paper.isSeed);
			if (seed && !queryEdited) input.value = normalizeDoi(seed.doiUrl) || seed.openAlexUrl || seed.title;
			empty.hidden = Boolean(similarityExplorer.result?.shown);
			emptyTitle.textContent = tr("没有匹配的论文", "No matching papers");
			messageText.textContent = tr("尝试其他来源论文或搜索范围。", "Try a different source paper or search scope.");
		}
	}, async paper => {
		const doi = normalizeDoi(paper.doiUrl);
		const previous = graph;
		setExploreMode("citation");
		if (doi) await buildResolved({ kind: "doi", value: doi }, true);
		else if (/^W\d+$/i.test(paper.id)) await buildResolved({ kind: "openalex", value: paper.id }, true);
		return graph !== previous;
	}, syncSubmitAction, createComparisonCitations(() => client()), { controlsHost: form, before: submit,
		literature: createLiteratureSearch(fresh => client(fresh), () => deps.getSettings().excludeRetracted) });
	function refreshSimilarityScores(): void {
		surface.apiStatus.refresh();
		map.setDistanceScale(surface.distanceScale.value === "absolute" ? "absolute" : "relative");
		root.classList.toggle("is-similarity", layoutMode === "radial");
		root.classList.toggle("is-citation-similarity", layoutMode === "radial" && similarityKind === "citations");
		const scoped = similarityExplorer.update(exploreMode === "similar" ? similarityBase : graph, storedText, exploreMode === "similar", similarityKind);
		syncSubmitAction();
		syncInfoBar();
		if (scoped) {
			comparison = scoped.scores;
			map.adoptGraph(scoped.graph.nodes, scoped.graph.edges, comparison[similarityKind]);
			graphKey.setStats(scoped.graph.nodes, scoped.graph.edges);
			map.setComparisonScores(comparison[similarityKind], similarityKind);
			scopedActive = true;
			return;
		}
		if (scopedActive && graph && exploreMode === "citation") map.adoptGraph(graph.nodes, graph.edges, graph.seedScore);
		scopedActive = false;
		if (exploreMode === "citation" && graph) {
			comparison = comparisonData(graph, storedText);
			map.setComparisonScores(layoutMode === "radial" ? comparison[similarityKind] : graph.seedScore, similarityKind);
		} else if (discoveryGraph) map.setComparisonScores(exploreMode === "similar" && similarityKind === "citations" ? new Map<string, number>() : discoveryGraph.seedScore, exploreMode === "similar" ? similarityKind : "text");
	}
	function syncInfoBar(): void {
		const key = `${exploreMode}:${tab}:${layoutMode}:${similarityKind}:${similarityExplorer.contextKey}:${activeQuestion}:${similarityBase?.nodes.find(p => p.isSeed)?.id ?? ""}:${graph?.nodes.find(p => p.isSeed)?.id ?? ""}`;
		if (tab !== "graph") { infoBar.context(key, { kind: "summary", text: tabTitles[tab] }); return; }
		if (exploreMode === "similar") {
			infoBar.context(key, similarityExplorer.status ?? { kind: "summary", text: tr("查找相似论文 · 选择来源论文。", "Find similar papers · Choose a source paper.") });
		} else if (exploreMode !== "citation") {
			const label = exploreMode === "rank" ? tr("论文筛选", "Paper screening") : exploreMode === "search" ? tr("PDF 搜索", "PDF search") : tr("相关论文", "Related papers");
			const guidance = !activeQuestion ? tr("先选择研究问题。", "Choose a research question first.") : tr("设置条件后运行。", "Choose criteria and run.");
			infoBar.context(key, { kind: "summary", text: discoveryGraph ? `${label} · ${discoveryGraph.rows.size}/${discoveryGraph.total} ${tr("篇论文", "papers")}` : `${label} · ${guidance}` });
		} else if (similarityExplorer.status) infoBar.context(key, similarityExplorer.status);
		else infoBar.context(key, graphInfo(graph, layoutMode));
	}
	function loadStoredText(): void {
		const revision = ++storedTextRevision, target = graph;
		if (storedTextGraph !== target) { storedText = []; storedTextGraph = target; }
		refreshSimilarityScores();
		const bridge = deps.researchLibrary?.();
		if (!target || exploreMode !== "citation" || !bridge?.textEvidence) return;
		void bridge.textEvidence(target.nodes).then(rows => {
			if (disposed || revision !== storedTextRevision || graph !== target || exploreMode !== "citation") return;
			storedText = rows; refreshSimilarityScores();
			if (selectedPaper && tab === "graph") showDetail(selectedPaper);
		}).catch(() => { /* Graph evidence remains usable if sidecars cannot be read. */ });
	}
	let generation = 0;
	let hiddenIds = new Set<string>();
	let composing = false;
	let disposed = false;
	let narrativeBusy = false;
	let settingsRevision = 0;
	/** Abstract fallback: which source filled an abstract, or which DOI has no known abstract. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractFromCrossref = new Set<string>();
	const abstractMissing = new Set<string>();
	const llmReady = (): boolean => {
		const s = deps.getSettings();
		return Boolean(s.llmEnabled && s.llmEndpoint.trim() && s.llmModel.trim() && deps.postJson);
	};

	const showError = (message: string): void => {
		banner.hidden = false;
		banner.textContent = message;
	};
	const clearError = (): void => {
		banner.hidden = true;
		banner.textContent = "";
	};
	const hideResults = (): void => {
		results.hidden = true;
		results.replaceChildren();
	};
	const setBusy = (busy: boolean): void => {
		graphBusy = busy;
		if (!busy) infoBar.clearProgress();
		input.disabled = busy;
		reload.disabled = busy || !graph;
		surface.diversifyResults.disabled = busy || exploreMode !== "citation" || layoutMode === "radial";
		syncSubmitAction();
	};

	const shownNodes = (): PaperNode[] => {
		const displayed = similarityExplorer.result?.graph ?? graph;
		if (!displayed) return [];
		return displayed.nodes.filter((node) => node.isSeed || scrubYear === null || (node.year !== null && node.year <= scrubYear));
	};

	const tabTitles: Record<GraphTab, string> = {
		graph: tr("论文详情与关联依据", "Paper details & evidence"),
		prior: tr("先验工作", "Prior works"),
		derivative: tr("衍生工作", "Derivative works"),
		research: tr("研究脉络", "Research narrative"),
		staged: tr("收藏", "Bookmarks"),
		excluded: tr("已排除论文", "Excluded papers"),
	};

	const paintLists = (): void => {
		syncInfoBar();
		releaseLibraryMenu?.(); releaseLibraryMenu = undefined;
		evidenceHeading.textContent = exploreMode !== "citation" && tab === "graph" ? tr("论文详情与检索结果", "Paper details & results") : tabTitles[tab] ?? tabTitles.graph;
		libraryButton.setAttribute("aria-pressed", tab === "staged" || tab === "excluded" ? "true" : "false");
		sheetHost.classList.toggle("cpo-sheet-analysis", tab === "research");
		detail.hidden = tab !== "graph";
		if (tab === "research") {
			paintResearch();
			return;
		}
		if (tab === "staged") {
			paintStaged();
			return;
		}
		if (tab === "excluded") {
			paintExcluded();
			return;
		}
		if (!graph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(shownNodes().map((node) => node.id));
		const seed = graph.nodes.find((node) => node.isSeed);
		const rows = (tab === "prior" ? priorWorks(graph, visible) : derivativeWorks(graph, visible))
			.filter((row) => !seed || !deps.getSettings().researchProjects[seed.id]?.paperStates?.[row.paper.id]?.excluded);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? tr("被本图引用", "Cited by this graph") : tr("引用本图", "Cites this graph");
		listPanel.hidden = false;
		listPanel.replaceChildren();
		const copy = createEl("p");
		copy.className = "cpo-agg-def";
		copy.textContent = definition;
		listPanel.append(copy);
		if (rows.length === 0) {
			const empty = createEl("p");
			empty.className = "cpo-agg-empty";
			empty.textContent = AGGREGATE_EMPTY_TEXT;
			listPanel.append(empty);
			return;
		}
		const list = createEl("ol");
		list.className = "cpo-agg-list";
		for (const row of rows) {
			paintAggregateCard(list, row, noun, (paper) => {
				if (graph?.nodes.some((node) => node.id === paper.id)) showDetail(paper);
			}, (card, paper) => {
				if (!seed) return;
				const settings = deps.getSettings();
				const state = settings.researchProjects[seed.id]?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
				paintPaperWorkflowState(card, paper, state, (reading, previous) => saveReading(paper, seed.id, reading, previous, state.source), () => {
					if (graph?.nodes.some((node) => node.id === paper.id)) removePaper(paper);
					else if (graph) {
						updateProjectPaperState(settings.researchProjects, seed.id, paper, { excluded: true });
						hiddenIds.add(paper.id);
						graph.excludedIds = [...hiddenIds];
						persistProject(graph);
						paintLists();
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
		}
		listPanel.append(list);
	};

	const paintLibrarySwitch = (parent: HTMLElement): void => {
		const row = el(parent, "div", "cpo-library-switch");
		for (const [next, label] of [["staged", tr("收藏", "Bookmarks")], ["excluded", tr("排除", "Excluded")]] as const) {
			const button = el(row, "button", "cpo-library-switch-item", label);
			button.type = "button";
			button.setAttribute("aria-pressed", tab === next ? "true" : "false");
			button.onclick = () => {
				tab = next;
				chrome?.setTab(next);
				paintLists();
			};
		}
	};

	const paintLibraryCard = (list: HTMLOListElement, paper: PaperNode, source: string, actions: (container: HTMLElement) => void): void => {
		const item = el(list, "li", "cpo-agg-entry");
		const card = el(item, "div", "cpo-card cpo-library-card");
		el(card, "h3", "cpo-card-title", paper.title || paper.id);
		const authorShort = paper.authorList?.length
			? paper.authorList.length > 2
				? `${paper.authorList.slice(0, 2).join(", ")} et al.`
				: paper.authorList.join(" · ")
			: paper.authors;
		const metaParts = [
			paper.year === null ? tr("年份不详", "Year unknown") : String(paper.year),
			authorShort,
			source,
			paper.id.startsWith("local:") ? "" : tr(`被引 ${formatCount(paper.citedByCount)}`, `Cited ${formatCount(paper.citedByCount)}`),
		].filter(Boolean);
		el(card, "p", "cpo-library-meta", metaParts.join(" · "));
		const actionRow = el(card, "div", "cpo-library-actions");
		actions(actionRow);
	};

	const paintStaged = (): void => {
		releaseLibraryMenu?.(); releaseLibraryMenu = undefined;
		listPanel.hidden = false;
		listPanel.replaceChildren();
		paintLibrarySwitch(listPanel);
		const libraryHeader = el(listPanel, "div", "cpo-library-header");
		const libraryHeading = el(libraryHeader, "div", "cpo-library-heading");
		el(libraryHeading, "h3", "cpo-kicker", tr("收藏", "Bookmarks"));
		const projects = deps.getSettings().researchProjects ?? {};
		const bookmarks = deps.paperLibrary?.bookmarks();
		const pendingLegacy = bookmarks ? projectStagedPapers(projects) : [];
		if (pendingLegacy.length) {
			const pending = el(listPanel, "details", "cpo-legacy-bookmarks");
			el(pending, "summary", "cpo-fact-note", tr(`${pendingLegacy.length} 条旧收藏待迁移`, `${pendingLegacy.length} legacy bookmarks awaiting migration`));
			for (const item of pendingLegacy) el(pending, "p", "cpo-fact-note", item.paper.title);
			if (deps.retryBookmarkMigration) {
				const retry = el(pending, "button", "cpo-paper-action", tr("重试迁移", "Retry migration")); retry.type = "button";
				retry.onclick = async () => { retry.disabled = true; try { await deps.retryBookmarkMigration?.(); paintStaged(); } catch (error) { infoBar.notify(error instanceof Error ? error.message : "Bookmark migration failed", "error"); } finally { retry.disabled = false; } };
			}
		}
		const items = bookmarks ? bookmarks.map(item => ({ seedId: "vault", paper: item.paper, source: "Library bookmark", reading: item.reading, addedAt: "", read: item.reading === "read" })) : projectStagedPapers(projects);
		el(libraryHeading, "span", "cpo-library-count", tr(`${items.length} 篇`, `${items.length} papers`));
		if (items.length === 0) { el(listPanel, "p", "cpo-agg-empty", tr("还没有收藏论文。", "No bookmarked papers yet.")); return; }
		const actionMenu = el(libraryHeader, "details", "cpo-library-menu");
		const actionTrigger = el(actionMenu, "summary", "cpo-ghost cpo-library-menu-trigger");
		actionTrigger.setAttribute("aria-label", tr("清单操作", "List actions"));
		actionTrigger.append(createChromeIcon("export"), document.createTextNode(tr("清单操作", "List actions")), createChromeIcon("chevronDown"));
		releaseLibraryMenu = registerPopover(actionMenu);
		const actionItems = el(actionMenu, "div", "cpo-library-menu-items");
		const copyTable = el(actionItems, "button", "cpo-library-menu-item", tr("复制表格", "Copy table"));
		copyTable.prepend(createChromeIcon("table"));
		copyTable.type = "button";
		copyTable.onclick = () => {
			const text = toMarkdownTable(orderedForExport(items.map((item) => item.paper)));
			void chrome?.copyText(text, tr("表格", "Table"));
		};
		const copyBib = el(actionItems, "button", "cpo-library-menu-item", tr("复制 BibTeX", "Copy BibTeX"));
		copyBib.prepend(createChromeIcon("copy"));
		copyBib.type = "button";
		copyBib.onclick = () => {
			const text = toBibTeX(orderedForExport(items.map((item) => item.paper)));
			void chrome?.copyText(text, "BibTeX");
		};
		if (deps.createNote) {
			const divider = el(actionItems, "span", "cpo-library-menu-divider");
			divider.setAttribute("role", "separator");
			const noteBtn = el(actionItems, "button", "cpo-library-menu-item", tr("写入清单笔记", "Write list to note"));
			noteBtn.prepend(createChromeIcon("note"));
			noteBtn.type = "button";
			noteBtn.onclick = () => {
				const lines = [tr("# 收藏论文", "# Bookmarks"), ""];
				for (const group of groupStagedBySeed(items)) {
					if (!bookmarks) lines.push(tr(`## 种子 ${group.seedId}`, `## Seed ${group.seedId}`), "");
					for (const item of group.items) {
						lines.push(tr(`- ${item.paper.title || item.paper.id}（${item.paper.year ?? tr("年份不详", "Year unknown")}）· ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`, `- ${item.paper.title || item.paper.id} (${item.paper.year ?? tr("年份不详", "Year unknown")}) · ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`));
						if (item.paper.doiUrl) lines.push(`  - DOI: ${item.paper.doiUrl}`);
						lines.push(`  - ${item.paper.openAlexUrl}`);
					}
					lines.push("");
				}
				void deps.createNote!(tr("收藏论文.md", "Bookmarks.md"), lines.join("\n")).then(() => {
					chrome?.setExportText(tr("已写入笔记：收藏论文.md", "Written to note: Bookmarks.md"));
				}).catch((error) => {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				});
			};
		}
		if (bookmarks && deps.paperLibrary) {
			const library = deps.paperLibrary, list = el(listPanel, "ol", "cpo-agg-list");
			for (const entry of bookmarks) paintLibraryCard(list, entry.paper, "", actions => {
				paintPaperActions(actions, entry.paper, null, null, null, { library, getPaperState: () => undefined, setStaged: () => {}, openExternal: deps.openExternal });
			});
			return;
		}
		for (const group of groupStagedBySeed(items)) {
			const seedTitle = graph?.nodes.find((node) => node.id === group.seedId)?.title;
			el(listPanel, "h4", "cpo-kicker cpo-staged-group-title", seedTitle ? tr(`种子 · ${seedTitle}`, `Seed · ${seedTitle}`) : tr(`种子 · ${group.seedId}`, `Seed · ${group.seedId}`));
			const list = el(listPanel, "ol", "cpo-agg-list");
			for (const item of group.items) {
				paintLibraryCard(list, item.paper, displayStageSource(item.source), (actions) => {
					const open = el(actions, "button", "cpo-library-action", tr("查看", "View"));
					open.type = "button";
					open.onclick = () => openSavedPaper(item.seedId, item.paper);
					const reading = el(actions, "select", "cpo-paper-reading-select");
					reading.setAttribute("aria-label", tr(`阅读状态：${item.paper.title || item.paper.id}`, `Reading status: ${item.paper.title || item.paper.id}`));
					for (const [value, label] of [["unread", tr("未读", "Unread")], ["to-read", tr("待读", "To read")], ["read", tr("已读", "Read")]] as const) {
						const option = createEl("option");
						option.value = value;
						option.textContent = label;
						reading.append(option);
					}
					reading.value = item.reading;
					reading.onchange = async () => {
						reading.disabled = true;
						try {
							await saveReading(item.paper, item.seedId, reading.value as ReadingStatus, item.reading, item.source);
							paintStaged();
						}
						catch (error) {
							reading.value = error instanceof ReadingSaveError ? error.reading : item.reading;
							infoBar.notify(error instanceof Error ? error.message : tr("阅读状态保存失败，请重试", "Could not save reading status. Try again."), "error");
						}
						finally { reading.disabled = false; }
					};
					const remove = el(actions, "button", "cpo-library-action is-quiet", tr("移除", "Remove"));
					remove.type = "button";
					remove.onclick = async () => {
						updateProjectPaperState(projects, item.seedId, item.paper, { staged: false });
						try { await deps.stagePaper?.(item.paper, item.seedId, item.source); paintStaged(); }
						catch { updateProjectPaperState(projects, item.seedId, item.paper, { staged: true }); infoBar.notify(tr("暂存状态保存失败，请重试", "Could not save the saved-paper state. Try again."), "error"); }
					};
				});
			}
		}
	};

	const paintExcluded = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		paintLibrarySwitch(listPanel);
		el(listPanel, "h3", "cpo-kicker", tr("已排除论文", "Excluded papers"));
		const seedId = currentSeedId();
		const project = seedId ? deps.getSettings().researchProjects[seedId] : null;
		const states = project ? projectExcludedPapers(project) : [];
		if (!states.length) { el(listPanel, "p", "cpo-agg-empty", tr("当前项目没有排除的论文。", "No papers are excluded from this project.")); return; }
		const list = el(listPanel, "ol", "cpo-agg-list");
		for (const state of states) {
			paintLibraryCard(list, state.paper, state.source, (actions) => {
				const restore = el(actions, "button", "cpo-library-action", tr("恢复到图谱", "Restore to graph"));
				restore.type = "button";
				restore.onclick = () => { if (project && graph) restoreExcludedPaper(project.seedId, state); };
			});
		}
	};

	const paintResearch = (): void => {
		listPanel.replaceChildren();
		listPanel.hidden = !llmReady();
		if (!llmReady()) { narrative = null; return; }
		el(listPanel, "h3", "cpo-kicker", tr("研究脉络", "Research narrative"));
		const tip = el(listPanel, "p", "cpo-side-tip", narrativeError || (narrativeBusy ? tr("正在请求模型…", "Requesting the model…") : tr("手动生成：向已配置服务发送当前种子的论文元数据、引用关系和已获取的引用上下文。摘要由设置控制。结果覆盖整张采样图，不随年份滑块变化。", "Generate manually: send the current seed's paper metadata, citation links, and available citation context to the configured service. Abstracts are controlled in settings. The result covers the sampled graph and does not change with the year slider.")));
		const generate = el(listPanel, "button", "cpo-primary", narrative ? tr("重新生成", "Regenerate") : tr("生成研究脉络", "Generate research narrative"));
		generate.type = "button";
		generate.disabled = narrativeBusy || !graph;
		generate.addEventListener("click", () => void generateResearch(generate, tip));
		if (!narrative) return;
		const exportText = () => {
			if (!narrative || !llmReady()) return "";
			return [
				tr("# 研究脉络", "# Research narrative"), narrativeMeta,
				narrative.synthesis,
				...(["basedOn", "influenced", "importantWorks"] as const).flatMap(key => narrative![key].map(item => {
					const paper = [...(graph?.nodes ?? []), ...(graph?.catalog ?? [])].find(p => p.id === item.paperId);
					return tr(`- ${item.claim}\n  论文：${paper?.title ?? item.paperId} — https://openalex.org/${encodeURIComponent(item.paperId)}\n  证据：${item.evidence.join("；")}`, `- ${item.claim}\n  Paper: ${paper?.title ?? item.paperId} — https://openalex.org/${encodeURIComponent(item.paperId)}\n  Evidence: ${item.evidence.join("; ")}`);
				})), ...narrative.caveats.map(c => "- " + c),
			].join("\n\n");
		};
		addLink(listPanel, tr("复制总结", "Copy summary"), () => { const text = exportText(); if (text) void chrome?.copyText(text, tr("研究脉络总结", "Research narrative summary")); });
		if (deps.createNote) addLink(listPanel, tr("写入总结笔记", "Write summary to note"), () => {
			const text = exportText(), id = graph?.nodes.find(p => p.isSeed)?.id;
			if (text && id) void deps.createNote!(tr(`研究脉络-${id}.md`, `Research narrative-${id}.md`), text).then(() => { tip.textContent = tr("已写入总结笔记。", "Summary written to note."); }).catch(() => { tip.textContent = tr("笔记写入失败。", "Could not write the note."); });
		});
		const evidenceDetails = el(listPanel, "details");
		el(evidenceDetails, "summary", undefined, tr("查看使用的论文和证据", "View source papers and evidence"));
		el(evidenceDetails, "pre", "cpo-export-text", JSON.stringify(narrativeInput, null, 2));
		el(listPanel, "h4", "cpo-kicker", tr("总体总结", "Overview"));
		el(listPanel, "p", "cpo-abstract", narrative.synthesis);
		paintNarrativeSection(tr("基于的研究", "Prior research"), narrative.basedOn);
		paintNarrativeSection(tr("后续影响", "Later developments"), narrative.influenced);
		paintNarrativeSection(tr("重要工作", "Key works"), narrative.importantWorks);
		if (narrative.caveats.length) {
			el(listPanel, "h4", "cpo-kicker", tr("限制", "Limitations"));
			for (const caveat of narrative.caveats) el(listPanel, "p", "cpo-side-tip", caveat);
		}
	};

	const paintNarrativeSection = (title: string, items: ResearchNarrative["basedOn"]): void => {
		if (!items.length) return;
		el(listPanel, "h4", "cpo-kicker", title);
		for (const item of items) {
			const paper = graph?.nodes.find((node) => node.id === item.paperId) ?? graph?.catalog.find((node) => node.id === item.paperId);
			const button = el(listPanel, "button", "cpo-agg-item");
			button.type = "button";
			button.textContent = tr(`${paper?.year ?? "—"} · ${paper?.title ?? item.paperId} · 模型自评 ${item.confidence}`, `${paper?.year ?? "—"} · ${paper?.title ?? item.paperId} · Model confidence ${item.confidence}`);
			button.addEventListener("click", () => { if (paper) { activateGraphTab(); showDetail(paper); } });
			el(listPanel, "p", "cpo-side-tip", item.claim);
			if (item.evidence.length) el(listPanel, "p", "cpo-evidence", item.evidence.join("；"));
		}
	};

	const generateResearch = async (button: HTMLButtonElement, tip: HTMLElement): Promise<void> => {
		if (!llmReady() || narrativeBusy || !graph || !deps.postJson) {
			tip.textContent = tr("LLM 尚未配置，或当前运行环境不支持 POST 请求。", "The LLM is not configured, or POST requests are unavailable in this environment.");
			return;
		}
		const settings = deps.getSettings();
		const requestGraph = graph;
		const requestGeneration = generation;
		const revision = settingsRevision;
		narrativeBusy = true;
		narrativeError = "";
		button.disabled = true;
		tip.textContent = tr("正在整理引用证据并请求 LLM…", "Preparing citation evidence and requesting the LLM…");
		try {
			const evidence = buildNarrativeEvidence(graph, settings.llmSendAbstracts);
			const result = await summarizeWithLlmPost(deps.postJson, {
				enabled: settings.llmEnabled,
				endpoint: settings.llmEndpoint,
				apiKey: settings.llmApiKey,
				model: settings.llmModel,
			}, evidence);
			if (disposed || requestGraph !== graph || requestGeneration !== generation || revision !== settingsRevision || !llmReady()) return;
			narrative = { ...result, caveats: [...new Set([...evidence.caveats, ...result.caveats])] };
			narrativeInput = evidence;
			narrativeMeta = tr(`生成时间：${new Date().toISOString()}；模型：${settings.llmModel}；种子：${evidence.seed.title} (${evidence.seed.id})`, `Generated: ${new Date().toISOString()}; model: ${settings.llmModel}; seed: ${evidence.seed.title} (${evidence.seed.id})`);
			if (tab === "research") paintResearch();
		} catch (error) {
			if (disposed || requestGraph !== graph || requestGeneration !== generation || revision !== settingsRevision || !llmReady()) return;
			narrativeError = error instanceof Error ? error.message : tr("LLM 总结失败。", "LLM summary failed.");
			tip.textContent = narrativeError;
			button.disabled = false;
		} finally {
			narrativeBusy = false;
			if (!disposed && tab === "research" && llmReady()) paintResearch();
		}
	};

	chrome = mountGraphChrome(layoutHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: "force2d",
		noteButton: Boolean(deps.createNote),
		researchButton: llmReady(),
		actionsHost: actionsBar,
		layoutHost,
		scrubHost,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(mode);
			refreshSimilarityScores();
			syncExploreControls();
			if (selectedPaper && tab === "graph") showDetail(selectedPaper);
			map.setColorMode(exploreMode === "citation" ? defaultColorMode(mode) : "graph");
			scheduleProjectSave();
			graphKey.paintColor(mode);
		},
		onSimilarity: (kind) => {
			similarityKind = kind; refreshSimilarityScores();
			if (selectedPaper && tab === "graph") showDetail(selectedPaper);
			scheduleProjectSave();
		},
		onScrub: (year) => {
			scrubYear = year;
			mapFilter = { ...mapFilter, scrubYear: year };
			map.setScrubYear(year);
			scheduleProjectSave();
			paintLists();
		},
		onTab: (next) => {
			tab = next;
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
		},
		onExport: (kind) => {
			void exportPane(kind);
		},
	});

	/** 切回「图谱」页签并同步按钮高亮，供各列表里的详情链接统一调用。 */
	const activateGraphTab = (): void => {
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
	};

	diagnoseButton.addEventListener("click", () => {
		if (!graph) return;
		const returnPaper = selectedPaper;
		const returnEdge = selectedEdge;
		activateGraphTab();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("候选诊断", "Candidate inspection"), tr("当前图谱的采样记录", "Sampling records for the current graph"));
		const back = el(detail, "button", "cpo-diagnose-back", tr("‹ 返回论文", "‹ Back to paper"));
		back.type = "button";
		back.disabled = !returnPaper;
		back.onclick = () => returnEdge ? showEdgeDetail(returnEdge) : showDetail(returnPaper);
		const form = el(detail, "form", "cpo-diagnose-form");
		const query = el(form, "input");
		query.type = "text";
		query.placeholder = tr("DOI 或 OpenAlex ID", "DOI or OpenAlex ID");
		query.setAttribute("aria-label", tr("要诊断的论文", "Paper to inspect"));
		const check = el(form, "button", "cpo-primary", tr("查询", "Search"));
		check.type = "submit";
		const result = el(detail, "div", "cpo-diagnose-result");
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (!graph) return;
			const finding = diagnoseCandidate(graph, query.value, hiddenIds, scrubYear);
			result.replaceChildren();
			el(result, "strong", undefined, finding.title);
			el(result, "p", "cpo-side-tip", finding.detail);
			const paper = finding.paperId && graph.nodes.find((item) => item.id === finding.paperId);
			if (paper) {
				const open = el(result, "button", "cpo-text-btn", tr("查看论文", "View paper"));
				open.type = "button";
				open.onclick = () => showDetail(paper);
			}
		});
		query.focus();
	});

	const exportPane = async (kind: ExportKind): Promise<void> => {
		if (!graph) return;
		if (kind === "note") {
			const paper = selectedPaper ?? graph.nodes.find((node) => node.isSeed);
			if (!paper) return;
			if (deps.lookupLiteratureNote?.(paper)) { showDetail(paper); chrome?.setExportText(tr("已找到文献笔记，请从详情中选择打开", "Literature notes found. Open one from the paper details.")); return; }
			const settings = deps.getSettings();
			const seedId = graph.nodes.find((node) => node.isSeed)?.id ?? paper.id;
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
					showDetail(paper);
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				}
				return;
			}
			await chrome?.copyText(markdown, tr("笔记内容", "Note contents"));
			return;
		}
		const nodes = orderedForExport(shownNodes());
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		await chrome?.copyText(text, kind === "bibtex" ? "BibTeX" : kind === "yaml" ? "YAML" : tr("表格", "Table"));
	};

	const abstractText = (paper: PaperNode): string => {
		if (paper.abstract) {
			const source = abstractFromS2.has(paper.id) ? "Semantic Scholar" : abstractFromCrossref.has(paper.id) ? "Crossref" : "";
			return paper.abstract + (source ? tr(`（摘要来源：${source}）`, ` (abstract source: ${source})`) : "");
		}
		if (abstractMissing.has(paper.id)) return tr("OpenAlex、Semantic Scholar 和 Crossref 都没有这篇的摘要。", "No abstract is available from OpenAlex, Semantic Scholar, or Crossref.");
		return tr("OpenAlex 没有摘要，正在查询 Semantic Scholar / Crossref…", "No OpenAlex abstract; checking Semantic Scholar and Crossref…");
	};

	const getEvidence = (citingId: string, citedId: string) => graph?.citationEvidence?.get(citingId, citedId) ?? null;
	const edgeSources = (edge: GraphEdge): string => edgeSourcesText(edge, getEvidence);

	const doiPending = new Map<string, Promise<DoiRecovery>>();
	let doiSave: Promise<void> = Promise.resolve();
	const doiOptions = (paper: PaperNode) => ({
		cached: cachedDoiRecovery(paper, deps.getSettings().doiRecoveries),
		find: (): Promise<DoiRecovery> => {
			const key = doiRecoveryKey(paper);
			const pending = doiPending.get(key);
			if (pending) return pending;
			const task = (async () => {
				const result = await recoverDoi(paper, deps.getJson, deps.getSettings().contactEmail);
				const save = doiSave.catch(() => {}).then(async () => {
					const settings = deps.getSettings(), previous = settings.doiRecoveries;
					settings.doiRecoveries = Object.fromEntries(Object.entries({ ...previous, [key]: result })
						.sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 500));
					try { await deps.persistSettings?.(); }
					catch (error) { settings.doiRecoveries = previous; throw error; }
				});
				doiSave = save;
				await save;
				applyRecoveredDoi(paper, result);
				return result;
			})();
			doiPending.set(key, task);
			void task.finally(() => doiPending.delete(key)).catch(() => {});
			return task;
		},
		changed: () => { if (selectedPaper === paper) showDetail(paper); },
	});
	const showDetail = (paper: PaperNode | null): void => {
		if (paper && selectedPaper?.id === paper.id && readingChangePending(deps.getSettings().researchProjects, graph?.nodes.find(node => node.isSeed)?.id ?? paper.id, paper)) return;
		surface.announceSelection(paper?.title ?? "");
		if (paper) applyRecoveredDoi(paper, cachedDoiRecovery(paper, deps.getSettings().doiRecoveries));
		selectedPaper = paper;
		selectedEdge = null;
		detail.replaceChildren();
		if (paper && similarityExplorer.paintDetail(detail, paper, similarityKind, deps.openExternal, doiOptions(paper))) {
			// Keep workflow state tied to the saved project, even when the comparison center changes.
			const projectId = citationSession?.graph.nodes.find(node => node.isSeed)?.id ?? similarityBase?.nodes.find(node => node.isSeed)?.id ?? graph?.nodes.find(node => node.isSeed)?.id ?? paper.id;
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
		if (paper && discoveryGraph && discoveryPayload && exploreMode !== "citation") {
			map.setSelected(paper.id); sheet.setSummary(paper.title, tr("本地探索结果", "Local discovery result"));
			const row = discoveryGraph.rows.get(paper.id);
			if (!row) { el(detail, "p", "cpo-side-tip", tr("此节点代表问题或查询。选择一篇论文查看详情。", "This node represents the question or query. Select a paper for details.")); return; }
			paintMetadataCard(detail, paper, undefined);
			paintPaperActions(detail, paper, null, null, null, { library: deps.paperLibrary, getPaperState: () => undefined, setStaged: () => {}, openExternal: deps.openExternal });
			const scoreText = discoveryPayload.mode === "rank" ? `ASReview priority percentile: ${row.priority ?? "training seed"}. Screening order, not a relevance probability.`
				: `PaperQA2 retrieval rank: ${row.rank ?? "unknown"}. Retrieval position, not a similarity score.`;
			el(detail, "p", "cpo-fact-note", scoreText);
			if (row.label) el(detail, "p", "cpo-fact-note", `Question judgment: ${row.label}`);
			const bridge = deps.researchLibrary?.();
			if (bridge) {
				const actions = el(detail, "div", "cpo-paper-actions");
				for (const [target, label] of [[vaultPath(row.note), tr("打开笔记", "Open result note")], [vaultPath(row.pdf || row.file), tr("打开 PDF", "Open result PDF")]]) if (target) {
					const button = el(actions, "button", "cpo-ghost", label!); button.type = "button"; button.addEventListener("click", () => bridge.open(target));
				}
				paintLibraryAvailability(detail, paper, bridge, deps.openExternal, doiOptions(paper));
			}
			const doi = normalizeDoi(paper.doiUrl);
			if (doi) {
				const cite = el(detail, "button", "cpo-primary", tr("探索引用网络", "Explore citation network")); cite.type = "button";
				cite.addEventListener("click", () => { setExploreMode("citation"); void buildResolved({ kind: "doi", value: doi }); });
			}
			return;
		}
		if (!paper || !graph) {
			map.setSelected(null);
			sheet.setSummary(tr("点选节点查看论文", "Select a node to view its paper"), "");
			el(detail, "p", "cpo-side-tip", tr("点选节点查看题名、年份、作者和证据。", "Select a node to view its title, year, authors, and evidence."));
			return;
		}
		map.setSelected(paper.id);
		const year = paper.year === null ? tr("年份不详", "Year unknown") : String(paper.year);
		sheet.setSummary(paper.title, tr(`${year} · 被引 ${formatCount(paper.citedByCount)}`, `${year} · cited ${formatCount(paper.citedByCount)} times`), { lang: paper.language });
		paintMetadataCard(detail, paper, graph.crossCheck?.get(paper.id));
		if (!paper.isSeed) {
			const compare = el(detail, "button", "cpo-ghost", tr("设为种子论文", "Set as seed paper"));
			compare.type = "button";
			setHoverHint(compare, tr("以这篇论文重新构建相似度图谱", "Rebuild the similarity map around this paper"));
			compare.addEventListener("click", () => {
				chrome?.setLayout("radial");
				input.value = paper.id;
				void buildResolved({ kind: "openalex", value: paper.id });
			});
		}
		const library = deps.researchLibrary?.();
		if (library) paintLibraryAvailability(detail, paper, library, deps.openExternal, doiOptions(paper));
		const seedNode = graph.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seedNode?.id ?? paper.id;
		const project = deps.getSettings().researchProjects[seedId];
		paintIdentitySources(detail, paper, deps.openExternal, () => {
			if (!graph) return;
			if (graph.nodes.length + (paper.records?.length ?? 1) - 1 > deps.getSettings().maxNodes) { infoBar.notify(tr("分开记录将超过节点上限，请先移除其他论文", "Splitting these records would exceed the node limit. Remove another paper first."), "error"); return; }
			const next = separateWorkRecords(graph, paper);
			if (project) reconcileProjectIdentity(project, next);
			applyEdit(next, tr("已保持来源记录分开", "Source records are now kept separate"), undefined, true);
		}, project?.identityConflicts?.includes(paper.id), () => {
			if (!project) return;
			acknowledgeIdentityStates(project, paper);
			void deps.persistSettings?.(); showDetail(paper);
		});
		let state = project?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
		const noted = deps.lookupLiteratureNote?.(paper) ?? null;
		if (noted?.reading && noted.reading !== state.reading && !readingChangePending(deps.getSettings().researchProjects, seedId, paper)) {
			state = { ...state, reading: updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: noted.reading }).reading };
			void (deps.persistSettings ? deps.persistSettings() : deps.stagePaper?.(paper, seedId, state.source));
		}
		paintPaperWorkflowState(detail, paper, state, (reading, previous) => saveReading(paper, seedId, reading, previous, state.source), !paper.isSeed ? () => removePaper(paper) : undefined);
		if (noted && deps.openLiteratureNote) paintLiteratureLink(detail, noted.path, deps.openLiteratureNote, noted.alternatives);
		let diveIndex = -1;
		for (let index = 0; index < deepDiveBatches.length; index += 1) if (deepDiveBatches[index]!.additions.some((item) => item.paperId === paper.id)) diveIndex = index;
		if (diveIndex >= 0) {
			const batch = deepDiveBatches[diveIndex]!;
			const parent = graph.nodes.find((node) => node.id === batch.parentId) ?? graph.catalog.find((node) => node.id === batch.parentId);
			const sources = [...new Set(batch.additions.filter((item) => item.paperId === paper.id).map((item) => ({ reference: tr("参考文献", "References"), citation: tr("施引文献", "Citing papers"), "shared-reference": tr("共享参考文献候选", "Shared-reference candidate"), legacy: tr("既有深挖记录", "Earlier deep-dive record") })[item.source]))].join("、");
			const identityCard = detail.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? detail;
			const actionRow = identityCard.querySelector<HTMLElement>(":scope > .cpo-paper-actions");
			const diveNote = createEl("p");
			diveNote.className = "cpo-fact-note";
			diveNote.textContent = tr(`第 ${diveIndex + 1} 轮深挖 · ${parent?.title ?? batch.parentId} · ${sources}`, `Deep dive ${diveIndex + 1} · ${parent?.title ?? batch.parentId} · ${sources}`);
			if (actionRow) identityCard.insertBefore(diveNote, actionRow);
			else identityCard.append(diveNote);
		}
		const stageEdge = seedNode && !paper.isSeed ? findEdge(graph.edges, paper.id, seedNode.id) : null;
		const stageEvidence = seedNode && !paper.isSeed ? graph.citationEvidence?.get(paper.id, seedNode.id) ?? graph.citationEvidence?.get(seedNode.id, paper.id) ?? null : null;
		paintPaperActions(detail, paper, seedNode?.id ?? null, stageEdge, stageEvidence, {
			library: deps.paperLibrary,
			getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
			setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
			persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seedNode!.id, source) : undefined,
			openExternal: deps.openExternal,
		});
		paintAbstractCard(detail, paper, abstractText);
		if (seedNode && !paper.isSeed && layoutMode === "radial") {
			paintComparisonCard(detail, similarityKind, comparison[similarityKind].get(paper.id), comparison.details.get(paper.id));
		} else if (seedNode && !paper.isSeed) {
			const link = findEdge(graph.edges, paper.id, seedNode.id);
			const from = link ? graph.nodes.find((node) => node.id === link.source) : undefined;
			const to = link ? graph.nodes.find((node) => node.id === link.target) : undefined;
			const score = graph.seedScore.get(paper.id);
			if (link && from && to) {
				paintRelationSection(detail, link, from, to, { sources: edgeSources(link), getEvidence, seedScore: score, semanticScore: graph.semanticScores?.get(paper.id), semanticHint: semanticHintFor(graph.semanticMode) });
			} else {
				const recorded =
					graph.citationEvidence?.get(paper.id, seedNode.id) ?? graph.citationEvidence?.get(seedNode.id, paper.id);
				if (score !== undefined || !recorded) {
					const card = el(detail, "section", "cpo-card");
					if (score !== undefined) paintMeter(card, tr("图谱候选选择分", "Graph selection score"), score, tr("用于候选选择的结构和文本/主题信号", "Structure and text/topic signals used for candidate selection"));
					const semantic = graph.semanticScores?.get(paper.id);
					if (semantic !== undefined) paintMeter(card, tr("文本/主题信号", "Text/topic signal"), semantic, semanticHintFor(graph.semanticMode), true);
					if (!recorded) el(card, "p", "cpo-fact-note", tr(`与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`, `No direct citation to the seed recorded · ${SIMILARITY_NOT_CITATION}`));
				}
			}
			const rankInfo = graph.selectionRank?.get(paper.id);
			if (rankInfo) paintSelectionReasons(detail, rankInfo, score);
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
				if (disposed || token !== generation) return;
				if (result) {
					paper.abstract = result.text;
					if (result.source === "s2") abstractFromS2.add(paper.id);
					else abstractFromCrossref.add(paper.id);
				} else {
					abstractMissing.add(paper.id);
				}
				if (selectedPaper === paper && tab === "graph") showDetail(paper);
			});
		}
	};

	const incompleteCitationChecks = new WeakSet<SimilarityGraph>();
	surface.apiStatus.read = () => exploreMode === "similar" ? graphApiStatus(similarityExplorer.result?.graph ?? similarityBase, similarityKind === "text" ? deps.researchLibrary?.() : null, similarityExplorer.apiError, false) : exploreMode === "citation" ? graphApiStatus(graph, layoutMode === "radial" && similarityKind === "text" ? deps.researchLibrary?.() : null, similarityExplorer.apiError, Boolean(graph && incompleteCitationChecks.has(graph))) : [];
	const nodePopover = mountNodePopover(stage, canvas, map, () => !body.classList.contains("is-sidebar-collapsed"));
	map.onSelect = (paper) => {
		nodePopover.show(paper, similarityKind, comparison[similarityKind].get(paper?.id ?? ""), comparison.details.get(paper?.id ?? ""), deps.researchLibrary?.()); showDetail(paper); scheduleProjectSave(); };
	const onLibraryChanged = (): void => {
		if (disposed) return;
		similarityExplorer.invalidate();
		loadStoredText();
		if (graph) deps.researchLibrary?.()?.prefetch?.(graph.nodes);
		else if (discoveryGraph) deps.researchLibrary?.()?.prefetch?.(discoveryGraph.nodes.filter(paper => paper.id !== "discovery:query"));
		map.refreshLibraryStatus();
		if (selectedPaper && tab === "graph") showDetail(selectedPaper);
		else if (tab === "staged") paintStaged();
	};
	window.addEventListener("research-connected-library-changed", onLibraryChanged);
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || (!graph && !similarityBase) || (exploreMode !== "citation" && exploreMode !== "similar")) {
			nodeMenu.hidden = true;
			return;
		}
		deleteItem.hidden = scopedActive;
		expandItem.hidden = scopedActive;
		nodeMenu.querySelector<HTMLElement>(".cpo-node-menu-sep")?.toggleAttribute("hidden", scopedActive);
		deleteItem.disabled = paper.isSeed;
		setHoverHint(deleteItem, paper.isSeed ? tr("种子不能排除", "The seed paper cannot be excluded") : tr("从当前项目排除", "Exclude from this project"));
		seedItem.disabled = paper.isSeed;
		seedItem.textContent = tr("设为种子论文", "Set as seed paper");
		setHoverHint(seedItem, paper.isSeed ? tr("已是种子", "Already the seed") : tr("以这篇重建整图", "Rebuild graph with this paper as seed"));
		paintLocalPaperAction(nodeMenu, paper, deps.researchLibrary?.(), true);
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		placeNodeMenu(stage, nodeMenu, x, y);
	};
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
		scheduleProjectSave();
	});
	sidebarToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-sidebar-collapsed");
		sidebarToggle.textContent = on ? "‹" : "›";
		sidebarToggle.setAttribute("aria-expanded", on ? "false" : "true");
		sidebarToggle.setAttribute("aria-label", on ? tr("展开右侧栏", "Expand right sidebar") : tr("折叠右侧栏", "Collapse right sidebar"));
		afterPanelToggle();
		scheduleProjectSave();
	});
	map.onDeleteRequest = () => {
		if (selectedPaper) removePaper(selectedPaper);
	};
	const showEdgeDetail = (edge: GraphEdge): void => {
		if (discoveryGraph && exploreMode !== "citation") { showDetail(discoveryGraph.nodes.find(paper => paper.id === edge.target) ?? null); return; }
		const displayed = similarityExplorer.result?.graph ?? graph;
		if (!displayed) return;
		const a = displayed.nodes.find(p => p.id === edge.source), b = displayed.nodes.find(p => p.id === edge.target);
		if (!a || !b) return;
		detail.replaceChildren(); detail.hidden = false; sheet.setExpanded(true);
		sheet.setSummary(tr("引用证据", "Citation evidence"), "");
		paintRelationSection(detail, edge, a, b, { sources: edgeSources(edge), getEvidence });
		paintJumpStrip(detail, a, (target) => showDetail(target));
		paintJumpStrip(detail, b, (target) => showDetail(target));
		void loadSelectedEdgeEvidence(edge, a, b);
	};

	const loadSelectedEdgeEvidence = async (edge: GraphEdge, a: PaperNode, b: PaperNode): Promise<void> => {
		const current = graph;
		const settings = deps.getSettings();
		if (!current || !settings.s2Reconcile || !deps.postJson) return;
		const pair = edgePairNeedingS2Context(edge, getEvidence);
		if (!pair) return;
		const citing = current.nodes.find((p) => p.id === pair.citingId);
		const cited = current.nodes.find((p) => p.id === pair.citedId);
		const citingDoi = normalizeDoi(citing?.doiUrl);
		const citedDoi = normalizeDoi(cited?.doiUrl);
		if (!citing || !cited || !citingDoi || !citedDoi) return;
		let request = s2EvidenceRequests.get(citingDoi);
		if (!request) {
			const client = new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
			request = client.referenceEvidence(citingDoi).then(({ data }) => data);
			request.catch(() => s2EvidenceRequests.delete(citingDoi));
			s2EvidenceRequests.set(citingDoi, request);
		}
		let citations;
		try {
			citations = await request;
		} catch {
			if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) {
				el(detail, "p", "cpo-fact-note", tr("Semantic Scholar 引用语境暂时不可用。", "Semantic Scholar citation context is currently unavailable."));
			}
			return;
		}
		current.citationEvidence ??= new CitationEvidenceStore();
		mergeS2CitationsForPair(current.citationEvidence, citing.id, cited.id, citedDoi, citations, normalizeDoi);
		if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) showEdgeDetail(edge);
	};
	map.onEdgeSelect = (edge) => {
		nodePopover.hide();
		selectedEdge = edge;
		selectedPaper = null;
		showEdgeDetail(edge);
	};
	showDetail(null);

	const hideNodeMenu = (): void => {
		nodeMenu.hidden = true;
		delete nodeMenu.dataset.paperId;
	};
	function syncExploreControls(): void {
		surface.diversifyResults.checked = deps.getSettings().diversifyResults !== false;
		surface.diversifyResults.disabled = exploreMode !== "citation" || input.disabled || layoutMode === "radial";
		surface.diversityHint.textContent = exploreMode !== "citation"
			? tr("本地发现结果不使用多样性筛选。", "Similarity and local discovery results do not use diversity selection.")
			: layoutMode === "radial" ? tr("相似度搜索直接按文本分数排序。多样化选项用于平面和时间视图的引用邻居筛选。", "Similarity search ranks directly by text score. Diversity applies to citation-neighbor selection in Planar and Timeline.")
			: tr("减少重复候选，为不同论文留出空间。关闭后移除多样性惩罚。更改后重新构建引用图谱。", "Make room for different papers by reducing redundant candidates. Turn off to remove the diversity penalty. Changes rebuild the citation graph.");
		setHoverHint(surface.diversifyResults.parentElement!, surface.diversityHint.textContent ?? "");
		chrome?.setCitationSimilarityAvailable(exploreMode === "citation" || exploreMode === "similar");
		chrome?.setSimilarityAvailable(exploreMode === "citation" || exploreMode === "similar");
		const local = exploreMode !== "citation";
		method.value = exploreMode;
		root.classList.toggle("is-discovery", local);
		form.hidden = local && exploreMode !== "similar";
		input.placeholder = exploreMode === "similar" ? tr("来源论文：DOI、标题或文库论文", "Source paper: DOI, title, or library paper") : tr("DOI、OpenAlex ID 或论文标题", "DOI, OpenAlex ID, or paper title");
		if (exploreMode === "similar") input.setAttribute("list", choices.id); else input.removeAttribute("list");
		input.setAttribute("aria-label", exploreMode === "similar" ? tr("来源论文", "Source paper") : tr("种子论文", "Seed paper"));
		pdfLabel.hidden = indexPdfs.hidden = exploreMode !== "search";
		limitLabel.hidden = runDiscovery.hidden = !local || exploreMode === "similar";
		actionsBar.hidden = local;
		diagnoseButton.disabled = local || !graph || layoutMode === "radial";
		reload.hidden = local;
		runDiscovery.textContent = exploreMode === "search" ? tr("搜索 PDF", "Search PDFs") : tr("筛选论文", "Screen papers");
		if (discoveryBusy) runDiscovery.textContent = tr("正在运行…", "Running…");
		stage.setAttribute("aria-busy", String(discoveryBusy));
		setHoverHint(runDiscovery, exploreMode === "search" ? tr("搜索 PDF · PaperQA2", "Search PDFs · PaperQA2") : tr("筛选论文 · ASReview", "Screen papers · ASReview"));
		syncSubmitAction();
		const canRun = !!deps.researchLibrary?.()?.discovery && !!activeQuestion;
		runDiscovery.disabled = indexPdfs.disabled = discoveryBusy || !canRun;
		pdfQuery.disabled = discoveryBusy;
		discoveryCount.setDisabled(discoveryBusy);
		for (const option of Array.from(method.options)) if (option.value !== "citation" && option.value !== "similar") option.disabled = !deps.researchLibrary?.()?.discovery;
	}
	function clearDiscoverySurface(): void {
		discoveryPayload = null; discoveryGraph = null; selectedPaper = null; selectedEdge = null;
		map.setGraph([], [], new Map()); map.setScrubYear(null);
		chrome?.clearYears(); listPanel.hidden = true; detail.replaceChildren();
		empty.hidden = false; emptyTitle.hidden = false;
		emptyTitle.textContent = tr("探索研究问题", "Explore your research question");
		messageText.textContent = activeQuestion || exploreMode === "similar" ? tr("设置条件后运行，结果会显示在此图谱中。", "Run the selected method to show papers on this graph.") : tr("先在上方选择一个研究问题。", "Choose a research question above first.");
		showDetail(null);
		syncInfoBar();
	}
	function discoveryKey(mode: ExploreMode): string { return `${activeQuestion}\n${mode}`; }
	function setExploreMode(mode: ExploreMode, deferSource = false): void {
		if (deferSource && mode === "similar") {
			similarityBase = null;
			similarityExplorer.update(null, [], false);
		}
		if (mode === exploreMode) { syncExploreControls(); return; }
		discoveryRevision++; discoveryBusy = false; generation++; hideResults(); hideNodeMenu(); clearError(); clearUndo();
		if (exploreMode === "citation") {
			flushProjectSave();
			citationSession = graph ? { graph, deepDives: deepDiveBatches, view: { name: "Current view", layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: Date.now(), filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter } } : null;
			graph = null;
		}
		exploreMode = mode;
		if (mode === "citation") {
			discoveryPayload = null; discoveryGraph = null;
			map.setKinds(mapFilter.kinds);
			const session = citationSession; citationSession = null;
			if (session) { deepDiveBatches = session.deepDives; applyGraph(session.graph, session.view, false, false); }
			else clearDiscoverySurface();
		} else if (mode === "similar") {
			tab = "graph"; chrome?.setTab("graph"); detail.hidden = false;
			clearDiscoverySurface();
			const firstSearch = !similarityBase;
			if (!deferSource && !similarityBase && citationSession) similarityBase = citationSession.graph;
			if (firstSearch) {
				layoutMode = "radial"; map.setLayout(layoutMode);
				chrome?.restoreView({ layout: layoutMode, similarityKind, scrubYear: null });
			}
			if (similarityBase) showSimilaritySource(similarityBase);
			else {
				emptyTitle.textContent = tr("查找相似论文", "Find similar papers");
				messageText.textContent = tr("输入 DOI、标题，或选择一篇文库论文。", "Enter a DOI, title, or choose a library paper.");
			}
		} else {
			tab = "graph"; chrome?.setTab("graph"); detail.hidden = false;
			map.setKinds({ direct: false, cocitation: false, coupling: false, weak: true });
			map.setColorMode("graph"); clearDiscoverySurface();
			const cached = discoveryCache.get(discoveryKey(mode));
			if (cached) displayDiscovery(cached);
			else infoBar.notify(tr("选择条件后运行本地探索。", "Run local discovery when ready."));
		}
		setBusy(false); syncExploreControls(); refreshSimilarityScores(); syncInfoBar(); map.resize();
	}
	function displayDiscovery(payload: DiscoveryPayload): void {
		const next = buildDiscoveryGraph(payload, Number(discoveryLimit.value));
		discoveryPayload = payload; discoveryGraph = next;
		infoBar.clearProgress();
		discoveryCache.set(discoveryKey(exploreMode), payload);
		if (payload.mode === "search") pdfQuery.value = payload.query ?? "";
		map.setGraph(next.nodes, next.edges, next.seedScore); map.setColorMode("graph");
		map.setLayout(layoutMode); map.setScrubYear(null); scrubYear = null;
		refreshSimilarityScores();
		const years = next.nodes.flatMap(paper => paper.year === null ? [] : [paper.year]);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years)); else chrome?.clearYears();
		deps.researchLibrary?.()?.prefetch?.(next.nodes.filter(paper => paper.id !== "discovery:query"));
		empty.hidden = next.nodes.length > 1;
		if (!empty.hidden) { emptyTitle.textContent = tr("没有匹配的论文", "No matching papers"); messageText.textContent = tr("尝试不同的查询、来源论文或问题。", "Try a different query, source paper or question."); }
		showDetail(next.nodes.find(paper => !paper.isSeed) ?? next.nodes[0] ?? null);
		syncInfoBar();
	}
	async function generateDiscovery(index = false): Promise<void> {
		const runner = deps.researchLibrary?.()?.discovery;
		if (!runner || discoveryBusy || exploreMode === "citation" || exploreMode === "similar") return;
		if (!activeQuestion) { showError(tr("请先选择研究问题。", "Choose a research question first.")); return; }
		if (!index && exploreMode === "search" && !pdfQuery.value.trim()) { showError(tr("请输入全文查询。", "Enter a PDF query.")); return; }
		const request: DiscoveryRequest = { engine: exploreMode === "search" ? "paperqa" : "asreview", mode: "rank", question: activeQuestion, query: exploreMode === "search" ? pdfQuery.value.trim() : "" };
		if (index) { request.action = "index"; request.selection = discoveryCache.get(discoveryKey("rank"))?.papers; }
		const revision = ++discoveryRevision;
		discoveryBusy = true; syncExploreControls(); clearError();
		infoBar.notify(index ? tr("正在索引选定 PDF…", "Indexing selected PDFs…") : tr("正在生成本地结果…", "Generating local results…"), "busy");
		try {
			const payload = await runner.run(request);
			if (disposed || revision !== discoveryRevision) return;
			if (index) infoBar.notify(tr(`已索引 ${payload.indexed} 篇 PDF，可以开始搜索。`, `${payload.indexed} PDFs indexed. Enter a query to search.`), "success");
			else displayDiscovery(payload);
		} catch (error) { if (!disposed && revision === discoveryRevision) { showError(error instanceof Error ? error.message : String(error)); infoBar.notify(tr("本地探索失败，可重试。", "Local discovery failed. You can retry."), "error"); } }
		finally { if (!disposed && revision === discoveryRevision) { discoveryBusy = false; infoBar.clearProgress(); syncExploreControls(); syncInfoBar(); } }
	}
	method.addEventListener("change", () => setExploreMode(method.value as ExploreMode));
	runDiscovery.addEventListener("click", () => { void generateDiscovery(); });
	indexPdfs.addEventListener("click", () => { void generateDiscovery(true); });
	pdfQuery.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void generateDiscovery(); } });

	const persistProject = (current: SimilarityGraph): void => {
		const seed = current.nodes.find((node) => node.isSeed);
		if (!seed || !deps.saveProject) return;
		const prior = deps.getSettings().researchProjects[seed.id];
		const project: ResearchProject = {
			...prior,
			version: 1,
			seedId: seed.id,
			name: prior?.name && prior.name !== seed.id ? prior.name : (seed.title || seed.id),
			updatedAt: Date.now(),
			snapshot: saveGraphSnapshot(current),
			currentView: { name: tr("当前视图", "Current view"), layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: Date.now(), filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter, leftCollapsed: body.classList.contains("is-rail-collapsed"), rightCollapsed: body.classList.contains("is-sidebar-collapsed") },
			views: prior?.views ?? [],
			deepDives: deepDiveBatches,
			paperStates: prior?.paperStates ?? {},
		};
		linkGraphToQuestion(project, activeQuestion);
		void Promise.resolve(deps.saveProject(project)).catch((error) => {
			infoBar.notify(error instanceof Error ? tr(`项目保存失败：${error.message}`, `Could not save project: ${error.message}`) : tr("项目保存失败", "Could not save the project"), "error");
		});
		refreshProjectSelect(seed.id);
	};
	persistProjectNow = persistProject;
	const saveCurrentViewOnGesture = (): void => scheduleProjectSave();
	canvas.addEventListener("pointerup", saveCurrentViewOnGesture);
	canvas.addEventListener("wheel", saveCurrentViewOnGesture, { passive: true });
	canvas.addEventListener("keyup", saveCurrentViewOnGesture);

	const refreshProjectSelect = (selectedId = currentSeedId()): void => {
		const all = deps.getSettings().researchProjects ?? {};
		const questions = new Map((deps.researchLibrary?.()?.discovery?.context().questions ?? []).map(item => [item.path, item.title]));
		for (const project of Object.values(all)) for (const path of project.questionPaths ?? []) if (!questions.has(path)) questions.set(path, path.split("/").pop()!.replace(/\.md$/, ""));
		if (activeQuestion && !questions.has(activeQuestion)) questions.set(activeQuestion, activeQuestion.split("/").pop()!.replace(/\.md$/, ""));
		questionSelect.replaceChildren();
		const unassigned = createEl("option", { value: "", text: tr("未关联问题的图谱", "Unassigned graphs") }); questionSelect.append(unassigned);
		for (const [path, title] of questions) questionSelect.append(createEl("option", { value: path, text: title }));
		questionSelect.value = activeQuestion;
		openQuestion.disabled = !activeQuestion;
		syncExploreControls();
		const projects = graphsForQuestion(all, activeQuestion);
		projectSelect.replaceChildren();
		if (!projects.some(project => project.seedId === selectedId)) {
			const option = createEl("option");
			option.value = "";
			option.textContent = tr("选择或构建引用图谱", "Choose or build a citation graph");
			projectSelect.append(option);
		}
		for (const project of projects) {
			const option = createEl("option");
			option.value = project.seedId;
			option.textContent = project.name;
			projectSelect.append(option);
		}
		if (activeQuestion) {
			const others = Object.values(all).filter(project => project.snapshot && !projects.includes(project));
			if (others.length) {
				const group = createEl("optgroup", { attr: { label: tr("关联已有图谱…", "Link existing graph…") } });
				for (const project of others) group.append(createEl("option", { value: project.seedId, text: project.name }));
				projectSelect.append(group);
			}
		}
		projectSelect.disabled = projectSelect.options.length === 1 && !projectSelect.options[0]?.value;
		projectSelect.value = projects.some((project) => project.seedId === selectedId) ? selectedId! : "";
		renameProjectButton.disabled = viewNameInput.disabled = !projectSelect.value;
		saveViewButton.disabled = !graph;
		refreshViews();
	};

	const refreshViews = (): void => {
		const project = deps.getSettings().researchProjects[projectSelect.value];
		viewSelect.replaceChildren();
		const current = createEl("option");
		current.value = "";
		current.textContent = tr("当前视图", "Current view");
		viewSelect.append(current);
		for (const [index, view] of (project?.views ?? []).entries()) {
			const option = createEl("option");
			option.value = String(index);
			option.textContent = view.name;
			viewSelect.append(option);
		}
		viewSelect.disabled = !project?.views.length;
	};

	libraryButton.addEventListener("click", () => {
		const inLibrary = tab === "staged" || tab === "excluded";
		tab = inLibrary ? "graph" : "staged";
		chrome?.setTab(tab);
		if (tab !== "graph") sheet.setExpanded(true);
		paintLists();
	});
	projectSelect.addEventListener("change", () => {
		const project = deps.getSettings().researchProjects[projectSelect.value];
		const snapshot = project && restoreGraphSnapshot(project.snapshot);
		if (!project || !snapshot) return;
		flushProjectSave();
		linkGraphToQuestion(project, activeQuestion);
		void Promise.resolve(deps.saveProject?.(project)).catch(error => { infoBar.notify(String(error), "error"); });
		deepDiveBatches = project.deepDives ?? [];
		clearUndo();
		generation += 1;
		applyGraph(snapshot, project.currentView, false);
		setBusy(false);
		refreshProjectSelect(project.seedId);
	});
	function openSavedPaper(seedId: string, paper: PaperNode): void {
		const project = deps.getSettings().researchProjects[seedId];
		if (exploreMode !== "citation" || currentSeedId() !== seedId) {
			const snapshot = project && restoreGraphSnapshot(project.snapshot);
			if (!snapshot) {
				const note = deps.lookupLiteratureNote?.(paper);
				if (note && deps.openLiteratureNote) deps.openLiteratureNote(note.path);
				else if (paper.doiUrl || paper.openAlexUrl) deps.openExternal(paper.doiUrl || paper.openAlexUrl);
				else infoBar.notify(tr("此论文没有保存的图谱、匹配笔记或在线链接。", "No saved graph, matching note, or online link is available for this paper."), "error");
				return;
			}
			flushProjectSave(); clearUndo(); generation++;
			deepDiveBatches = project.deepDives ?? [];
			applyGraph(snapshot, project.currentView, false, false);
			setBusy(false);
		}
		activateGraphTab();
		showDetail(graph?.nodes.find(node => paperHasId(node, paper.id)) ?? paper);
		scheduleProjectSave();
	}
	questionSelect.addEventListener("change", () => {
		const nextQuestion = questionSelect.value;
		const previousMode = exploreMode;
		if (exploreMode !== "citation") setExploreMode("citation");
		flushProjectSave();
		activeQuestion = nextQuestion;
		deps.getSettings().activeQuestion = activeQuestion;
		void Promise.resolve(deps.persistSettings?.()).catch(error => { infoBar.notify(String(error), "error"); });
		generation++; clearUndo(); hideResults(); hideNodeMenu(); clearError();
		const project = graphsForQuestion(deps.getSettings().researchProjects, activeQuestion)[0];
		const snapshot = project && restoreGraphSnapshot(project.snapshot);
		if (snapshot) { deepDiveBatches = project.deepDives ?? []; applyGraph(snapshot, project.currentView, false, false); }
		else {
			graph = null; deepDiveBatches = []; selectedPaper = null; selectedEdge = null;
			hiddenIds = new Set(); scrubYear = null; chrome?.clearYears(); diagnoseButton.disabled = true;
			map.setGraph([], [], new Map()); showDetail(null); paintLists();
			empty.hidden = false; emptyTitle.hidden = false;
			emptyTitle.textContent = tr("探索这个研究问题", "Explore this question");
			messageText.textContent = tr("筛选论文、搜索本地 PDF，或选择种子论文构建引用图谱。", "Rank papers, search local PDFs, or build a citation graph from a seed paper.");
		}
		setBusy(false); refreshProjectSelect(project?.seedId);
		infoBar.notify(activeQuestion ? tr("研究问题已选定。", "Research question selected.") : tr("未关联问题的图谱", "Unassigned graphs"));
		if (previousMode !== "citation") { pdfQuery.value = ""; setExploreMode(previousMode); }
	});

	viewNameInput.addEventListener("input", () => {
		saveViewButton.disabled = !graph;
	});
	viewNameInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") { event.preventDefault(); saveViewButton.click(); }
		if (event.key === "Escape") {
			viewNameInput.hidden = true;
			saveViewText.textContent = tr("保存视图", "Save view");
		}
	});

	renameProjectButton.onclick = async () => {
		const project = deps.getSettings().researchProjects[projectSelect.value];
		if (!project) return;
		if (renameProjectInput.hidden) {
			renameProjectInput.hidden = false;
			renameProjectInput.value = project.name;
			renameProjectText.textContent = tr("确认", "Confirm");
			renameProjectInput.focus();
			return;
		}
		const name = renameProjectInput.value.trim();
		if (!name) { infoBar.notify(tr("项目名称不能为空", "Project name cannot be empty"), "error"); renameProjectInput.focus(); return; }
		project.name = name.slice(0, 120);
		project.updatedAt = Date.now();
		try {
			await deps.saveProject?.(project);
			renameProjectInput.hidden = true;
			renameProjectText.textContent = tr("重命名", "Rename");
			refreshProjectSelect(project.seedId);
			infoBar.notify(tr(`项目已重命名为「${project.name}」`, `Project renamed to “${project.name}”`), "success");
		} catch (error) {
			infoBar.notify(error instanceof Error ? error.message : tr("项目名称保存失败", "Could not save the project name"), "error");
		}
	};
	renameProjectInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") { event.preventDefault(); renameProjectButton.click(); }
		if (event.key === "Escape") { renameProjectInput.hidden = true; renameProjectText.textContent = tr("重命名", "Rename"); }
	});

	viewSelect.addEventListener("change", () => {
		const project = deps.getSettings().researchProjects[projectSelect.value];
		const view = viewSelect.value === "" ? project?.currentView : project?.views[Number(viewSelect.value)];
		if (view) restoreNamedView(view);
	});

	saveViewButton.onclick = async () => {
		if (!graph) return;
		if (viewNameInput.hidden && !viewNameInput.value.trim()) {
			viewNameInput.hidden = false;
			saveViewText.textContent = tr("确认", "Confirm");
			viewNameInput.focus();
			return;
		}
		const name = viewNameInput.value.trim();
		if (!name) { infoBar.notify(tr("先输入视图名称", "Enter a view name first"), "error"); viewNameInput.focus(); return; }
		const seedId = currentSeedId();
		if (!seedId) return;
		const prior = deps.getSettings().researchProjects[seedId];
		const now = Date.now();
		const view: SavedView = { name: name.trim().slice(0, 80), layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: now, filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter, leftCollapsed: body.classList.contains("is-rail-collapsed"), rightCollapsed: body.classList.contains("is-sidebar-collapsed") };
		const views = [...(prior?.views ?? []).filter((item) => item.name !== view.name), view].slice(-30);
		try {
			await deps.saveProject?.({
				...prior,
				version: 1,
				seedId,
				name: prior?.name ?? graph.nodes.find((node) => node.isSeed)?.title ?? seedId,
				updatedAt: now,
				snapshot: saveGraphSnapshot(graph),
				currentView: view,
				views,
				deepDives: prior?.deepDives ?? deepDiveBatches,
				paperStates: prior?.paperStates ?? {},
			});
			viewNameInput.value = "";
			viewNameInput.hidden = true;
			saveViewText.textContent = tr("保存视图", "Save view");
			saveViewButton.disabled = !graph;
			refreshViews();
			infoBar.notify(tr(`已保存视图「${view.name}」`, `Saved view “${view.name}”`), "success");
		} catch (error) {
			infoBar.notify(error instanceof Error ? error.message : tr("视图保存失败", "Could not save the view"), "error");
		}
	};

	function updateUndoUi(): void {
		undoButton.hidden = !undoStack.length && !redoStack.length;
		redoButton.hidden = undoButton.hidden;
		undoButton.disabled = !undoStack.length;
		redoButton.disabled = !redoStack.length;
		statusBar.hidden = undoButton.hidden ? statusIsExternal : false;
	}
	function clearUndo(): void {
		undoStack = [];
		redoStack = [];
		updateUndoUi();
	}
	const captureCheckpoint = (): Checkpoint | null => {
		if (!graph) return null;
		const seedId = currentSeedId();
		const stateSource = seedId ? deps.getSettings().researchProjects[seedId]?.paperStates ?? {} : {};
		return {
			snapshot: JSON.parse(JSON.stringify(saveGraphSnapshot(graph))) as ReturnType<typeof saveGraphSnapshot>,
			view: { name: tr("当前视图", "Current view"), layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: Date.now(), filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter, leftCollapsed: body.classList.contains("is-rail-collapsed"), rightCollapsed: body.classList.contains("is-sidebar-collapsed") },
			hidden: new Set(hiddenIds),
			deepDives: JSON.parse(JSON.stringify(deepDiveBatches)) as DeepDiveBatch[],
			paperStates: JSON.parse(JSON.stringify(stateSource)) as Record<string, ProjectPaperState>,
		};
	};
	const applyEdit = (next: SimilarityGraph, note: string, nearId?: string, reflow = false): void => {
		const checkpoint = captureCheckpoint();
		if (checkpoint) {
			undoStack = [...undoStack, checkpoint].slice(-UNDO_LIMIT);
			redoStack = [];
			updateUndoUi();
		}
		graph = next;
		map.adoptGraph(next.nodes, next.edges, next.seedScore, nearId, reflow);
		loadStoredText();
		deps.researchLibrary?.()?.prefetch?.(next.nodes);
		graphKey.setStats(next.nodes, next.edges);
		graphKey.paintColor(layoutMode);
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		else chrome?.clearYears();
		paintLists();
		const selectedId = selectedPaper?.id;
		const keep = selectedId && next.nodes.some((node) => node.id === selectedId);
		if (!keep) {
			const seed = next.nodes.find((node) => node.isSeed) ?? null;
			selectedPaper = seed;
			selectedEdge = null;
			showDetail(seed);
		} else showDetail(next.nodes.find((node) => node.id === selectedId) ?? null);
		infoBar.notify(tr(`${note} · ${next.nodes.length} 篇 · ${next.edges.length} 条关系`, `${note} · ${next.nodes.length} papers · ${next.edges.length} links`), "success");
		persistProject(next);
	};
	const restoreCheckpoint = (checkpoint: Checkpoint): boolean => {
		const previous = restoreGraphSnapshot(checkpoint.snapshot);
		if (!previous) return false;
		deepDiveBatches = JSON.parse(JSON.stringify(checkpoint.deepDives)) as DeepDiveBatch[];
		const seedId = previous.nodes.find((node) => node.isSeed)?.id;
		if (seedId) {
			const project = deps.getSettings().researchProjects[seedId];
			if (project) project.paperStates = JSON.parse(JSON.stringify(checkpoint.paperStates)) as Record<string, ProjectPaperState>;
		}
		applyGraph(previous, checkpoint.view, false);
		hiddenIds = new Set(checkpoint.hidden);
		void deps.persistSettings?.();
		return true;
	};
	const stepHistory = (direction: "undo" | "redo"): void => {
		const target = (direction === "undo" ? undoStack : redoStack).at(-1);
		if (!target) return;
		const current = captureCheckpoint();
		if (!restoreCheckpoint(target)) { clearUndo(); infoBar.notify(tr("无法恢复图谱状态", "Could not restore the graph state"), "error"); return; }
		if (direction === "undo") {
			undoStack = undoStack.slice(0, -1);
			if (current) redoStack = [...redoStack, current];
		} else {
			redoStack = redoStack.slice(0, -1);
			if (current) undoStack = [...undoStack, current].slice(-UNDO_LIMIT);
		}
		updateUndoUi();
		infoBar.notify(direction === "undo" ? tr("已撤销上一步图谱修改", "Undid the last graph change") : tr("已重做图谱修改", "Redid the graph change"), "success");
	};
	undoButton.addEventListener("click", () => stepHistory("undo"));
	redoButton.addEventListener("click", () => stepHistory("redo"));
	// Rebuilding the detail panel drops focus to <body>, so listen on the document and
	// accept body-targeted keys while the last pointer press was inside this view.
	const undoDoc = root.ownerDocument;
	let pointerInside = false;
	const onUndoPointer = (event: PointerEvent): void => {
		pointerInside = event.target instanceof Node && root.contains(event.target);
	};
	const onUndoKey = (event: KeyboardEvent): void => {
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.key.toLowerCase();
		const redo = key === "y" || (key === "z" && event.shiftKey);
		if (!redo && key !== "z") return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
		const inside = (target instanceof Node && root.contains(target)) || (pointerInside && (target === undoDoc.body || target === undoDoc.documentElement));
		if (!inside || !root.isConnected) return;
		if (!(redo ? redoStack : undoStack).length) return;
		event.preventDefault();
		stepHistory(redo ? "redo" : "undo");
	};
	undoDoc.addEventListener("pointerdown", onUndoPointer, true);
	undoDoc.addEventListener("keydown", onUndoKey);

	const currentSeedId = (): string | null => graph?.nodes.find((node) => node.isSeed)?.id ?? null;

	const removePaper = (paper: PaperNode): void => {
		if (!graph || paper.isSeed) return;
		hideNodeMenu();
		const next = omitNode(graph, paper.id);
		if (!next) return;
		next.excludedIds = [...new Set([...hiddenIds, paper.id])];
		const seedId = currentSeedId();
		const updated = refreshDerived(next);
		applyEdit(updated, tr("已排除 1 篇", "Excluded one paper"), undefined, true);
		hiddenIds.add(paper.id);
		if (seedId) {
			updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { excluded: true });
			persistProject(updated);
		}
	};

	const restoreExcludedPaper = (seedId: string, state: ProjectPaperState): void => {
		if (!graph) return;
		if (graph.nodes.length >= Math.min(300, deps.getSettings().maxNodes)) {
			infoBar.notify(tr("已到节点上限，请先移除其他论文再恢复", "Node limit reached. Remove another paper before restoring."), "error");
			return;
		}
		const next = graftNodes(graph, [state.paper], new Map());
		next.excludedIds = (next.excludedIds ?? []).filter((id) => id !== state.paper.id);
		const updated = refreshDerived(next);
		applyEdit(updated, tr("已恢复 1 篇论文", "Restored one paper"), state.paper.id, true);
		hiddenIds.delete(state.paper.id);
		updateProjectPaperState(deps.getSettings().researchProjects, seedId, state.paper, { excluded: false });
		persistProject(updated);
	};

	const expandPaper = async (paper: PaperNode): Promise<void> => {
		if (!graph || expanding) return;
		hideNodeMenu();
		const settings = deps.getSettings();
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		if (!seedId) return;
		const slots = Math.min(EXPAND_CAP, settings.maxNodes - graph.nodes.length);
		if (slots <= 0) {
			infoBar.notify(tr(`已到上限（${settings.maxNodes} 篇），先删几点再深挖`, `Node limit reached (${settings.maxNodes} papers). Remove a few before the deep dive.`), "error");
			return;
		}
		if (!beginDeepDive(seedId)) {
			infoBar.notify(tr("这张图已有一轮深挖在进行，请稍后重试", "A deep dive is already running for this graph. Try again later."), "success");
			return;
		}
		const token = generation;
		const host = graph;
		expanding = true;
		expandItem.disabled = true;
		infoBar.notify(tr(`正在从「${paper.title.slice(0, 24)}」扩展…`, `Expanding from “${paper.title.slice(0, 24)}”…`), "busy");
		try {
			const oa = new OpenAlexClient(deps.getJson, { apiKey: settings.apiKey, contactEmail: settings.contactEmail });
			const result = await expandAround(oa, host, paper, hiddenIds, settings, slots);
			const { papers, aliases, lists } = result;
			if (disposed || token !== generation || graph !== host) return;
			if (papers.length === 0) {
				const batch: DeepDiveBatch = { id: `${Date.now()}`, parentId: paper.id, createdAt: Date.now(), references: 0, citations: 0, additions: [], noMore: result.noMore, warnings: result.warnings };
				deepDiveBatches = [...deepDiveBatches, batch].slice(-100);
				if (aliases.length) applyEdit(graftNodes(host, aliases, lists), tr(`已补充 ${aliases.length} 条同作品来源记录`, `Added ${aliases.length} source records for existing works`));
				else persistProject(host);
				const reasons = [
					result.alreadyPresent ? tr(`${result.alreadyPresent} 篇已在图中`, `${result.alreadyPresent} already in the graph`) : "",
					result.alreadyExcluded ? tr(`${result.alreadyExcluded} 篇已排除`, `${result.alreadyExcluded} excluded`) : "",
					result.filtered ? tr(`${result.filtered} 篇不符合筛选条件`, `${result.filtered} do not meet the filters`) : "",
					result.overlaps ? tr(`${result.overlaps} 篇同时出现在参考与施引候选中`, `${result.overlaps} appear in both reference and citation candidates`) : "",
				].filter(Boolean);
				infoBar.notify(result.warnings.length ? result.warnings.join(tr("；", "; ")) : result.noMore ? tr("已读完当前可访问候选，没有更多文献", "All accessible candidates have been read; no more papers are available") : tr(`本轮没有新增文献${reasons.length ? `：${reasons.join("；")}` : "；候选页仍可继续读取"}`, `No papers added in this round${reasons.length ? `: ${reasons.join("; ")}` : "; more candidate pages can still be read"}`), "success");
				return;
			}
			const directions = [tr(`参考 ${result.references}`, `References ${result.references}`), tr(`施引 ${result.citations}`, `Citing ${result.citations}`)];
			const previousBatches = deepDiveBatches;
			const batch: DeepDiveBatch = {
				id: `${Date.now()}`,
				parentId: paper.id,
				createdAt: Date.now(),
				references: result.references,
				citations: result.citations,
				additions: papers.map((item) => ({ paperId: item.id, source: item.origin === "reference" ? "reference" : item.origin === "citation" ? "citation" : "shared-reference" })),
				noMore: result.noMore,
				warnings: result.warnings,
			};
			deepDiveBatches = [...deepDiveBatches, batch].slice(-100);
			applyEdit(refreshDerived(graftNodes(host, [...papers, ...aliases], lists)), tr(`已并入 ${papers.length} 篇（${directions.join(" · ")}）${result.noMore ? " · 已到候选末尾" : ""}${result.warnings.length ? ` · ${result.warnings.join("；")}` : ""}`, `Added ${papers.length} papers (${directions.join(" · ")})${result.noMore ? " · end of candidates" : ""}${result.warnings.length ? ` · ${result.warnings.join("; ")}` : ""}`), paper.id);
			if (undoStack.length) undoStack[undoStack.length - 1]!.deepDives = previousBatches;
		} catch (error) {
			if (disposed || token !== generation || graph !== host) return;
			infoBar.notify(error instanceof Error ? error.message : tr("深挖失败。", "Deep dive failed."), "error");
		} finally {
			infoBar.clearProgress();
			endDeepDive(seedId);
			expanding = false;
			expandItem.disabled = false;
		}
	};

	deleteItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) removePaper(paper);
	});
	expandItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) void expandPaper(paper);
	});

	const applyGraph = (next: SimilarityGraph, restoreView?: SavedView, enrich = true, persist = true): void => {
		if (exploreMode !== "citation") { discoveryRevision++; discoveryBusy = false; exploreMode = "citation"; discoveryPayload = null; discoveryGraph = null; citationSession = null; map.setKinds(mapFilter.kinds); syncExploreControls(); }
		next = normalizeWorkGraph(next);
		const seedId = next.nodes.find((node) => node.isSeed)?.id;
		const savedProject = seedId ? deps.getSettings().researchProjects[seedId] : undefined;
		if (savedProject) reconcileProjectIdentity(savedProject, next);
		const persistedExcluded = seedId ? Object.entries(deps.getSettings().researchProjects[seedId]?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id) : [];
		hiddenIds = new Set([...(next.excludedIds ?? []), ...persistedExcluded]);
		for (const id of hiddenIds) {
			if (next.nodes.some((node) => node.id === id && !node.isSeed)) next = omitNode(next, id) ?? next;
		}
		graph = next;
		next.excludedIds = [...hiddenIds];
		diagnoseButton.disabled = false;
		hideNodeMenu();
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		empty.hidden = true;
		hideResults();
		const seed = next.nodes.find((node) => node.isSeed) ?? null;
		saveViewButton.disabled = !seed || !viewNameInput.value.trim();
		showDetail(seed);
		map.setGraph(next.nodes, next.edges, next.seedScore);
		loadStoredText();
		deps.researchLibrary?.()?.prefetch?.(next.nodes);
		graphKey.setStats(next.nodes, next.edges);
		// setGraph 不再重置布局；把轨道按钮当前选中的布局回灌给画布。
		map.setLayout(layoutMode);
		map.setColorMode(defaultColorMode(layoutMode));
		graphKey.paintColor(layoutMode);
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		else chrome?.clearYears();
		scrubYear = restoreView?.scrubYear ?? null;
		if (restoreView) restoreViewState(restoreView);
		paintLists();
		infoBar.clearProgress();
		syncInfoBar();
		if (persist) persistProject(next);
		refreshProjectSelect(seed?.id);
		if (enrich) void enrichOpenCitations(next);
	};

	function restoreViewState(view: SavedView): void {
		if (!graph) return;
		similarityKind = view.similarityKind ?? "text";
		layoutMode = view.layout;
		scrubYear = view.scrubYear;
		chrome?.restoreView(view);
		map.setLayout(layoutMode);
		map.setColorMode(defaultColorMode(layoutMode));
		graphKey.paintColor(layoutMode);
		mapFilter = { ...mapFilter, scrubYear };
		map.setScrubYear(scrubYear);
		refreshSimilarityScores();
		syncExploreControls();
		if (view.filter) {
			mapFilter = { ...view.filter, scrubYear };
			map.setKinds(mapFilter.kinds);
			graphKey.setKinds(mapFilter.kinds);
		}
		map.setViewState({ ...view, selectedId: view.selectedId ? resolveWorkQuery(graph.nodes, view.selectedId) : null });
		surface.distanceScale.value = view.distanceScale ?? "relative";
		map.setDistanceScale(surface.distanceScale.value === "absolute" ? "absolute" : "relative");
		if (view.leftCollapsed !== undefined) {
			body.classList.toggle("is-rail-collapsed", view.leftCollapsed);
			railToggle.textContent = view.leftCollapsed ? "›" : "‹";
			railToggle.setAttribute("aria-expanded", String(!view.leftCollapsed));
			railToggle.setAttribute("aria-label", view.leftCollapsed ? tr("展开左侧栏", "Expand left sidebar") : tr("折叠左侧栏", "Collapse left sidebar"));
		}
		if (view.rightCollapsed !== undefined) {
			body.classList.toggle("is-sidebar-collapsed", view.rightCollapsed);
			sidebarToggle.textContent = view.rightCollapsed ? "‹" : "›";
			sidebarToggle.setAttribute("aria-expanded", String(!view.rightCollapsed));
			sidebarToggle.setAttribute("aria-label", view.rightCollapsed ? tr("展开右侧栏", "Expand right sidebar") : tr("折叠右侧栏", "Collapse right sidebar"));
		}
		map.resize();
		selectedPaper = graph.nodes.find((node) => paperHasId(node, view.selectedId ?? "")) ?? graph.nodes.find((node) => node.isSeed) ?? null;
		if (selectedPaper) showDetail(selectedPaper);
	}

	function restoreNamedView(view: SavedView): void {
		restoreViewState(view);
		scheduleProjectSave();
		infoBar.notify(tr(`已恢复视图「${view.name}」`, `Restored view “${view.name}”`), "success");
	}

	const enrichOpenCitations = async (next: SimilarityGraph): Promise<void> => {
		const token = generation;
		const doiToId = new Map(next.nodes.flatMap((paper) => paperRecords(paper).flatMap((record) => { const doi = doiOf(record.doiUrl); return doi ? [[doi, record.id] as const] : []; })));
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		// Bounded sequential outgoing lookups; no unbounded high-citation responses.
		const papers = next.nodes.flatMap(paperRecords).filter(p => doiOf(p.doiUrl)).slice(0, 20);
		let failed = 0;
		for (const paper of papers) {
			if (disposed || graph !== next || token !== generation) return;
			try {
				const rows = await client.references(doiOf(paper.doiUrl)!);
				if (disposed || graph !== next || token !== generation) return;
				for (const row of rows) {
					const pids = doisFromOpenCitation(row);
					const a = pids.citing.map(d => doiToId.get(d)).find(Boolean);
					const b = pids.cited.map(d => doiToId.get(d)).find(Boolean);
					if (a && b) mergeOpenCitation(next, a, b);
				}
			} catch { failed++; }
		}
		if (disposed || graph !== next || token !== generation) return;
		map.updateGraphData(next.edges);
		graphKey.setStats(next.nodes, next.edges);
		if (selectedEdge) showEdgeDetail(selectedEdge);
		else showDetail(selectedPaper);
		paintLists();
		if (failed) incompleteCitationChecks.add(next);
		else incompleteCitationChecks.delete(next);
		surface.apiStatus.refresh();

		persistProject(next);
	};
	// `fresh` skips stored OpenAlex responses; only Reload asks for it.
	const client = (fresh = false): OpenAlexClient => {
		const settings = deps.getSettings();
		return new OpenAlexClient(deps.getJson, {
			apiKey: settings.apiKey,
			contactEmail: settings.contactEmail,
		}, { fresh });
	};
	const reconcileSource = (): SemanticScholarClient | null => {
		if (!deps.postJson) return null;
		const settings = deps.getSettings();
		if (!settings.s2Reconcile) return null;
		return new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
	};

	function similaritySource(paper: PaperNode): SimilarityGraph {
		return { nodes: [{ ...paper, isSeed: true }], catalog: [], edges: [], referenceLists: new Map(), seedScore: new Map([[paper.id, 1]]),
			warnings: [], skippedNonResearch: 0, strategies: { references: false, citations: false, related: false } };
	}
	function showSimilaritySource(pool: SimilarityGraph): void {
		similarityBase = pool; storedText = []; storedTextRevision++; storedTextGraph = null;
		const seed = pool.nodes.find(paper => paper.isSeed);
		if (!seed) return;
		input.value = normalizeDoi(seed.doiUrl) || seed.openAlexUrl || seed.title; queryEdited = false;
		map.setGraph(pool.nodes, pool.edges, pool.seedScore); map.setLayout(layoutMode); map.setScrubYear(null);
		scrubYear = null; chrome?.clearYears();
		refreshSimilarityScores();
		const result = similarityExplorer.result;
		if (result) {
			const years = result.graph.nodes.flatMap(paper => paper.year === null ? [] : [paper.year]);
			if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		}
		empty.hidden = Boolean(result?.shown); emptyTitle.hidden = false;
		emptyTitle.textContent = tr("查找相似论文", "Find similar papers");
		messageText.textContent = tr("选择搜索范围，或尝试其他来源论文。", "Choose a search scope or try another source paper.");
		showDetail(result?.graph.nodes.find(paper => !paper.isSeed) ?? seed);
	}
	async function loadLocalSimilaritySource(path: string): Promise<void> {
		const token = ++generation; setBusy(true); clearError();
		infoBar.notify(tr("正在读取来源论文…", "Loading source paper…"), "busy");
		try {
			const rows = await deps.researchLibrary?.()?.textLibrary?.();
			if (disposed || token !== generation || exploreMode !== "similar") return;
			const row = rows?.find(row => row.note === path);
			if (!row) throw new Error(tr("未找到文库论文。", "Library paper not found."));
			const pool = similaritySource(row.paper);
			if (row.vector) pool.textVectors = new Map([[row.paper.id, row.vector]]);
			showSimilaritySource(pool);
		} catch (error) { if (!disposed && token === generation) infoBar.notify(String(error), "error"); }
		finally { if (!disposed && token === generation) setBusy(false); }
	}
	async function resolveSimilaritySource(target: { kind: "doi" | "openalex"; value: string }): Promise<void> {
		const token = ++generation; setBusy(true); clearError(); hideResults();
		infoBar.notify(STAGE_TEXT.resolving, "busy");
		try {
			const raw = target.kind === "doi" ? await client().workByDoi(target.value) : await client().workById(target.value);
			if (disposed || token !== generation || exploreMode !== "similar") return;
			const paper = toPaper(raw, "seed");
			if (!paper) throw new Error(tr("来源论文元数据不完整。", "Source paper metadata is incomplete."));
			showSimilaritySource(similaritySource(paper));
		} catch (error) { if (!disposed && token === generation) infoBar.notify(String(error), "error"); }
		finally { if (!disposed && token === generation) setBusy(false); }
	}

	const buildResolved = async (target: { kind: "doi" | "openalex"; value: string }, refresh = false, fresh = false): Promise<void> => {
		if (exploreMode === "similar") { await resolveSimilaritySource(target); return; }
		if (exploreMode !== "citation") setExploreMode("citation");
		flushProjectSave();
		if (!refresh) {
			const matches = matchingSeedProjects(deps.getSettings().researchProjects, target);
			if (matches.length > 1 && !(target.kind === "openalex" && deps.getSettings().researchProjects[shortId(target.value)])) {
				infoBar.notify(tr(`这篇作品有 ${matches.length} 个独立研究项目，请从项目列表选择：${matches.map((project) => project.name).join("、")}`, `This work has ${matches.length} independent research projects. Choose from the project list: ${matches.map((project) => project.name).join(", ")}`), "error");
				projectSelect.focus(); return;
			}
			const project = savedProjectForSeed(deps.getSettings().researchProjects, target);
			const snapshot = project && restoreGraphSnapshot(project.snapshot);
			if (snapshot) {
				linkGraphToQuestion(project, activeQuestion);
				void Promise.resolve(deps.saveProject?.(project)).catch(error => { infoBar.notify(String(error), "error"); });
				clearError();
				hideResults();
				if (currentSeedId() !== project.seedId) {
					clearUndo();
					generation++;
					deepDiveBatches = project.deepDives ?? [];
					applyGraph(snapshot, project.currentView, false, false);
				}
				setBusy(false);
				return;
			}
		}
		clearUndo();
		const token = ++generation;
		setBusy(true);
		clearError();
		hideResults();
		empty.hidden = true;
		emptyTitle.hidden = true;
		infoBar.notify(STAGE_TEXT.resolving, "busy");
		try {
			const settings = deps.getSettings();
			const oa = client(fresh);
			const next = await loadNeighborhood(
				oa,
				target,
				settings,
				(stage) => {
					if (token !== generation) return;
					infoBar.notify(STAGE_TEXT[stage], "busy");
				},
				reconcileSource(),
				new CrossrefClient(deps.getJson, settings.contactEmail),
			);
			if (disposed || token !== generation) return;
			const seed = next.nodes.find((node) => node.isSeed);
			queryEdited = false;
			const project = seed ? settings.researchProjects[seed.id] : undefined;
			deepDiveBatches = project?.deepDives ?? [];
			const excludedIds = Object.entries(project?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
			next.excludedIds = [...new Set([...(next.excludedIds ?? []), ...excludedIds])];
			const excluded = new Set(excludedIds);
			const origins = new Map((project?.deepDives ?? []).flatMap((batch) => batch.additions.map((item) => [item.paperId, item.source === "reference" || item.source === "citation" ? item.source : "related"] as const)));
			const extras = [...origins.keys()].filter((id) => !excluded.has(id));
			applyGraph(next, undefined, extras.length === 0, extras.length === 0);
			if (extras.length === 0) return;
			const displayed = graph!;
			infoBar.notify(tr("正在恢复深挖并入的文献…", "Restoring papers added through deep dives…"), "busy");
			const restored = await restoreGraftedMembers(oa, displayed, extras, settings, excluded, origins);
			if (disposed || token !== generation || graph !== displayed) return;
			if (restored.failed && project?.snapshot) {
				const previous = restoreGraphSnapshot(project.snapshot);
				if (previous) {
					applyGraph(previous, project.currentView, false, false);
					infoBar.notify(tr(`更新未完成：${restored.failed} 篇深挖论文读取失败，已保留上次保存的图谱`, `Update incomplete: ${restored.failed} deep-dive papers could not be loaded; previous graph retained`), "error");
					return;
				}
			}
			if (restored.added > 0 || restored.graph !== displayed) {
				applyGraph(restored.graph, undefined, !restored.failed);
				infoBar.notify(tr(`已恢复 ${restored.added} 篇深挖文献${restored.displaced ? `，为深挖内容腾出 ${restored.displaced} 个名额` : ""}`, `Restored ${restored.added} deep-dive papers${restored.displaced ? `; freed ${restored.displaced} slots for deep-dive papers` : ""}`), "success");
			} else {
				persistProject(displayed);
				if (!restored.failed) void enrichOpenCitations(displayed);
			}
			if (restored.failed) infoBar.notify(tr(`已恢复 ${restored.added} 篇深挖文献；另有 ${restored.failed} 篇读取失败，可稍后重试`, `Restored ${restored.added} deep-dive papers; ${restored.failed} could not be loaded and can be retried later`), "error");
			else if (restored.omitted) infoBar.notify(tr(`已恢复 ${restored.added} 篇深挖文献；${restored.omitted} 篇超过节点上限，未能放入`, `Restored ${restored.added} deep-dive papers; ${restored.omitted} exceeded the node limit`), "error");
		} catch (error) {
			if (token !== generation) return;
			showError(error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph."));
			if (graph) empty.hidden = true;
			else {
				empty.hidden = false;
				messageText.textContent = error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph.");
			}
			infoBar.notify(error instanceof Error ? error.message : tr("图谱还没有建起来。", "The graph has not been built yet."), "error");
		} finally {
			if (token === generation) setBusy(false);
		}
	};

	seedItem.addEventListener("click", () => {
		const paper = (scopedActive ? similarityExplorer.result?.graph : graph)?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper && scopedActive) {
			hideNodeMenu();
			similarityExplorer.setCenter(paper);
			return;
		}
		if (!paper || paper.isSeed) return;
		hideNodeMenu();
		input.value = paper.id;
		void buildResolved({ kind: "openalex", value: paper.id });
	});

	const showHits = (hits: SearchHit[]): void => {
		results.replaceChildren();
		if (hits.length === 0) {
			results.hidden = true;
			showError(tr("没有匹配的作品。换一个标题，或直接粘贴 DOI。", "No matching works. Try another title or paste a DOI."));
			return;
		}
		clearError();
		el(results, "p", "cpo-results-label", tr("选择种子论文", "Select a seed paper"));
		for (const hit of hits) {
			const button = el(results, "button", "cpo-hit");
			button.type = "button";
			el(button, "span", "cpo-hit-title", hit.title);
			const year = hit.year === null ? tr("年份不详", "Year unknown") : String(hit.year);
			el(button, "span", "cpo-hit-meta", tr(`${year} · ${hit.authors} · 被引 ${formatCount(hit.citedByCount)}`, `${year} · ${hit.authors} · cited ${formatCount(hit.citedByCount)} times`));
			button.addEventListener("click", () => {
				input.value = hit.title;
				void buildResolved({ kind: "openalex", value: hit.id });
			});
		}
		results.hidden = false;
	};

	const submitQuery = async (): Promise<void> => {
		if (exploreMode === "similar") {
			const path = sourcePaperPaths.get(input.value.trim());
			if (path || [...sourcePaperPaths.values()].includes(input.value.trim())) {
				await loadLocalSimilaritySource(path ?? input.value.trim()); return;
			}
		}
		const parsed = classifyQuery(input.value);
		if (!parsed) {
			showError(tr("请输入 DOI、OpenAlex ID，或至少两个字的标题。", "Enter a DOI, OpenAlex ID, or a title of at least two characters."));
			return;
		}
		if (parsed.kind === "search") {
			const token = ++generation;
			setBusy(true);
			clearError();
			infoBar.notify(STAGE_TEXT.searching, "busy");
			try {
				const raw = await client().searchWorks(parsed.value);
				if (token !== generation) return;
				const hits: SearchHit[] = [];
				for (const work of raw) {
					const hit = toSearchHit(work);
					if (hit) hits.push(hit);
				}
				showHits(hits);
				infoBar.notify(hits.length ? tr(`找到 ${hits.length} 篇，点选种子论文。`, `Found ${hits.length} papers. Select a seed.`) : tr("没有匹配的作品。", "No matching works."), "success");
			} catch (error) {
				if (token !== generation) return;
				showError(error instanceof Error ? error.message : tr("搜索失败。", "Search failed."));
			} finally {
				if (token === generation) setBusy(false);
			}
			return;
		}
		await buildResolved(parsed);
	};

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (composing) return;
		if (exploreMode === "similar" && similarityExplorer.result && !queryEdited) {
			similarityExplorer.refresh();
			return;
		}
		void submitQuery();
	});
	input.addEventListener("input", () => { queryEdited = true; syncSubmitAction(); });
	input.addEventListener("compositionstart", () => {
		composing = true;
	});
	input.addEventListener("compositionend", () => {
		composing = false;
	});
	zoomIn.addEventListener("click", () => map.zoomBy(1.2));
	zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
	fit.addEventListener("click", () => map.fit(true));
	reload.addEventListener("click", () => {
		const seedId = currentSeedId();
		if (!seedId || reload.disabled) return;
		input.value = seedId;
		void buildResolved({ kind: "openalex", value: seedId }, true, true);
	});
	surface.diversifyResults.addEventListener("change", () => {
		const settings = deps.getSettings();
		const previous = settings.diversifyResults !== false;
		settings.diversifyResults = surface.diversifyResults.checked;
		surface.diversifyResults.disabled = true;
		void (async () => {
			try {
				await deps.persistSettings?.();
				if (disposed) return;
				const seedId = currentSeedId();
				if (seedId && exploreMode === "citation") await buildResolved({ kind: "openalex", value: seedId }, true);
			} catch (error) {
				settings.diversifyResults = previous;
				if (!disposed) showError(tr("图谱选项保存失败：", "Could not save graph options: ") + String(error));
			} finally { if (!disposed) syncExploreControls(); }
		})();
	});
	surface.distanceScale.addEventListener("change", () => {
		map.setDistanceScale(surface.distanceScale.value === "absolute" ? "absolute" : "relative");
		scheduleProjectSave();
	});

	const onKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			if (!nodeMenu.hidden) { hideNodeMenu(); return; }
			showDetail(null);
		}
	};
	root.addEventListener("keydown", onKey);
	const onPointerDown = (event: PointerEvent): void => {
		if (!nodeMenu.hidden && !nodeMenu.contains(event.target as Node)) hideNodeMenu();
	};
	window.addEventListener("pointerdown", onPointerDown);
	const onSettings = (): void => {
		settingsRevision++;
		chrome?.setResearchVisible(llmReady());
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		if (!llmReady() && tab === "research") {
			tab = "graph";
			chrome?.setTab("graph");
			listPanel.replaceChildren();
			listPanel.hidden = true;
		}
		paintLists();
	};
	window.addEventListener("research-connected-settings", onSettings);
	let observedStates: ResearchProject["paperStates"] | undefined;
	let observedSeedId: string | undefined;
	const onProject = (): void => {
		if (!graph) return;
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		const project = seedId ? deps.getSettings().researchProjects[seedId] : undefined;
		if (project?.deepDives && project.deepDives !== deepDiveBatches) {
			deepDiveBatches = project.deepDives;
			const saved = restoreGraphSnapshot(project.snapshot);
			if (saved) {
				applyGraph(saved, project.currentView, false, false);
				return;
			}
		}
		const states = project?.paperStates;
		if (seedId === observedSeedId && states === observedStates) return;
		observedSeedId = seedId;
		observedStates = states;
		const excluded = Object.entries(states ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
		const toRemove = excluded.filter((id) => graph?.nodes.some((node) => node.id === id && !node.isSeed));
		if (toRemove.length) {
			let next = graph;
			for (const id of toRemove) next = omitNode(next, id) ?? next;
			next.excludedIds = [...new Set([...hiddenIds, ...excluded])];
			applyGraph(refreshDerived(next), undefined, false, false);
		} else if (!readingChangesPending(deps.getSettings().researchProjects)) {
			paintLists();
			if (selectedPaper) showDetail(selectedPaper);
		}
	};
	window.addEventListener("research-connected-project", onProject);
	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);

	const observer = observeResponsiveMode(root, () => map.resize());
	observer.observe(stage);
	window.requestAnimationFrame(() => map.resize());

	const initial = deps.initialTarget ?? (deps.initialDoi ? { kind: "doi" as const, value: deps.initialDoi } : null);
	const saved = initial ? null : graphsForQuestion(deps.getSettings().researchProjects, activeQuestion)[0] ?? (!activeQuestion && !deps.researchLibrary?.()?.discovery ? deps.loadSavedProject?.() ?? null : null);
	const restored = saved ? restoreGraphSnapshot(saved.snapshot) : null;
	if (restored) {
		deepDiveBatches = saved?.deepDives ?? [];
		applyGraph(restored, saved?.currentView, false);
		setBusy(false);
	} else if (initial) {
		input.value = initial.value;
		void buildResolved(initial);
	}
	refreshProjectSelect();
	syncExploreControls();

	let pathResult: CitationPathResult | null = null;
	let pathIndex = 0;

	const paperById = (id: string): PaperNode | undefined =>
		graph?.nodes.find((paper) => paper.id === id) ?? graph?.catalog.find((paper) => paper.id === id);

	const paintDoiPath = (): void => {
		if (!pathResult) return;
		selectedPaper = null;
		selectedEdge = null;
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		const path = pathResult.paths[pathIndex];
		sheet.setSummary(tr("DOI 引用路径", "DOI citation path"), path ? tr(`${path.length - 1} 步 · 预算内`, `${path.length - 1} steps · within budget`) : tr("未找到", "Not found"));
		el(detail, "p", "cpo-fact-note", tr("预算内在已抓取引用列表上搜索的结果，不是全局最短路径。", "This result searches fetched reference lists within the request budget; it is not a global shortest path."));
		el(
			detail,
			"p",
			"cpo-meta",
			tr(`方向：${pathResult.direction === "citing-to-cited" ? "施引 → 被引" : "被引 → 施引"} · 检查 ${pathResult.checked}/${pathResult.budget} 个节点${pathResult.exhausted ? " · 预算提前耗尽" : ""}`, `Direction: ${pathResult.direction === "citing-to-cited" ? "citing → cited" : "cited → citing"} · checked ${pathResult.checked}/${pathResult.budget} nodes${pathResult.exhausted ? " · budget exhausted early" : ""}`),
		);
		if (!path) {
			el(detail, "p", "cpo-agg-empty", tr("当前采样范围内没有连通路径。可加深采样后再试。", "No path was found in the current sample. Try a deeper sample."));
			return;
		}
		if (pathResult.paths.length > 1) {
			const nav = el(detail, "div", "cpo-tool-row");
			const label = el(nav, "span", "cpo-meta", tr(`同长路径 ${pathIndex + 1}/${pathResult.paths.length}`, `Equal-length path ${pathIndex + 1}/${pathResult.paths.length}`));
			const prev = el(nav, "button", "cpo-text-btn", tr("上一条", "Previous"));
			prev.type = "button";
			prev.disabled = pathIndex <= 0;
			prev.onclick = () => { pathIndex -= 1; paintDoiPath(); };
			const next = el(nav, "button", "cpo-text-btn", tr("下一条", "Next"));
			next.type = "button";
			next.disabled = pathIndex >= pathResult.paths.length - 1;
			next.onclick = () => { pathIndex += 1; paintDoiPath(); };
			void label;
		}
		const list = el(detail, "ol", "cpo-agg-list");
		for (let i = 0; i < path.length; i++) {
			const id = path[i]!;
			const paper = paperById(id);
			const row = el(list, "li", "cpo-agg-item");
			el(row, "strong", undefined, paper?.title || id);
			const doi = normalizeDoi(paper?.doiUrl) ?? tr("无 DOI", "No DOI");
			el(row, "p", "cpo-meta", `${id} · ${doi}${i < path.length - 1 ? " →" : ""}`);
			if (paper && graph?.nodes.some((node) => node.id === paper.id)) {
				const open = el(row, "button", "cpo-text-btn", tr("查看", "View"));
				open.type = "button";
				open.onclick = () => { activateGraphTab(); showDetail(paper); };
			}
		}
	};

	const openDoiPathSearch = (): void => {
		if (!graph) {
			showError(tr("请先构建图谱。DOI 路径只在已抓取的引用列表上搜索。", "Build a graph first. DOI path search uses fetched reference lists only."));
			return;
		}
		activateGraphTab();
		if (body.classList.contains("is-sidebar-collapsed")) sidebarToggle.click();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("DOI 引用路径", "DOI citation path"), "");
		const form = el(detail, "form", "cpo-path-search");
		const label = el(form, "label", "cpo-meta", tr("起点与终点（DOI 或 OpenAlex ID，用空格或 → 分隔）", "Start and end (DOI or OpenAlex ID, separated by a space or →)"));
		const endpoints = el(label, "input");
		endpoints.type = "text";
		endpoints.required = true;
		endpoints.placeholder = "10.1/a → 10.2/b";
		const submitPath = el(form, "button", "cpo-text-btn", tr("查找路径", "Find path"));
		submitPath.type = "submit";
		endpoints.focus();
		form.onsubmit = (event) => {
			event.preventDefault();
			if (!graph) return;
			const raw = endpoints.value;
			const parts = raw.split(/\s*(?:→|->|\s)\s*/).map((part) => part.trim()).filter(Boolean);
			if (parts.length < 2) {
				showError(tr("请提供两个端点，例如：10.1/a → 10.2/b", "Provide two endpoints, for example: 10.1/a → 10.2/b"));
				return;
			}
			const pool = [...graph.nodes, ...graph.catalog];
			const start = resolvePathEndpoint(parts[0]!, pool, normalizeDoi, shortId);
			const end = resolvePathEndpoint(parts[1]!, pool, normalizeDoi, shortId);
			if (!start || !end) {
				showError(tr("端点必须是当前图谱已抓取的论文（DOI 或 OpenAlex ID）。", "Both endpoints must be papers fetched for the current graph (DOI or OpenAlex ID)."));
				return;
			}
			clearError();
			pathResult = findBudgetedCitationPath(graph.referenceLists, start, end, DEFAULT_PATH_BUDGET);
			pathIndex = 0;
			infoBar.notify(pathResult.paths.length
				? tr(`预算内找到 ${pathResult.paths.length} 条路径（检查 ${pathResult.checked}/${pathResult.budget}）`, `Found ${pathResult.paths.length} paths within budget (${pathResult.checked}/${pathResult.budget} checked)`)
				: tr(`预算内未找到路径（检查 ${pathResult.checked}/${pathResult.budget}${pathResult.exhausted ? "，提前耗尽" : ""}）`, `No path found within budget (${pathResult.checked}/${pathResult.budget} checked${pathResult.exhausted ? "; exhausted early" : ""})`), "success");
			paintDoiPath();
		};
	};

	return {
		openDoiPathSearch,
		openDiscovery: (options = {}) => {
			const question = questionPath(options.question);
			if (question && question !== activeQuestion) {
				if (!Array.from(questionSelect.options).some(option => option.value === question)) questionSelect.append(createEl("option", { value: question, text: question.split("/").pop() }));
				questionSelect.value = question; questionSelect.dispatchEvent(new Event("change"));
			}
			const source = options.paper;
			const sourceLabel = source ? sourcePaperLabels.get(source) ?? source : "";
			const mode = source ? "similar" : options.mode ?? "rank";
			setExploreMode(mode, mode === "similar" && Boolean(source));
			if (mode === "similar" && source) { input.value = sourceLabel; void loadLocalSimilaritySource(source); }
			if (mode === "search") pdfQuery.focus();
		},
		destroy: () => {
			projectSave.dispose();
			releaseLibraryMenu?.(); releaseLibraryMenu = undefined;
			disposed = true;
			discoveryRevision++;
			generation += 1;
			canvas.removeEventListener("pointerup", saveCurrentViewOnGesture);
			canvas.removeEventListener("wheel", saveCurrentViewOnGesture);
			canvas.removeEventListener("keyup", saveCurrentViewOnGesture);
			similarityExplorer.destroy();
			infoBar.destroy();
			chrome?.destroy();
			sheet.destroy();
			stopSidebarResize();
			observer.disconnect();
			undoDoc.removeEventListener("keydown", onUndoKey);
			undoDoc.removeEventListener("pointerdown", onUndoPointer, true);
			root.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("research-connected-settings", onSettings);
			window.removeEventListener("research-connected-project", onProject);
			window.removeEventListener("research-connected-theme", onTheme);
			window.removeEventListener("research-connected-library-changed", onLibraryChanged);
			map.destroy();
			if (statusIsExternal) status.remove();
			root.replaceChildren();
			root.classList.remove("cpo-root", "is-narrow");
		},
	};
}

function addLink(parent: HTMLElement, label: string, onClick: () => void): void {
	const button = el(parent, "button", "cpo-link", label);
	button.type = "button";
	button.addEventListener("click", onClick);
}

function doiOf(value: string | null | undefined): string | null {
	if (!value) return null;
	const raw = value.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "").trim().toLowerCase();
	return raw || null;
}

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = createEl(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
