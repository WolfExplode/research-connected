import { tr } from "./i18n";
import { CitationEvidenceStore, type CitationEvidence } from "./citation-evidence";
import { shortId } from "./paper";
import { normalizeWorkGraph } from "./graph-edit";
import { paperHasId, paperRecords, resolveWorkQuery, type WorkIdentity } from "./work-identity";
import type { SimilarityGraph } from "./neighborhood";
import type { GraphFilter } from "./graph-filter";
import type { PaperNode, GraphEdge } from "./types";

export interface SavedGraphSnapshot {
	textComparisons?: Array<[string, import("./paper-comparison").TextComparison]>;
	version: 2;
	workIdentity?: WorkIdentity;
	savedAt: number;
	seedId: string;
	nodes: PaperNode[];
	edges: GraphEdge[];
	seedScore: Array<[string, number]>;
	warnings: SimilarityGraph["warnings"];
	strategies: SimilarityGraph["strategies"];
	referenceLists: Array<[string, string[]]>;
	coCitationContextIds?: string[];
	rawReferenceLists?: Array<[string, NonNullable<SimilarityGraph["rawReferenceLists"]> extends ReadonlyMap<string, infer T> ? T : never]>;
	catalog: PaperNode[];
	citationEvidence: CitationEvidence[];
	skippedNonResearch: number;
	skippedRetracted?: number;
	retrievalStats?: SimilarityGraph["retrievalStats"];
	candidateAudit?: SimilarityGraph["candidateAudit"];
	excludedIds?: SimilarityGraph["excludedIds"];
	crossCheck?: Array<[string, NonNullable<SimilarityGraph["crossCheck"]> extends ReadonlyMap<string, infer T> ? T : never]>;
	semanticScores?: Array<[string, number | null]>;
	semanticMode?: SimilarityGraph["semanticMode"];
	semanticModel?: string | null;
	selectionRank?: Array<[string, NonNullable<SimilarityGraph["selectionRank"]> extends ReadonlyMap<string, infer T> ? T : never]>;
}

export interface SavedView {
	distanceScale?: import("./layout-modes").DistanceScale;
	similarityKind?: import("./paper-comparison").SimilarityKind;
	name: string;
	layout: "force2d" | "temporal" | "radial";
	selectedId: string | null;
	scrubYear: number | null;
	zoom: number;
	centerX: number;
	centerY: number;
	updatedAt: number;
	filter?: GraphFilter;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
}

export type ReadingStatus = "unread" | "to-read" | "read";

export interface ProjectPaperState {
	paper: PaperNode;
	reading: ReadingStatus;
	excluded: boolean;
	source: string;
	updatedAt: number;
	fieldUpdatedAt?: Partial<Record<"reading" | "excluded", number>>;
}

export interface DeepDiveAddition {
	paperId: string;
	source: "reference" | "citation" | "shared-reference";
}

export interface DeepDiveBatch {
	id: string;
	parentId: string;
	createdAt: number;
	references: number;
	citations: number;
	additions: DeepDiveAddition[];
	noMore: boolean;
	warnings: string[];
}

export interface ResearchProject {
	version: 1;
	seedId: string;
	name: string;
	updatedAt: number;
	snapshot?: SavedGraphSnapshot;
	currentView?: SavedView;
	views: SavedView[];
	deepDives?: DeepDiveBatch[];
	paperStates?: Record<string, ProjectPaperState>;
	identityOriginalStates?: Record<string, ProjectPaperState>;
	identityConflicts?: string[];
	identityReviewedGroups?: string[];
	identityOriginalDeepDives?: DeepDiveBatch[];
	identityOriginalViews?: SavedView[];
	identityOriginalCurrentView?: SavedView;
}

export function savedProjectForSeed(
	projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string },
): ResearchProject | undefined {
	if (target.kind === "openalex" && projects[shortId(target.value)]) return projects[shortId(target.value)];
	const matches = Object.values(projects).filter((project) => { const graph = restoreGraphSnapshot(project.snapshot); return graph && resolveWorkQuery(graph.nodes.filter((paper) => paper.isSeed), target.value) !== null; });
	return matches.length === 1 ? matches[0] : undefined;
}

