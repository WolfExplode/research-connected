import { buildSimilarity } from "./similarity";
import { buildSemanticScorer } from "./text-similarity";
import { CitationEvidenceStore, edgeCitationPairs, type CitationEvidence } from "./citation-evidence";
import { paperHasId, paperRecords, workIndex, type WorkIdentity } from "./work-identity";
import type { SelectionRank } from "./neighborhood";
import type { GraphEdge, PaperNode } from "./types";

export const EXPAND_CAP = 8;

/** The fields omit/graft/refresh touch. SimilarityGraph is a structural match. */
export interface EditableGraph {
	textVectors?: ReadonlyMap<string, readonly number[]>;
	textComparisons?: ReadonlyMap<string, import("./paper-comparison").TextComparison>;
	nodes: PaperNode[];
	edges: GraphEdge[];
	seedScore: Map<string, number>;
	referenceLists: ReadonlyMap<string, readonly string[]>;
	catalog: readonly PaperNode[];
	semanticScores?: ReadonlyMap<string, number | null>;
	semanticMode?: "embedding" | "local";
	selectionRank?: ReadonlyMap<string, SelectionRank>;
	citationEvidence?: CitationEvidenceStore;
	coCitationContextIds?: readonly string[];
	workIdentity?: WorkIdentity;
	excludedIds?: readonly string[];
}

export function omitNode<T extends EditableGraph>(graph: T, id: string): T | null {
	const target = graph.nodes.find((node) => paperHasId(node, id));
	if (!target || target.isSeed) return null;
	id = target.id;
	return {
		...graph,
		nodes: graph.nodes.filter((node) => node.id !== id),
		edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
	};
}

export function graftNodes<T extends EditableGraph>(
	graph: T,
	papers: readonly PaperNode[],
	lists: ReadonlyMap<string, readonly string[]>,
): T {
	const have = new Set(graph.nodes.map((node) => node.id));
	const extra = papers.filter((paper) => !have.has(paper.id) && !paper.isSeed);
	if (extra.length === 0 && lists.size === 0) return graph;
	const referenceLists = new Map(graph.referenceLists);
	for (const [id, list] of lists) referenceLists.set(id, list);
	const catalogIds = new Set(graph.catalog.map((paper) => paper.id));
	const catalog = [...graph.catalog];
	for (const paper of extra) {
		if (catalogIds.has(paper.id)) continue;
		catalogIds.add(paper.id);
		catalog.push(paper);
	}
	const contexts = new Set(graph.coCitationContextIds ?? graph.catalog.filter((paper) => paper.origin === "citation").map((paper) => paper.id));
	for (const paper of extra) if (paper.origin === "citation") contexts.add(paper.id);
	return normalizeWorkGraph({ ...graph, nodes: [...graph.nodes, ...extra], referenceLists, catalog, coCitationContextIds: [...contexts] });
}

export function refreshDerived<T extends EditableGraph>(input: T): T {
	const graph = canonicalizeWorkGraph(input);
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) return graph;
	const references = new Map<string, Set<string>>();
	for (const node of graph.nodes) references.set(node.id, new Set(graph.referenceLists.get(node.id) ?? []));
	const contextIds = graph.coCitationContextIds ?? graph.catalog.filter((paper) => paper.origin === "citation").map((paper) => paper.id);
	const contexts = contextIds.map((id) => graph.referenceLists.get(id) ?? [])
		.filter((list) => list.length > 0)
		.map((list) => new Set(list));
	const { edges, seedScore: structuralScore } = buildSimilarity({
		ids: graph.nodes.map((node) => node.id),
		seedId: seed.id,
		references,
		contexts,
	});
	const present = new Set(graph.nodes.map((node) => node.id));
	const byPair = new Map(edges.map((edge) => [[edge.source, edge.target].sort().join("\0"), edge]));
	for (const old of graph.edges) for (const { citingId, citedId } of edgeCitationPairs(old)) {
		if (!present.has(citingId) || !present.has(citedId)) continue;
		const key = [citingId, citedId].sort().join("\0");
		let edge = byPair.get(key);
		if (!edge) {
			edge = { ...old, source: citingId, target: citedId, direct: "source-cites-target" };
			edges.push(edge);
			byPair.set(key, edge);
			continue;
		}
		const direction = edge.source === citingId ? "source-cites-target" : "target-cites-source";
		edge.direct = edge.direct === "none" ? direction : edge.direct === direction ? direction : "mutual";
	}
	const semanticScorer = buildSemanticScorer(seed, graph.nodes);
	const semanticScores = new Map<string, number | null>();
	const seedScore = new Map(structuralScore);
	for (const node of graph.nodes) {
		if (node.isSeed) continue;
		// Keep decision-time scores for existing nodes (including SPECTER2 scores).
		// Deep-dug nodes have no vector, so use the same local fallback as missing-vector candidates.
		const semantic = graph.semanticScores?.has(node.id)
			? graph.semanticScores.get(node.id) ?? null
			: semanticScorer.score(node);
		semanticScores.set(node.id, semantic);
		if (semantic !== null) {
			seedScore.set(node.id, Math.min(1, 0.55 * (structuralScore.get(node.id) ?? 0) + 0.45 * semantic));
		}
	}
	return { ...graph, edges, seedScore, semanticScores, selectionRank: graph.selectionRank };
}

