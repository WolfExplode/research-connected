import { paperHasId, paperRecords, resolveWorkQuery } from "./work-identity";
import { isChinese, tr } from "./i18n";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, registerPopover, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { edgeSourcesText, ORIGIN_TEXT, paintAbstractCard, paintAggregateCard, paintJumpStrip, paintIdentitySources, paintLiteratureLink, paintMetadataCard, paintMeter, paintPaperWorkflowState, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { paintPaperActions } from "./paper-actions";
import { paintLibraryAvailability, type LibraryBridge } from "./library-bridge";
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
import { mountGraphSurface, placeNodeMenu } from "./graph-surface";
import {
	diagnoseCandidate,
	beginDeepDive,
	endDeepDive,
	expandAround,
	loadNeighborhood,
	restoreGraftedMembers,
	type LoadWarning,
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
import { classifyQuery, normalizeDoi, shortId, toSearchHit } from "./paper";
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
	/** Command-palette DOI path search over already-fetched reference lists. */
	openDoiPathSearch(): void;
}

export interface AppDeps {
	libraryBridge?: () => LibraryBridge | null;
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<unknown>;
	openExternal: (url: string) => void;
	createNote?: (filename: string, markdown: string, folder?: string) => Promise<string | void>;
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; reading: ReadingStatus | null; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	syncLiteratureReading?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
	rememberLiteratureNote?: (paper: PaperNode, path: string, reading: ReadingStatus) => void;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	/** Persist settings (grafted members, staging, …). */
	persistSettings?: () => Promise<void> | void;
	loadSavedProject?: () => ResearchProject | null;
	saveProject?: (project: ResearchProject) => Promise<void> | void;
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

const WARNING_TEXT: Record<LoadWarning, string> = {
	references: tr("参考文献没有读到", "References could not be loaded"),
	citations: tr("施引文献没有读到", "Citing papers could not be loaded"),
	related: tr("相关作品没有读到", "Related works could not be loaded"),
	details: tr("部分参考文献列表没有读到，相似度只基于拿到的数据", "Some reference lists could not be loaded; similarity uses available data only"),
	crosscheck: tr("Semantic Scholar 交叉比对没有完成（额度或网络），图谱仍基于 OpenAlex", "Semantic Scholar cross-check did not finish (rate limit or network); the graph still uses OpenAlex"),
};

/** Pane UI shared by the Obsidian view and the browser preview. */
export function mountGraphApp(root: HTMLElement, deps: AppDeps): GraphAppHandle {
	root.classList.add("cpo-root");
	root.lang = isChinese() ? "zh-CN" : "en";
	root.replaceChildren();

	const bar = el(root, "header", "cpo-bar");
	const topLine = el(bar, "div", "cpo-topline");
	const brand = el(topLine, "div", "cpo-brand");
	el(brand, "span", "cpo-brand-mark", "R");
	el(brand, "strong", undefined, "Research Connected");
	const form = el(topLine, "form", "cpo-form");
	const input = el(form, "input", "cpo-input");
	input.type = "text";
	input.placeholder = tr("DOI、OpenAlex ID 或论文标题", "DOI, OpenAlex ID, or paper title");
	input.autocomplete = "off";
	input.spellcheck = false;
	input.setAttribute("aria-label", tr("种子论文", "Seed paper"));
	const submit = el(form, "button", "cpo-primary", tr("构建", "Build"));
	submit.type = "submit";
	const projectTools = el(bar, "div", "cpo-project-tools");
	const projectGroup = el(projectTools, "div", "cpo-project-group");
	const projectLabel = el(projectGroup, "span", "cpo-project-label", tr("项目", "Project"));
	projectLabel.prepend(createChromeIcon("project"));
	const projectSelect = el(projectGroup, "select", "cpo-project-select");
	projectSelect.setAttribute("aria-label", tr("研究项目", "Research project"));
	projectSelect.title = tr("切换研究项目", "Switch research project");
	const viewGroup = el(projectTools, "div", "cpo-project-group cpo-view-group");
	const viewLabel = el(viewGroup, "span", "cpo-project-label", tr("视图", "View"));
	viewLabel.prepend(createChromeIcon("views"));
	const viewSelect = el(viewGroup, "select", "cpo-project-select cpo-view-select");
	viewSelect.setAttribute("aria-label", tr("保存的视图", "Saved views"));
	viewSelect.title = tr("恢复保存的视图", "Restore saved view");
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
	const libraryButton = el(projectGroup, "button", "cpo-ghost cpo-library-open");
	libraryButton.type = "button";
	libraryButton.append(createChromeIcon("bookmark"), document.createTextNode(tr("清单", "Library")));
	libraryButton.title = tr("暂存与排除", "Saved and excluded papers");
	projectTools.append(projectGroup, viewGroup);

	const status = createEl("p");
	status.className = "cpo-status";
	status.textContent = tr("从一篇种子论文开始。", "Start with a seed paper.");
	status.setAttribute("role", "status");
	const seedSummary = el(root, "div", "cpo-seed-summary");
	seedSummary.hidden = true;
	el(seedSummary, "span", "cpo-seed-mark", "");
	const seedTitle = el(seedSummary, "strong", "cpo-seed-title");
	const seedMeta = el(seedSummary, "span", "cpo-seed-meta");
	topLine.append(seedSummary);
	const results = el(bar, "div", "cpo-results");
	results.hidden = true;

	const banner = el(root, "div", "cpo-banner");
	banner.hidden = true;
	banner.setAttribute("role", "alert");

	const body = el(root, "div", "cpo-body");
	body.classList.add("is-rail-collapsed");
	const statusBar = el(root, "footer", "cpo-statusbar");
	statusBar.append(status);
	const undoButton = el(statusBar, "button", "cpo-text-btn cpo-undo", tr("撤销", "Undo"));
	undoButton.type = "button";
	undoButton.hidden = true;
	undoButton.disabled = true;
	const rail = el(body, "aside", "cpo-rail");
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
	map.libraryStatus = paper => deps.libraryBridge?.()?.read(paper) ?? null;
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, { onResize: () => map.resize() });
	let mapFilter: GraphFilter = emptyFilter();
	map.setKinds(mapFilter.kinds);
	const graphKey = mountGraphKey(rail, () => mapFilter, (next) => {
		mapFilter = next;
		map.setKinds(next.kinds);
	});
	graphKey.paintColor("force2d");
	let graph: SimilarityGraph | null = null;
	let undoCheckpoint: { snapshot: ReturnType<typeof saveGraphSnapshot>; view: SavedView; hidden: Set<string>; deepDives: DeepDiveBatch[]; paperStates: Record<string, ProjectPaperState> } | null = null;
	let deepDiveBatches: DeepDiveBatch[] = [];
	let expanding = false;
	let projectSaveTimer: number | null = null;
	let persistProjectNow: (current: SimilarityGraph) => void = () => {};
	const scheduleProjectSave = (): void => {
		if (projectSaveTimer !== null) window.clearTimeout(projectSaveTimer);
		projectSaveTimer = window.setTimeout(() => {
			projectSaveTimer = null;
			if (graph) persistProjectNow(graph);
		}, 500);
	};
	let tab: GraphTab = "graph";
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
		input.disabled = busy;
		submit.disabled = busy;
		reload.disabled = busy || !graph;
		submit.textContent = busy ? tr("正在构建…", "Building…") : tr("构建", "Build");
	};

	const shownNodes = (): PaperNode[] => {
		if (!graph) return [];
		return graph.nodes.filter((node) => node.isSeed || scrubYear === null || (node.year !== null && node.year <= scrubYear));
	};

	const tabTitles: Record<GraphTab, string> = {
		graph: tr("论文详情与关联依据", "Paper details & evidence"),
		prior: tr("先验工作", "Prior works"),
		derivative: tr("衍生工作", "Derivative works"),
		research: tr("研究脉络", "Research narrative"),
		staged: tr("暂存列表", "Saved papers"),
		excluded: tr("已排除论文", "Excluded papers"),
	};

	const paintLists = (): void => {
		evidenceHeading.textContent = tabTitles[tab] ?? tabTitles.graph;
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
				paintPaperWorkflowState(card, paper, state, async (reading, previous) => {
					updateProjectPaperState(settings.researchProjects, seed.id, paper, { reading });
					try {
						await deps.stagePaper?.(paper, seed.id, state.source);
						await deps.syncLiteratureReading?.(paper, reading);
					}
					catch (error) {
						updateProjectPaperState(settings.researchProjects, seed.id, paper, { reading: previous });
						throw error;
					}
				}, () => {
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
		for (const [next, label] of [["staged", tr("暂存", "Saved")], ["excluded", tr("排除", "Excluded")]] as const) {
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
			tr(`被引 ${formatCount(paper.citedByCount)}`, `Cited ${formatCount(paper.citedByCount)}`),
		].filter(Boolean);
		el(card, "p", "cpo-library-meta", metaParts.join(" · "));
		const actionRow = el(card, "div", "cpo-library-actions");
		actions(actionRow);
	};

	const paintStaged = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		paintLibrarySwitch(listPanel);
		const libraryHeader = el(listPanel, "div", "cpo-library-header");
		const libraryHeading = el(libraryHeader, "div", "cpo-library-heading");
		el(libraryHeading, "h3", "cpo-kicker", tr("暂存列表", "Saved papers"));
		const projects = deps.getSettings().researchProjects ?? {};
		const items = projectStagedPapers(projects);
		el(libraryHeading, "span", "cpo-library-count", tr(`${items.length} 篇`, `${items.length} papers`));
		if (items.length === 0) { el(listPanel, "p", "cpo-agg-empty", tr("还没有暂存论文。", "No saved papers yet.")); return; }
		const actionMenu = el(libraryHeader, "details", "cpo-library-menu");
		const actionTrigger = el(actionMenu, "summary", "cpo-ghost cpo-library-menu-trigger");
		actionTrigger.setAttribute("aria-label", tr("清单操作", "List actions"));
		actionTrigger.append(createChromeIcon("export"), document.createTextNode(tr("清单操作", "List actions")), createChromeIcon("chevronDown"));
		registerPopover(actionMenu);
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
				const lines = [tr("# 暂存文献清单", "# Saved papers"), ""];
				for (const group of groupStagedBySeed(items)) {
					lines.push(tr(`## 种子 ${group.seedId}`, `## Seed ${group.seedId}`), "");
					for (const item of group.items) {
						lines.push(tr(`- ${item.paper.title || item.paper.id}（${item.paper.year ?? tr("年份不详", "Year unknown")}）· ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`, `- ${item.paper.title || item.paper.id} (${item.paper.year ?? tr("年份不详", "Year unknown")}) · ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`));
						if (item.paper.doiUrl) lines.push(`  - DOI: ${item.paper.doiUrl}`);
						lines.push(`  - ${item.paper.openAlexUrl}`);
					}
					lines.push("");
				}
				void deps.createNote!(tr("暂存文献清单.md", "Saved papers.md"), lines.join("\n")).then(() => {
					chrome?.setExportText(tr("已写入笔记：暂存文献清单.md", "Written to note: Saved papers.md"));
				}).catch((error) => {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				});
			};
		}
		for (const group of groupStagedBySeed(items)) {
			const seedTitle = graph?.nodes.find((node) => node.id === group.seedId)?.title;
			el(listPanel, "h4", "cpo-kicker cpo-staged-group-title", seedTitle ? tr(`种子 · ${seedTitle}`, `Seed · ${seedTitle}`) : tr(`种子 · ${group.seedId}`, `Seed · ${group.seedId}`));
			const list = el(listPanel, "ol", "cpo-agg-list");
			for (const item of group.items) {
				paintLibraryCard(list, item.paper, displayStageSource(item.source), (actions) => {
					const open = el(actions, "button", "cpo-library-action", tr("查看", "View"));
					open.type = "button";
					open.onclick = () => { if (graph?.nodes.some((node) => node.id === item.paper.id)) { activateGraphTab(); showDetail(item.paper); } };
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
						const project = projects[item.seedId];
						const previous = project?.paperStates?.[item.paper.id];
						updateProjectPaperState(projects, item.seedId, item.paper, { reading: reading.value as "unread" | "to-read" | "read" });
						try {
							await deps.stagePaper?.(item.paper, item.seedId, item.source);
							await deps.syncLiteratureReading?.(item.paper, reading.value as ReadingStatus);
							paintStaged();
						}
						catch { if (previous && project?.paperStates) project.paperStates[item.paper.id] = previous; reading.value = item.reading; status.textContent = tr("阅读状态保存失败，请重试", "Could not save reading status. Try again."); }
					};
					const remove = el(actions, "button", "cpo-library-action is-quiet", tr("移除", "Remove"));
					remove.type = "button";
					remove.onclick = async () => {
						updateProjectPaperState(projects, item.seedId, item.paper, { staged: false });
						try { await deps.stagePaper?.(item.paper, item.seedId, item.source); paintStaged(); }
						catch { updateProjectPaperState(projects, item.seedId, item.paper, { staged: true }); status.textContent = tr("暂存状态保存失败，请重试", "Could not save the saved-paper state. Try again."); }
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
			map.setColorMode(defaultColorMode(mode));
			scheduleProjectSave();
			graphKey.paintColor(mode);
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

	const showDetail = (paper: PaperNode | null): void => {
		selectedPaper = paper;
		selectedEdge = null;
		detail.replaceChildren();
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
		const library = deps.libraryBridge?.();
		if (library) paintLibraryAvailability(detail, paper, library, deps.openExternal);
		const seedNode = graph.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seedNode?.id ?? paper.id;
		const project = deps.getSettings().researchProjects[seedId];
		paintIdentitySources(detail, paper, deps.openExternal, () => {
			if (!graph) return;
			if (graph.nodes.length + (paper.records?.length ?? 1) - 1 > deps.getSettings().maxNodes) { status.textContent = tr("分开记录将超过节点上限，请先移除其他论文", "Splitting these records would exceed the node limit. Remove another paper first."); return; }
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
		if (noted?.reading && noted.reading !== state.reading) {
			state = { ...state, reading: updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: noted.reading }).reading };
			void (deps.persistSettings ? deps.persistSettings() : deps.stagePaper?.(paper, seedId, state.source));
		}
		paintPaperWorkflowState(detail, paper, state, async (reading, previous) => {
			updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading });
			try {
				await (deps.persistSettings ? deps.persistSettings() : deps.stagePaper?.(paper, seedId, state.source));
				await deps.syncLiteratureReading?.(paper, reading);
			} catch (error) {
				updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: previous });
				throw error;
			}
		}, !paper.isSeed ? () => removePaper(paper) : undefined);
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
			getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
			setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
			persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seedNode!.id, source) : undefined,
			openExternal: deps.openExternal,
		});
		paintAbstractCard(detail, paper, abstractText);
		if (seedNode && !paper.isSeed) {
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
					if (score !== undefined) paintMeter(card, tr("图谱综合相似度", "Overall graph similarity"), score, tr("结构 + 语义信号", "Structure and semantic signals"));
					const semantic = graph.semanticScores?.get(paper.id);
					if (semantic !== undefined) paintMeter(card, tr("文本相似度", "Text similarity"), semantic, semanticHintFor(graph.semanticMode), true);
					if (!recorded) el(card, "p", "cpo-fact-note", tr(`与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`, `No direct citation to the seed recorded · ${SIMILARITY_NOT_CITATION}`));
				}
			}
			const rankInfo = graph.selectionRank?.get(paper.id);
			if (rankInfo) paintSelectionReasons(detail, rankInfo, score);
			paintJumpStrip(detail, seedNode, (target) => showDetail(target));
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

	map.onSelect = (paper) => { showDetail(paper); scheduleProjectSave(); };
	const onLibraryChanged = (): void => {
		if (disposed) return;
		if (graph) deps.libraryBridge?.()?.prefetch?.(graph.nodes);
		map.refreshLibraryStatus();
		if (selectedPaper && tab === "graph") showDetail(selectedPaper);
	};
	window.addEventListener("research-connected-library-changed", onLibraryChanged);
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !graph) {
			nodeMenu.hidden = true;
			return;
		}
		deleteItem.disabled = paper.isSeed;
		deleteItem.title = paper.isSeed ? tr("种子不能排除", "The seed paper cannot be excluded") : tr("从当前项目排除", "Exclude from this project");
		seedItem.disabled = paper.isSeed;
		seedItem.title = paper.isSeed ? tr("已是种子", "Already the seed") : tr("以这篇重建整图", "Rebuild graph with this paper as seed");
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
		if (!graph) return;
		const a = graph.nodes.find(p => p.id === edge.source), b = graph.nodes.find(p => p.id === edge.target);
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
		selectedEdge = edge;
		selectedPaper = null;
		showEdgeDetail(edge);
	};
	showDetail(null);

	const hideNodeMenu = (): void => {
		nodeMenu.hidden = true;
		delete nodeMenu.dataset.paperId;
	};

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
		void Promise.resolve(deps.saveProject(project)).catch((error) => {
			status.textContent = error instanceof Error ? tr(`项目保存失败：${error.message}`, `Could not save project: ${error.message}`) : tr("项目保存失败", "Could not save the project");
		});
		refreshProjectSelect(seed.id);
	};
	persistProjectNow = persistProject;
	const saveCurrentViewOnGesture = (): void => scheduleProjectSave();
	canvas.addEventListener("pointerup", saveCurrentViewOnGesture);
	canvas.addEventListener("wheel", saveCurrentViewOnGesture, { passive: true });
	canvas.addEventListener("keyup", saveCurrentViewOnGesture);

	const refreshProjectSelect = (selectedId = currentSeedId()): void => {
		const projects = Object.values(deps.getSettings().researchProjects ?? {}).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt);
		projectSelect.replaceChildren();
		if (projects.length === 0) {
			const option = createEl("option");
			option.textContent = tr("研究项目", "Research project");
			projectSelect.append(option);
			projectSelect.disabled = true;
			renameProjectButton.disabled = true;
			viewSelect.disabled = true;
			viewNameInput.disabled = true;
			return;
		}
		for (const project of projects) {
			const option = createEl("option");
			option.value = project.seedId;
			option.textContent = project.name;
			projectSelect.append(option);
		}
		projectSelect.disabled = false;
		projectSelect.value = projects.some((project) => project.seedId === selectedId) ? selectedId! : projects[0]!.seedId;
		renameProjectButton.disabled = false;
		viewNameInput.disabled = false;
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
		deepDiveBatches = project.deepDives ?? [];
		clearUndo();
		generation += 1;
		applyGraph(snapshot, project.currentView, false);
		setBusy(false);
		refreshProjectSelect(project.seedId);
		status.textContent = tr(`已切换到研究项目「${project.name}」`, `Switched to research project “${project.name}”`);
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
		if (!name) { status.textContent = tr("项目名称不能为空", "Project name cannot be empty"); renameProjectInput.focus(); return; }
		project.name = name.slice(0, 120);
		project.updatedAt = Date.now();
		try {
			await deps.saveProject?.(project);
			renameProjectInput.hidden = true;
			renameProjectText.textContent = tr("重命名", "Rename");
			refreshProjectSelect(project.seedId);
			status.textContent = tr(`项目已重命名为「${project.name}」`, `Project renamed to “${project.name}”`);
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : tr("项目名称保存失败", "Could not save the project name");
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
		if (!name) { status.textContent = tr("先输入视图名称", "Enter a view name first"); viewNameInput.focus(); return; }
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
			status.textContent = tr(`已保存视图「${view.name}」`, `Saved view “${view.name}”`);
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : tr("视图保存失败", "Could not save the view");
		}
	};

	function clearUndo(): void {
		undoCheckpoint = null;
		undoButton.hidden = true;
		undoButton.disabled = true;
	}
	const applyEdit = (next: SimilarityGraph, note: string, nearId?: string, reflow = false): void => {
		if (graph) {
			const seedId = currentSeedId();
			const stateSource = seedId ? deps.getSettings().researchProjects[seedId]?.paperStates ?? {} : {};
			undoCheckpoint = {
				snapshot: JSON.parse(JSON.stringify(saveGraphSnapshot(graph))) as ReturnType<typeof saveGraphSnapshot>,
				view: { name: tr("当前视图", "Current view"), layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: Date.now(), filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter, leftCollapsed: body.classList.contains("is-rail-collapsed"), rightCollapsed: body.classList.contains("is-sidebar-collapsed") },
				hidden: new Set(hiddenIds),
				deepDives: JSON.parse(JSON.stringify(deepDiveBatches)) as DeepDiveBatch[],
				paperStates: JSON.parse(JSON.stringify(stateSource)) as Record<string, ProjectPaperState>,
			};
			undoButton.hidden = false;
			undoButton.disabled = false;
		}
		graph = next;
		map.adoptGraph(next.nodes, next.edges, next.seedScore, nearId, reflow);
		deps.libraryBridge?.()?.prefetch?.(next.nodes);
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
		status.textContent = tr(`${note} · ${next.nodes.length} 篇 · ${next.edges.length} 条关系`, `${note} · ${next.nodes.length} papers · ${next.edges.length} links`);
		persistProject(next);
	};
	const undoEdit = (): void => {
		const checkpoint = undoCheckpoint;
		if (!checkpoint) return;
		const previous = restoreGraphSnapshot(checkpoint.snapshot);
		if (!previous) { clearUndo(); status.textContent = tr("无法恢复上一步图谱", "Could not restore the previous graph state"); return; }
		clearUndo();
		deepDiveBatches = checkpoint.deepDives;
		const seedId = previous.nodes.find((node) => node.isSeed)?.id;
		if (seedId) {
			const project = deps.getSettings().researchProjects[seedId];
			if (project) project.paperStates = checkpoint.paperStates;
		}
		applyGraph(previous, checkpoint.view, false);
		hiddenIds = checkpoint.hidden;
		void deps.persistSettings?.();
		status.textContent = tr("已撤销上一步图谱修改", "Undid the last graph change");
	};
	undoButton.addEventListener("click", undoEdit);
	const onUndoKey = (event: KeyboardEvent): void => {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
		if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
		if (!undoCheckpoint) return;
		event.preventDefault();
		undoEdit();
	};
	root.addEventListener("keydown", onUndoKey);

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
			status.textContent = tr("已到节点上限，请先移除其他论文再恢复", "Node limit reached. Remove another paper before restoring.");
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
			status.textContent = tr(`已到上限（${settings.maxNodes} 篇），先删几点再深挖`, `Node limit reached (${settings.maxNodes} papers). Remove a few before the deep dive.`);
			return;
		}
		if (!beginDeepDive(seedId)) {
			status.textContent = tr("这张图已有一轮深挖在进行，请稍后重试", "A deep dive is already running for this graph. Try again later.");
			return;
		}
		const token = generation;
		const host = graph;
		expanding = true;
		expandItem.disabled = true;
		status.textContent = tr(`正在从「${paper.title.slice(0, 24)}」扩展…`, `Expanding from “${paper.title.slice(0, 24)}”…`);
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
				status.textContent = result.warnings.length ? result.warnings.join(tr("；", "; ")) : result.noMore ? tr("已读完当前可访问候选，没有更多文献", "All accessible candidates have been read; no more papers are available") : tr(`本轮没有新增文献${reasons.length ? `：${reasons.join("；")}` : "；候选页仍可继续读取"}`, `No papers added in this round${reasons.length ? `: ${reasons.join("; ")}` : "; more candidate pages can still be read"}`);
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
			if (undoCheckpoint) undoCheckpoint.deepDives = previousBatches;
		} catch (error) {
			if (disposed || token !== generation || graph !== host) return;
			status.textContent = error instanceof Error ? error.message : tr("深挖失败。", "Deep dive failed.");
		} finally {
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
		if (seed) {
			seedSummary.hidden = false;
			seedTitle.textContent = seed.title || seed.id;
			seedMeta.textContent = [seed.authors, seed.year ?? tr("年份不详", "Year unknown"), tr("种子论文", "Seed paper")].filter(Boolean).join(" · ");
		}
		saveViewButton.disabled = !seed || !viewNameInput.value.trim();
		showDetail(seed);
		map.setGraph(next.nodes, next.edges, next.seedScore);
		deps.libraryBridge?.()?.prefetch?.(next.nodes);
		graphKey.setStats(next.nodes, next.edges);
		graphKey.paintColor(layoutMode);
		// setGraph 不再重置布局；把轨道按钮当前选中的布局回灌给画布。
		map.setLayout(layoutMode);
		map.setColorMode(defaultColorMode(layoutMode));
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		else chrome?.clearYears();
		scrubYear = restoreView?.scrubYear ?? null;
		if (restoreView) {
			layoutMode = restoreView.layout;
			chrome?.setLayout(layoutMode);
			if (!chrome) map.setLayout(layoutMode);
			if (restoreView.filter) {
				mapFilter = { ...restoreView.filter, scrubYear };
				map.setKinds(mapFilter.kinds);
				graphKey.setKinds(mapFilter.kinds);
			}
			map.setScrubYear(scrubYear);
			map.setViewState({ ...restoreView, selectedId: restoreView.selectedId ? resolveWorkQuery(next.nodes, restoreView.selectedId) : null });
			if (restoreView.leftCollapsed !== undefined) {
				body.classList.toggle("is-rail-collapsed", restoreView.leftCollapsed);
				railToggle.textContent = restoreView.leftCollapsed ? "›" : "‹";
				railToggle.setAttribute("aria-expanded", String(!restoreView.leftCollapsed));
				railToggle.setAttribute("aria-label", restoreView.leftCollapsed ? tr("展开左侧栏", "Expand left sidebar") : tr("折叠左侧栏", "Collapse left sidebar"));
			}
			if (restoreView.rightCollapsed !== undefined) {
				body.classList.toggle("is-sidebar-collapsed", restoreView.rightCollapsed);
				sidebarToggle.textContent = restoreView.rightCollapsed ? "‹" : "›";
				sidebarToggle.setAttribute("aria-expanded", String(!restoreView.rightCollapsed));
				sidebarToggle.setAttribute("aria-label", restoreView.rightCollapsed ? tr("展开右侧栏", "Expand right sidebar") : tr("折叠右侧栏", "Collapse right sidebar"));
			}
			selectedPaper = next.nodes.find((node) => paperHasId(node, restoreView.selectedId ?? "")) ?? seed;
			if (selectedPaper) showDetail(selectedPaper);
		}
		paintLists();
		const strategyNames = [
			next.strategies.references ? tr("参考文献", "References") : "",
			next.strategies.citations ? tr("施引", "Citing") : "",
			next.strategies.related ? tr("相关作品", "Related works") : "",
		].filter(Boolean);
		const warning = next.warnings.map((item) => WARNING_TEXT[item]).join(tr("；", "; "));
		const sampleNote = next.retrievalStats
			? ` · ${tr("采样 ", "sampled ")}${[
				samplingText(next.retrievalStats.references, tr("参考", "References")),
				samplingText(next.retrievalStats.citations, tr("施引", "Citing")),
				samplingText(next.retrievalStats.related, tr("相关", "Related")),
			].join(tr("/", " / "))}`
			: "";
		status.textContent = tr(`${next.nodes.length} 篇 · ${next.edges.length} 条关系 · ${strategyNames.join("、")}${
			next.skippedNonResearch ? ` · 滤除书评等非研究记录 ${next.skippedNonResearch} 条` : ""
		}${next.skippedRetracted ? ` · 排除已撤稿作品 ${next.skippedRetracted} 条` : ""}${next.pagingLimited ? " · 深度采样未翻页：没有 OpenAlex API 密钥，只取了第一页" : ""}${sampleNote}${warning ? ` · ${warning}` : ""}`, `${next.nodes.length} papers · ${next.edges.length} links · ${strategyNames.join(", ")}${
			next.skippedNonResearch ? ` · filtered ${next.skippedNonResearch} non-research records` : ""
		}${next.skippedRetracted ? ` · excluded ${next.skippedRetracted} retracted works` : ""}${next.pagingLimited ? " · deep sampling stayed on page 1 because no OpenAlex API key is set" : ""}${sampleNote}${warning ? ` · ${warning}` : ""}`);
		status.title = status.textContent;
		if (persist) persistProject(next);
		refreshProjectSelect(seed?.id);
		if (enrich) void enrichOpenCitations(next);
	};

	function restoreNamedView(view: SavedView): void {
		if (!graph) return;
		layoutMode = view.layout;
		chrome?.setLayout(view.layout);
		if (!chrome) map.setLayout(view.layout);
		scrubYear = view.scrubYear;
		map.setScrubYear(scrubYear);
		if (view.filter) {
			mapFilter = { ...view.filter, scrubYear };
			map.setKinds(mapFilter.kinds);
			graphKey.setKinds(mapFilter.kinds);
		}
		map.setViewState({ ...view, selectedId: view.selectedId ? resolveWorkQuery(graph.nodes, view.selectedId) : null });
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
		selectedPaper = graph.nodes.find((node) => paperHasId(node, view.selectedId ?? "")) ?? graph.nodes.find((node) => node.isSeed) ?? null;
		if (selectedPaper) showDetail(selectedPaper);
		status.textContent = tr(`已恢复视图「${view.name}」`, `Restored view “${view.name}”`);
	}

	const enrichOpenCitations = async (next: SimilarityGraph): Promise<void> => {
		const token = generation;
		const doiToId = new Map(next.nodes.flatMap((paper) => paperRecords(paper).flatMap((record) => { const doi = doiOf(record.doiUrl); return doi ? [[doi, record.id] as const] : []; })));
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		// Bounded sequential outgoing lookups; no unbounded high-citation responses.
		const papers = next.nodes.flatMap(paperRecords).filter(p => doiOf(p.doiUrl)).slice(0, 20);
		let completed = 0, failed = 0;
		for (const paper of papers) {
			if (disposed || graph !== next || token !== generation) return;
			try {
				const rows = await client.references(doiOf(paper.doiUrl)!);
				if (disposed || graph !== next || token !== generation) return;
				completed++;
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
		status.textContent += tr(` · OpenCitations 检查 ${completed}/${papers.length} 篇，失败 ${failed}；当前 ${next.edges.length} 条关系`, ` · OpenCitations checked ${completed}/${papers.length} papers; ${failed} failed; ${next.edges.length} links now`);
		persistProject(next);
	};
	const client = (): OpenAlexClient => {
		const settings = deps.getSettings();
		return new OpenAlexClient(deps.getJson, {
			apiKey: settings.apiKey,
			contactEmail: settings.contactEmail,
		});
	};
	const reconcileSource = (): SemanticScholarClient | null => {
		if (!deps.postJson) return null;
		const settings = deps.getSettings();
		if (!settings.s2Reconcile) return null;
		return new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
	};

	const buildResolved = async (target: { kind: "doi" | "openalex"; value: string }, refresh = false): Promise<void> => {
		if (!refresh) {
			const matches = matchingSeedProjects(deps.getSettings().researchProjects, target);
			if (matches.length > 1 && !(target.kind === "openalex" && deps.getSettings().researchProjects[shortId(target.value)])) {
				status.textContent = tr(`这篇作品有 ${matches.length} 个独立研究项目，请从项目列表选择：${matches.map((project) => project.name).join("、")}`, `This work has ${matches.length} independent research projects. Choose from the project list: ${matches.map((project) => project.name).join(", ")}`);
				projectSelect.focus(); return;
			}
			const project = savedProjectForSeed(deps.getSettings().researchProjects, target);
			const snapshot = project && restoreGraphSnapshot(project.snapshot);
			if (snapshot) {
				clearError();
				hideResults();
				if (currentSeedId() !== project.seedId) {
					clearUndo();
					generation++;
					deepDiveBatches = project.deepDives ?? [];
					applyGraph(snapshot, project.currentView, false, false);
				}
				setBusy(false);
				status.textContent = tr(`已打开研究项目「${project.name}」；需要更新数据请使用重新加载`, `Opened research project “${project.name}”; use Reload to update data`);
				return;
			}
		}
		clearUndo();
		const token = ++generation;
		setBusy(true);
		clearError();
		hideResults();
		empty.hidden = false;
		emptyTitle.hidden = true;
		messageText.textContent = STAGE_TEXT.resolving;
		status.textContent = STAGE_TEXT.resolving;
		try {
			const settings = deps.getSettings();
			const oa = client();
			const next = await loadNeighborhood(
				oa,
				target,
				settings,
				(stage) => {
					if (token !== generation) return;
					messageText.textContent = status.textContent = STAGE_TEXT[stage];
				},
				reconcileSource(),
				new CrossrefClient(deps.getJson, settings.contactEmail),
			);
			if (disposed || token !== generation) return;
			const seed = next.nodes.find((node) => node.isSeed);
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
			status.textContent = tr("正在恢复深挖并入的文献…", "Restoring papers added through deep dives…");
			const restored = await restoreGraftedMembers(oa, displayed, extras, settings, excluded, origins);
			if (disposed || token !== generation || graph !== displayed) return;
			if (restored.failed && project?.snapshot) {
				const previous = restoreGraphSnapshot(project.snapshot);
				if (previous) {
					applyGraph(previous, project.currentView, false, false);
					status.textContent = tr(`更新未完成：${restored.failed} 篇深挖论文读取失败，已保留上次保存的图谱`, `Update incomplete: ${restored.failed} deep-dive papers could not be loaded; previous graph retained`);
					return;
				}
			}
			if (restored.added > 0 || restored.graph !== displayed) {
				applyGraph(restored.graph, undefined, !restored.failed);
				status.textContent = tr(`已恢复 ${restored.added} 篇深挖文献${restored.displaced ? `，为深挖内容腾出 ${restored.displaced} 个名额` : ""}`, `Restored ${restored.added} deep-dive papers${restored.displaced ? `; freed ${restored.displaced} slots for deep-dive papers` : ""}`);
			} else {
				persistProject(displayed);
				if (!restored.failed) void enrichOpenCitations(displayed);
			}
			if (restored.failed) status.textContent = tr(`已恢复 ${restored.added} 篇深挖文献；另有 ${restored.failed} 篇读取失败，可稍后重试`, `Restored ${restored.added} deep-dive papers; ${restored.failed} could not be loaded and can be retried later`);
			else if (restored.omitted) status.textContent = tr(`已恢复 ${restored.added} 篇深挖文献；${restored.omitted} 篇超过节点上限，未能放入`, `Restored ${restored.added} deep-dive papers; ${restored.omitted} exceeded the node limit`);
		} catch (error) {
			if (token !== generation) return;
			showError(error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph."));
			if (graph) empty.hidden = true;
			else {
				empty.hidden = false;
				messageText.textContent = error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph.");
			}
			status.textContent = graph ? status.textContent : tr("图谱还没有建起来。", "The graph has not been built yet.");
		} finally {
			if (token === generation) setBusy(false);
		}
	};

	seedItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
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
		const parsed = classifyQuery(input.value);
		if (!parsed) {
			showError(tr("请输入 DOI、OpenAlex ID，或至少两个字的标题。", "Enter a DOI, OpenAlex ID, or a title of at least two characters."));
			return;
		}
		if (parsed.kind === "search") {
			const token = ++generation;
			setBusy(true);
			clearError();
			status.textContent = STAGE_TEXT.searching;
			try {
				const raw = await client().searchWorks(parsed.value);
				if (token !== generation) return;
				const hits: SearchHit[] = [];
				for (const work of raw) {
					const hit = toSearchHit(work);
					if (hit) hits.push(hit);
				}
				showHits(hits);
				status.textContent = hits.length ? tr(`找到 ${hits.length} 篇，点选种子论文。`, `Found ${hits.length} papers. Select a seed.`) : tr("没有匹配的作品。", "No matching works.");
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
		void submitQuery();
	});
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
		void buildResolved({ kind: "openalex", value: seedId }, true);
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
		} else {
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
	const saved = initial ? null : deps.loadSavedProject?.() ?? null;
	const restored = saved ? restoreGraphSnapshot(saved.snapshot) : null;
	if (restored) {
		deepDiveBatches = saved?.deepDives ?? [];
		applyGraph(restored, saved?.currentView, false);
		setBusy(false);
		status.textContent = tr(`已恢复本地研究项目「${saved?.name ?? tr("未命名", "Untitled")}」 · ${restored.nodes.length} 篇 · 可随时更新数据`, `Restored local research project “${saved?.name ?? tr("未命名", "Untitled")}” · ${restored.nodes.length} papers · refresh data anytime`);
	} else if (initial) {
		input.value = initial.value;
		void buildResolved(initial);
	}

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
			status.textContent = pathResult.paths.length
				? tr(`预算内找到 ${pathResult.paths.length} 条路径（检查 ${pathResult.checked}/${pathResult.budget}）`, `Found ${pathResult.paths.length} paths within budget (${pathResult.checked}/${pathResult.budget} checked)`)
				: tr(`预算内未找到路径（检查 ${pathResult.checked}/${pathResult.budget}${pathResult.exhausted ? "，提前耗尽" : ""}）`, `No path found within budget (${pathResult.checked}/${pathResult.budget} checked${pathResult.exhausted ? "; exhausted early" : ""})`);
			paintDoiPath();
		};
	};

	return {
		openDoiPathSearch,
		destroy: () => {
			disposed = true;
			generation += 1;
			if (projectSaveTimer !== null) window.clearTimeout(projectSaveTimer);
			canvas.removeEventListener("pointerup", saveCurrentViewOnGesture);
			canvas.removeEventListener("wheel", saveCurrentViewOnGesture);
			canvas.removeEventListener("keyup", saveCurrentViewOnGesture);
			chrome?.destroy();
			sheet.destroy();
			stopSidebarResize();
			observer.disconnect();
			root.removeEventListener("keydown", onUndoKey);
			root.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("research-connected-settings", onSettings);
			window.removeEventListener("research-connected-project", onProject);
			window.removeEventListener("research-connected-theme", onTheme);
			window.removeEventListener("research-connected-library-changed", onLibraryChanged);
			map.destroy();
			root.replaceChildren();
			root.classList.remove("cpo-root", "is-narrow");
		},
	};
}

function samplingText(stats: { accepted: number; requests: number; pages: number; filtered: number; duplicates: number; partial: boolean }, label: string): string {
	return tr(`${label}${stats.accepted}/${stats.pages}页·${stats.requests}次${stats.filtered ? `·滤${stats.filtered}` : ""}${stats.duplicates ? `·重${stats.duplicates}` : ""}${stats.partial ? "·未满" : ""}`, `${label}: ${stats.accepted} accepted · ${stats.pages} ${stats.pages === 1 ? "page" : "pages"} · ${stats.requests} ${stats.requests === 1 ? "request" : "requests"}${stats.filtered ? ` · ${stats.filtered} filtered` : ""}${stats.duplicates ? ` · ${stats.duplicates} duplicates` : ""}${stats.partial ? " · below target" : ""}`);
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