/** Saved citation graphs, most recently updated first. */
export function savedGraphs(projects: Record<string, ResearchProject>): ResearchProject[] {
	return Object.values(projects).filter(project => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function matchingSeedProjects(projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string }): ResearchProject[] {
	return Object.values(projects).filter((project) => {
		const snapshot = restoreGraphSnapshot(project.snapshot);
		return snapshot && resolveWorkQuery(snapshot.nodes.filter((paper) => paper.isSeed), target.value) !== null;
	});
}

export function reconcileProjectIdentity(project: ResearchProject, graph: SimilarityGraph): void {
	if (!graph.workIdentity) return;
	const ids = new Map(graph.workIdentity.canonicalIds);
	const resolve = (id: string): string => ids.get(id) ?? id;
	const papers = new Map(graph.catalog.map((paper) => [paper.id, paper]));
	const original = project.identityOriginalStates ?? { ...project.paperStates };
	const grouped = new Map<string, ProjectPaperState[]>();
	for (const state of [...Object.values(original), ...Object.values(project.paperStates ?? {})]) {
		const targets = new Set(paperRecords(state.paper).map((record) => resolve(record.id)));
		for (const id of targets) {
			let value = state;
			if (targets.size > 1) {
				const base = original[id] ?? { paper: papers.get(id) ?? state.paper, reading: "unread" as const, excluded: false, source: state.source, updatedAt: 0 };
				value = { ...base, fieldUpdatedAt: { ...base.fieldUpdatedAt } };
				for (const field of ["reading", "excluded"] as const) {
					const originalTime = Math.max(0, ...paperRecords(state.paper).map((record) => original[record.id]?.fieldUpdatedAt?.[field] ?? original[record.id]?.updatedAt ?? 0));
					if ((state.fieldUpdatedAt?.[field] ?? 0) > originalTime) { Object.assign(value, { [field]: state[field] }); value.fieldUpdatedAt![field] = state.fieldUpdatedAt![field]; }
				}
			}
			const rows = grouped.get(id) ?? []; rows.push(value); grouped.set(id, rows);
		}
	}
	const states: Record<string, ProjectPaperState> = {};
	const conflicts = new Set(project.identityConflicts ?? []);
	for (const [id, rows] of grouped) {
		const recent = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.paper.id.localeCompare(b.paper.id))[0]!;
		const next = { ...recent, paper: papers.get(id) ?? recent.paper, fieldUpdatedAt: { ...recent.fieldUpdatedAt } };
		for (const field of ["reading", "excluded"] as const) {
			const ordered = [...rows].sort((a, b) => (b.fieldUpdatedAt?.[field] ?? b.updatedAt) - (a.fieldUpdatedAt?.[field] ?? a.updatedAt) || a.paper.id.localeCompare(b.paper.id));
			const winner = ordered[0]!;
			Object.assign(next, { [field]: winner[field] });
			next.fieldUpdatedAt[field] = winner.fieldUpdatedAt?.[field] ?? winner.updatedAt;
			const groupKey = paperRecords(next.paper).map((record) => record.id).sort().join("|");
			if (new Set(rows.map((row) => row[field])).size > 1 && rows.some((row) => !row.fieldUpdatedAt) && !project.identityReviewedGroups?.includes(groupKey)) conflicts.add(id);
		}
		if (next.paper.isSeed) next.excluded = false;
		states[id] = next;
	}
	if (JSON.stringify(states) !== JSON.stringify(project.paperStates ?? {})) project.paperStates = states;
	project.identityOriginalStates = original;
	project.identityConflicts = [...conflicts];
	project.identityOriginalCurrentView ??= project.currentView;
	project.identityOriginalViews ??= project.views;
	const remapView = (view: SavedView, before?: SavedView): SavedView => {
		const selectedId = before?.updatedAt === view.updatedAt ? before.selectedId : view.selectedId;
		return { ...view, selectedId: selectedId ? resolve(selectedId) : null };
	};
	if (project.currentView) project.currentView = remapView(project.currentView, project.identityOriginalCurrentView);
	project.views = project.views.map((view) => remapView(view, project.identityOriginalViews?.find((before) => before.name === view.name)));
	const sourceBatches = new Map((project.identityOriginalDeepDives ?? []).map((batch) => [batch.id, batch]));
	for (const batch of project.deepDives ?? []) if (!sourceBatches.has(batch.id)) sourceBatches.set(batch.id, batch);
	project.identityOriginalDeepDives = [...sourceBatches.values()];
	const batches = project.deepDives?.map((batch) => {
		const source = sourceBatches.get(batch.id) ?? batch;
		return { ...batch, parentId: resolve(source.parentId), additions: [...new Map(source.additions.map((addition) => [resolve(addition.paperId), { ...addition, paperId: resolve(addition.paperId) }])).values()] };
	});
	if (JSON.stringify(batches) !== JSON.stringify(project.deepDives)) project.deepDives = batches;
}