/** Reversible source records stay alongside the derived work graph. */
function canonicalizeWorkGraph<T extends EditableGraph>(graph: T): T {
	const previous = graph.workIdentity;
	const index = workIndex([...(previous?.records ?? []), ...graph.catalog, ...graph.nodes], graph.nodes.map((paper) => paper.id), previous?.separatedIds);
	if (!previous && index.records.length === index.papers.length) return graph;
	const oldIds = new Map(previous?.canonicalIds ?? []);
	const resolve = (id: string): string => index.ids.get(id) ?? id;
	const projectLists = (rows: readonly (readonly [string, readonly string[]])[], mapping: ReadonlyMap<string, string>): Map<string, string[]> => {
		const lists = new Map<string, Set<string>>();
		for (const [id, refs] of rows) {
			const key = mapping.get(id) ?? id;
			const set = lists.get(key) ?? new Set<string>();
			for (const ref of refs) { const target = mapping.get(ref) ?? ref; if (target !== key) set.add(target); }
			lists.set(key, set);
		}
		return new Map([...lists].map(([id, refs]) => [id, [...refs].sort()]));
	};
	const sources = new Map<string, string[]>((previous?.referenceLists ?? []).map(([id, refs]) => [id, [...refs]]));
	const oldProjection = projectLists(previous?.referenceLists ?? [], oldIds);
	for (const [id, refs] of graph.referenceLists) {
		if (previous && JSON.stringify([...refs].sort()) === JSON.stringify(oldProjection.get(id))) continue;
		sources.set(id, [...new Set([...(sources.get(id) ?? []), ...refs])]);
	}
	const rawEvidence = new CitationEvidenceStore();
	const evidenceSignature = (row: CitationEvidence | null): string => row ? JSON.stringify({ ...row, sources: [...row.sources].sort(), intents: [...row.intents].sort(), contexts: [...row.contexts].sort(), evidenceQuotes: [...row.evidenceQuotes].sort(), influential: row.influential ?? null }) : "";
	for (const evidence of previous?.evidence ?? []) rawEvidence.set(evidence);
	const oldEvidence = new CitationEvidenceStore();
	for (const evidence of previous?.evidence ?? []) {
		const citingId = oldIds.get(evidence.citingId) ?? evidence.citingId;
		const citedId = oldIds.get(evidence.citedId) ?? evidence.citedId;
		if (citingId !== citedId) oldEvidence.set({ ...evidence, citingId, citedId });
	}
	for (const evidence of graph.citationEvidence?.entries() ?? []) {
		if (evidenceSignature(evidence) !== evidenceSignature(oldEvidence.get(evidence.citingId, evidence.citedId))) rawEvidence.set(evidence);
	}
	const evidence = new CitationEvidenceStore();
	for (const row of rawEvidence.entries()) {
		const citingId = resolve(row.citingId), citedId = resolve(row.citedId);
		if (citingId !== citedId) evidence.set({ ...row, citingId, citedId });
	}
	const directEdges = new Map<string, GraphEdge>();
	const oldDirectPairs = new Set((previous?.directEdges ?? []).flatMap(edgeCitationPairs).map((pair) => `${oldIds.get(pair.citingId) ?? pair.citingId}\0${oldIds.get(pair.citedId) ?? pair.citedId}`));
	for (const [id, refs] of oldProjection) for (const ref of refs) oldDirectPairs.add(`${id}\0${ref}`);
	for (const row of oldEvidence.entries()) oldDirectPairs.add(`${row.citingId}\0${row.citedId}`);
	for (const edge of [...(previous?.directEdges ?? []), ...graph.edges]) {
		if (graph.edges.includes(edge) && previous && edgeCitationPairs(edge).every((pair) => oldDirectPairs.has(`${pair.citingId}\0${pair.citedId}`))) continue;
		if (edge.direct !== "none") directEdges.set(`${edge.source}\0${edge.target}\0${edge.direct}`, edge);
	}
	const contexts = graph.coCitationContextIds ?? graph.catalog.filter((paper) => paper.origin === "citation").map((paper) => paper.id);
	const sourceContexts = new Set(previous?.contextIds ?? contexts.flatMap((id) => previous ? previous.records.filter((record) => (oldIds.get(record.id) ?? record.id) === id && record.origin === "citation").map((record) => record.id) : [id]));
	const oldContexts = new Set([...sourceContexts].map((id) => oldIds.get(id) ?? id));
	for (const id of contexts) if (!previous || !oldContexts.has(id)) sourceContexts.add(id);
	if (previous) {
		const records = new Map(previous.records.map((record) => [record.id, record]));
		const sameRecords = records.size === index.records.length && index.records.every((record) => JSON.stringify(record) === JSON.stringify(records.get(record.id)));
		const sameIds = oldIds.size === index.ids.size && [...index.ids].every(([id, canonical]) => oldIds.get(id) === canonical);
		const sameLists = oldProjection.size === graph.referenceLists.size && [...graph.referenceLists].every(([id, refs]) => JSON.stringify([...refs].sort()) === JSON.stringify(oldProjection.get(id)));
		const rows = graph.citationEvidence?.entries() ?? [];
		const sameEvidence = rows.length === oldEvidence.entries().length && rows.every((row) => evidenceSignature(row) === evidenceSignature(oldEvidence.get(row.citingId, row.citedId)));
		const canonical = [...graph.nodes, ...graph.catalog].every((paper) => resolve(paper.id) === paper.id);
		const sameContexts = previous.contextIds !== undefined && JSON.stringify([...sourceContexts].sort()) === JSON.stringify([...previous.contextIds].sort());
		if (sameRecords && sameIds && sameLists && sameEvidence && sameContexts && canonical && directEdges.size === previous.directEdges.length) return graph;
	}
	const edges = [...directEdges.values()].map((edge) => ({ ...edge, source: resolve(edge.source), target: resolve(edge.target) })).filter((edge) => edge.source !== edge.target);
	const visibleIds = new Set(graph.nodes.flatMap((paper) => paperRecords(paper).map((record) => resolve(record.id))));
	const nodes = index.papers.filter((paper) => visibleIds.has(paper.id));
	const changedIds = new Set(index.papers.filter((paper) => (paper.records?.length ?? 0) > 1).map((paper) => paper.id));
	return {
		...graph, nodes, catalog: index.papers, edges, referenceLists: projectLists([...sources], index.ids), citationEvidence: evidence,
		coCitationContextIds: [...new Set([...sourceContexts].map(resolve))],
		excludedIds: graph.excludedIds ? [...new Set(graph.excludedIds.map(resolve))].filter((id) => !nodes.some((paper) => paper.id === id && paper.isSeed)) : undefined,
		semanticScores: graph.semanticScores ? new Map([...graph.semanticScores].filter(([id]) => !changedIds.has(id) && resolve(id) === id)) : undefined,
		textComparisons: graph.textComparisons ? new Map([...graph.textComparisons].filter(([id, value]) => !changedIds.has(id) && !changedIds.has(value.seedId) && resolve(id) === id)) : undefined,
		textVectors: graph.textVectors ? new Map([...graph.textVectors].filter(([id]) => !changedIds.has(id) && resolve(id) === id)) : undefined,
		workIdentity: { version: 1, records: index.records, referenceLists: [...sources], evidence: rawEvidence.entries(), directEdges: [...directEdges.values()], canonicalIds: [...index.ids], separatedIds: previous?.separatedIds ?? [], contextIds: [...sourceContexts] },
	};
}

