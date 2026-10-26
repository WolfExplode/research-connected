import type { SimilarityGraph } from "./neighborhood";
import { comparisonData, type StoredTextEvidence } from "./paper-comparison";
import type { PaperNode } from "./types";

export type SearchScope = "library" | "external" | "both";
export type LibraryTextPaper = { paper: PaperNode; note: string; vector?: number[] };
export type SearchResult = ReturnType<typeof searchSimilarity>;

function doi(paper: PaperNode): string {
	return (paper.doiUrl ?? "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
}
function openalex(paper: PaperNode): string {
	return /(?:^|\/)(W\d+)$/i.exec(paper.openAlexUrl || paper.id)?.[1]?.toUpperCase() ?? "";
}

/** Retrieval precedes scoring; citation data never changes the text-ranked candidate membership. */
export function searchSimilarity(base: SimilarityGraph, library: readonly LibraryTextPaper[], scope: SearchScope,
	limit: number, evidence: readonly StoredTextEvidence[] = [], center?: PaperNode) {
	const requested = center ?? base.nodes.find(paper => paper.isSeed);
	if (!requested) throw new Error("Choose a comparison paper");
	const remoteSeed = !requested.recordsSeparated
		? [...base.nodes, ...base.catalog].find(paper => !paper.recordsSeparated &&
			((doi(requested) && doi(paper) === doi(requested)) || (openalex(requested) && openalex(paper) === openalex(requested)))) : undefined;
	const seed = { ...(remoteSeed ?? requested), isSeed: true };
	const all = new Map<string, PaperNode>();
	const canonical = new Map<string, string>();
	const notes = new Map<string, string[]>();
	const vectors = new Map(base.textVectors);
	const stored = new Map(evidence.map(row => [row.id, row]));
	const key = (paper: PaperNode): string => paper.recordsSeparated ? paper.id : doi(paper) ? `doi:${doi(paper)}` : paper.id;
	const add = (paper: PaperNode): string => {
		const identity = key(paper), existing = canonical.get(identity);
		if (existing) return existing;
		canonical.set(identity, paper.id);
		all.set(paper.id, { ...paper, isSeed: paper.id === seed.id });
		return paper.id;
	};
	add({ ...seed, isSeed: true });
	// Prefer external identities/metadata when merging, retaining local evidence and note paths.
	const external = [...base.nodes, ...base.catalog];
	const remoteByDoi = new Map<string, PaperNode>();
	const remoteById = new Map<string, PaperNode>();
	for (const paper of external) if (doi(paper) && !paper.recordsSeparated && !remoteByDoi.has(doi(paper))) remoteByDoi.set(doi(paper), paper);
	for (const paper of external) if (openalex(paper) && !paper.recordsSeparated && !remoteById.has(openalex(paper))) remoteById.set(openalex(paper), paper);
	if (scope !== "library") for (const paper of external) add(paper);
	for (const row of library) {
		const remote = remoteByDoi.get(doi(row.paper)) ?? remoteById.get(openalex(row.paper));
		const matchedSeed = key(remote ?? row.paper) === key(seed);
		if (scope === "external" && !canonical.has(key(remote ?? row.paper))) continue;
		const id = add(matchedSeed ? seed : remote ?? row.paper);
		notes.set(id, [...(notes.get(id) ?? []), row.note]);
		stored.set(id, { id, summary: row.paper.abstract, vector: row.vector });
		const node = all.get(id)!;
		if (!node.abstract) node.abstract = row.paper.abstract;
		if (row.vector) vectors.set(id, row.vector);
	}
	const excluded = new Set(base.excludedIds ?? []);
	const nodes = [...all.values()].filter(paper => paper.isSeed || !excluded.has(paper.id));
	const pool: SimilarityGraph = { ...base, nodes, textVectors: vectors };
	const scores = comparisonData(pool, [...stored.values()]);
	const ranked = nodes.filter(paper => !paper.isSeed).sort((a, b) =>
		(scores.text.get(b.id) ?? -1) - (scores.text.get(a.id) ?? -1) || a.id.localeCompare(b.id));
	const selected = [nodes.find(paper => paper.isSeed)!, ...ranked.slice(0, Math.max(1, Math.min(300, limit)))];
	const ids = new Set(selected.map(paper => paper.id));
	return { graph: { ...pool, nodes: selected, edges: base.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) },
		scores, notes, compared: ranked.length, shown: selected.length - 1,
		fallback: ranked.filter(paper => scores.details.get(paper.id)?.method === "words").length };
}