export function acknowledgeIdentityStates(project: ResearchProject, paper: PaperNode): void {
	project.identityReviewedGroups = [...new Set([...(project.identityReviewedGroups ?? []), paperRecords(paper).map((record) => record.id).sort().join("|")])];
	project.identityConflicts = project.identityConflicts?.filter((id) => id !== paper.id);
}

export function updateProjectPaperState(
	projects: Record<string, ResearchProject>, seedId: string, paper: PaperNode,
	patch: Partial<Omit<ProjectPaperState, "paper" | "updatedAt">> & { source?: string },
): ProjectPaperState {
	const key = seedId.toUpperCase();
	const project = projects[key] ?? (projects[key] = { version: 1, seedId: key, name: key, updatedAt: Date.now(), views: [] });
	paper = project.snapshot?.nodes.find((item) => paperHasId(item, paper.id)) ?? paper;
	const previous = project.paperStates?.[paper.id];
	const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
	const fieldUpdatedAt = { ...previous?.fieldUpdatedAt };
	for (const field of ["reading", "excluded"] as const) if (patch[field] !== undefined) fieldUpdatedAt[field] = now;
	const state: ProjectPaperState = {
		paper,
		reading: patch.reading ?? previous?.reading ?? "unread",
		excluded: paper.isSeed ? false : patch.excluded ?? previous?.excluded ?? false,
		source: patch.source ?? previous?.source ?? "OpenAlex",
		updatedAt: now,
		fieldUpdatedAt,
	};
	project.paperStates = { ...project.paperStates, [paper.id]: state };
	project.updatedAt = state.updatedAt;
	return state;
}

export function projectExcludedPapers(project: ResearchProject): ProjectPaperState[] {
	return Object.values(project.paperStates ?? {}).filter((state) => state.excluded);
}

/** Carry snapshot exclusions into the project's paper states. */
export function migrateProjectRecords(projects: Record<string, ResearchProject>): Record<string, ResearchProject> {
	for (const project of Object.values(projects)) {
		const snapshot = project.snapshot;
		if (snapshot) for (const id of snapshot.excludedIds ?? []) {
			const paper = snapshot.nodes.find((node) => node.id === id) ?? snapshot.catalog.find((node) => node.id === id);
			if (paper) updateProjectPaperState(projects, project.seedId, paper, { excluded: true });
		}
	}
	return projects;
}

export function saveGraphSnapshot(graph: SimilarityGraph): SavedGraphSnapshot {
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) throw new Error(tr("研究项目缺少种子论文", "Research project has no seed paper"));
	return {
		version: 2,
		workIdentity: graph.workIdentity,
		savedAt: Date.now(),
		seedId: seed.id,
		nodes: graph.nodes,
		edges: graph.edges,
		seedScore: [...graph.seedScore],
		warnings: graph.warnings,
		strategies: graph.strategies,
		referenceLists: [...graph.referenceLists].map(([id, refs]) => [id, [...refs]]),
		coCitationContextIds: graph.coCitationContextIds ? [...graph.coCitationContextIds] : undefined,
		rawReferenceLists: graph.rawReferenceLists ? [...graph.rawReferenceLists].map(([id, refs]) => [id, [...refs]]) : undefined,
		catalog: [...graph.catalog],
		citationEvidence: graph.citationEvidence?.entries() ?? [],
		skippedNonResearch: graph.skippedNonResearch,
		skippedRetracted: graph.skippedRetracted,
		retrievalStats: graph.retrievalStats,
		candidateAudit: graph.candidateAudit,
		excludedIds: graph.excludedIds,
		crossCheck: graph.crossCheck ? [...graph.crossCheck] : undefined,
		semanticScores: graph.semanticScores ? [...graph.semanticScores] : undefined,
		textComparisons: graph.textComparisons ? [...graph.textComparisons] : undefined,
		semanticMode: graph.semanticMode,
		semanticModel: graph.semanticModel,
		selectionRank: graph.selectionRank ? [...graph.selectionRank] : undefined,
	};
}