export function normalizeWorkGraph<T extends EditableGraph>(graph: T): T {
	const normalized = canonicalizeWorkGraph(graph);
	return normalized === graph ? graph : refreshDerived(normalized);
}

export function separateWorkRecords<T extends EditableGraph>(graph: T, paper: PaperNode): T {
	if (!graph.workIdentity || !paper.records?.length) return graph;
	return normalizeWorkGraph({ ...graph, workIdentity: { ...graph.workIdentity, separatedIds: [...new Set([...graph.workIdentity.separatedIds, ...paper.records.map((record) => record.id)])] } });
}

export function chooseExpand(
	present: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	slots: number,
	groups: { reference: readonly PaperNode[]; citation: readonly PaperNode[] },
): PaperNode[] {
	if (slots <= 0) return [];
	const ok = (paper: PaperNode): boolean => !paper.isSeed && !present.has(paper.id) && !hidden.has(paper.id);
	const byCite = (a: PaperNode, b: PaperNode): number => Number(a.retracted) - Number(b.retracted) || b.citedByCount - a.citedByCount || a.id.localeCompare(b.id);
	const index = workIndex([...groups.reference, ...groups.citation]);
	const group = (papers: readonly PaperNode[]) => [...new Set(papers.map((paper) => index.ids.get(paper.id) ?? paper.id))].map((id) => index.papers.find((paper) => paper.id === id)!).filter(ok);
	const refs = group(groups.reference).sort(byCite);
	const cites = group(groups.citation).sort(byCite);
	const take = (list: PaperNode[], n: number, skip: ReadonlySet<string>): PaperNode[] => {
		const out: PaperNode[] = [];
		const seen = new Set(skip);
		for (const paper of list) {
			if (out.length >= n) break;
			if (seen.has(paper.id)) continue;
			seen.add(paper.id);
			out.push(paper);
		}
		return out;
	};
	const refSlots = Math.min(refs.length, Math.ceil(slots / 2));
	const pickedRefs = take(refs, refSlots, new Set());
	const have = new Set(pickedRefs.map((paper) => paper.id));
	const pickedCites = take(cites, slots - pickedRefs.length, have);
	for (const paper of pickedCites) have.add(paper.id);
	const rest = take([...refs, ...cites], slots - have.size, have);
	return [...pickedRefs, ...pickedCites, ...rest];
}

/** Promote catalog papers that share references or cite `fromId`. */
export function couplingFill<T extends EditableGraph>(
	graph: T,
	fromId: string,
	present: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	need: number,
): PaperNode[] {
	if (need <= 0) return [];
	const fromRefs = new Set(graph.referenceLists.get(fromId) ?? []);
	const scored: Array<{ paper: PaperNode; shared: number }> = [];
	for (const paper of graph.catalog) {
		if (paper.isSeed || paper.id === fromId || present.has(paper.id) || hidden.has(paper.id)) continue;
		const refs = graph.referenceLists.get(paper.id) ?? [];
		let shared = 0;
		if (fromRefs.has(paper.id) || refs.includes(fromId)) shared += 2;
		if (fromRefs.size > 0) {
			for (const id of refs) if (fromRefs.has(id)) shared += 1;
		}
		if (shared > 0) scored.push({ paper, shared });
	}
	scored.sort((a, b) => b.shared * (b.paper.retracted ? 0.1 : 1) - a.shared * (a.paper.retracted ? 0.1 : 1) || b.paper.citedByCount * (b.paper.retracted ? 0.1 : 1) - a.paper.citedByCount * (a.paper.retracted ? 0.1 : 1) || a.paper.id.localeCompare(b.paper.id));
	return scored.slice(0, need).map((item) => item.paper);
}