export function restoreGraphSnapshot(raw: unknown): SimilarityGraph | null {
	if (!raw || typeof raw !== "object") return null;
	const saved = JSON.parse(JSON.stringify(raw)) as Partial<SavedGraphSnapshot>;
	if (saved.version !== 2 || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges) || !Array.isArray(saved.seedScore) || !Array.isArray(saved.referenceLists) || !Array.isArray(saved.catalog)) return null;
	if (!saved.nodes.some((node) => node?.isSeed && node.id === saved.seedId)) return null;
	try {
		const identity = saved.workIdentity;
		if (identity && (identity.version !== 1 || !Array.isArray(identity.records) || identity.records.length > 10000 || !identity.records.every((paper) => paper && typeof paper.id === "string" && typeof paper.title === "string" && Array.isArray(paper.authorList)) || !Array.isArray(identity.referenceLists) || !identity.referenceLists.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")) || !Array.isArray(identity.evidence) || !Array.isArray(identity.directEdges) || !Array.isArray(identity.canonicalIds) || !identity.canonicalIds.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === "string")) || !Array.isArray(identity.separatedIds) || !identity.separatedIds.every((id) => typeof id === "string"))) return null;
		if (identity?.contextIds !== undefined && (!Array.isArray(identity.contextIds) || identity.contextIds.length > 10000 || !identity.contextIds.every((id) => typeof id === "string"))) return null;
		if (saved.nodes.length > 300 || saved.edges.length > 20000 || saved.seedScore.some((entry) => !Array.isArray(entry) || entry.length !== 2)) return null;
		const citationEvidence = new CitationEvidenceStore();
		for (const evidence of Array.isArray(saved.citationEvidence) ? saved.citationEvidence : []) {
			if (evidence && typeof evidence.citingId === "string" && typeof evidence.citedId === "string") citationEvidence.set(evidence);
		}
		return normalizeWorkGraph({
		workIdentity: saved.workIdentity,
		nodes: saved.nodes,
		edges: saved.edges,
		seedScore: new Map(saved.seedScore),
		warnings: saved.warnings ?? [],
		strategies: saved.strategies ?? { references: true, citations: true, related: true },
		referenceLists: new Map(saved.referenceLists),
		coCitationContextIds: Array.isArray(saved.coCitationContextIds) ? saved.coCitationContextIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 400) : undefined,
		rawReferenceLists: saved.rawReferenceLists ? new Map(saved.rawReferenceLists) : undefined,
		catalog: saved.catalog,
		citationEvidence,
		skippedNonResearch: saved.skippedNonResearch ?? 0,
		skippedRetracted: saved.skippedRetracted ?? 0,
		retrievalStats: saved.retrievalStats,
		candidateAudit: Array.isArray(saved.candidateAudit)
			? saved.candidateAudit.filter((item: NonNullable<SavedGraphSnapshot["candidateAudit"]>[number]) => item && typeof item.id === "string" && typeof item.source === "string" && (item.doi === null || typeof item.doi === "string")).slice(0, 5000)
			: undefined,
		excludedIds: Array.isArray(saved.excludedIds) ? saved.excludedIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 300) : undefined,
		crossCheck: saved.crossCheck ? new Map(saved.crossCheck) : undefined,
		semanticScores: saved.semanticScores ? new Map(saved.semanticScores) : undefined,
		textComparisons: saved.textComparisons ? new Map(saved.textComparisons) : undefined,
		semanticMode: saved.semanticMode,
		semanticModel: saved.semanticModel,
			selectionRank: saved.selectionRank ? new Map(saved.selectionRank) : undefined,
		});
	} catch {
		return null;
	}
}

export function normalizeProjects(raw: unknown): Record<string, ResearchProject> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, ResearchProject> = {};
	for (const [seedId, value] of Object.entries(raw)) {
		if (!/^W\d+$/i.test(seedId) || !value || typeof value !== "object") continue;
		const project = value as Partial<ResearchProject>;
		const snapshot = project.snapshot ? restoreGraphSnapshot(project.snapshot) : null;
		const paperStates: Record<string, ProjectPaperState> = {};
		for (const [id, rawState] of Object.entries(project.paperStates ?? {}).slice(0, 1000)) {
			if (!rawState || rawState.paper?.id !== id || !["unread", "to-read", "read"].includes(rawState.reading)) continue;
			paperStates[id] = {
				paper: rawState.paper,
				reading: rawState.reading,
				excluded: Boolean(rawState.excluded),
				source: typeof rawState.source === "string" ? rawState.source.slice(0, 300) : "OpenAlex",
				updatedAt: Number.isFinite(rawState.updatedAt) ? rawState.updatedAt : 0,
				fieldUpdatedAt: rawState.fieldUpdatedAt && Object.fromEntries(Object.entries(rawState.fieldUpdatedAt).filter(([field, time]) => ["reading", "excluded"].includes(field) && Number.isFinite(time))),
			};
		}
		if (project.version !== 1 || (snapshot && snapshot.nodes.length > 300) || (!snapshot && Object.keys(paperStates).length === 0 && !project.deepDives?.length)) continue;
		out[seedId.toUpperCase()] = {
			version: 1,
			seedId: seedId.toUpperCase(),
			name: typeof project.name === "string" ? project.name.slice(0, 120) : snapshot?.nodes.find((node) => node.isSeed)?.title || seedId,
			updatedAt: Number.isFinite(project.updatedAt) ? Number(project.updatedAt) : Number(project.snapshot && project.snapshot.savedAt) || 0,
			snapshot: snapshot ? project.snapshot : undefined,
			deepDives: Array.isArray(project.deepDives) ? project.deepDives.filter((batch) => batch && typeof batch.id === "string" && typeof batch.parentId === "string" && Array.isArray(batch.additions)).slice(-100).map((batch) => ({
				id: batch.id.slice(0, 80),
				parentId: batch.parentId,
				createdAt: Number.isFinite(batch.createdAt) ? batch.createdAt : 0,
				references: Number.isFinite(batch.references) ? Math.max(0, batch.references) : 0,
				citations: Number.isFinite(batch.citations) ? Math.max(0, batch.citations) : 0,
				additions: batch.additions.filter((item) => item && typeof item.paperId === "string" && ["reference", "citation", "shared-reference"].includes(item.source)).slice(0, 300),
				noMore: Boolean(batch.noMore),
				warnings: Array.isArray(batch.warnings) ? batch.warnings.filter((item): item is string => typeof item === "string").slice(0, 10) : [],
			})) : [],
			paperStates,
			identityOriginalStates: project.identityOriginalStates,
			identityConflicts: project.identityConflicts,
			identityReviewedGroups: project.identityReviewedGroups,
			identityOriginalDeepDives: project.identityOriginalDeepDives,
			identityOriginalViews: project.identityOriginalViews,
			identityOriginalCurrentView: project.identityOriginalCurrentView,
			currentView: validView(project.currentView) ? project.currentView : undefined,
			views: Array.isArray(project.views) ? project.views.filter(validView).slice(0, 30) : [],
		};
		const next = out[seedId.toUpperCase()]!;
		if (snapshot) { reconcileProjectIdentity(next, snapshot); next.snapshot = { ...saveGraphSnapshot(snapshot), savedAt: project.snapshot?.savedAt ?? 0 }; }
	}
	return out;
}

function validView(view: unknown): view is SavedView {
	if (!view || typeof view !== "object") return false;
	const item = view as Partial<SavedView>;
	return typeof item.name === "string" && ["force2d", "temporal", "radial"].includes(item.layout ?? "")
		&& (item.selectedId === null || typeof item.selectedId === "string")
		&& (item.scrubYear === null || typeof item.scrubYear === "number")
		&& Number.isFinite(item.zoom) && Number.isFinite(item.centerX) && Number.isFinite(item.centerY);
}
