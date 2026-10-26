import type { SimilarityGraph } from "../neighborhood";
import { OpenAlexError, type OpenAlexClient, type RawWork } from "../openalex";
import { normalizeDoi, referenceIds, shortId } from "../paper";
import { buildSimilarity } from "../similarity";
import type { PaperNode } from "../types";

interface References { id: string; refs: string[] }
export interface CitationComparisonResult { graph: SimilarityGraph; failed: number }

/** On-demand, transient evidence for the displayed pool, including DOI-only library papers. */
export function createComparisonCitations(client: () => OpenAlexClient) {
	const cache = new Map<string, References | null>();
	return async (graph: SimilarityGraph): Promise<CitationComparisonResult> => {
		const key = (paper: PaperNode): string => /^(W\d+)$/i.test(paper.id) ? paper.id.toUpperCase()
			: normalizeDoi(paper.doiUrl) || shortId(paper.openAlexUrl);
		const wanted = new Map(graph.nodes.filter(paper => !graph.referenceLists.get(paper.id)?.length)
			.map(paper => [key(paper), paper]).filter(([id]) => Boolean(id)) as [string, PaperNode][]);
		const missing = [...wanted.keys()].filter(id => !cache.has(id));
		const ids = missing.filter(id => /^W\d+$/i.test(id));
		let failed = 0;
		const remember = (lookup: string, raw: RawWork | undefined): void => {
			cache.set(lookup, raw?.id ? { id: shortId(raw.id), refs: referenceIds(raw.referenced_works) } : null);
		};
		// Bound requests and retry only unsuccessful lookups, rather than refetching on every paint.
		for (let i = 0; i < ids.length; i += 80) {
			const chunk = ids.slice(i, i + 80);
			try {
				const rows = await client().worksByIds(chunk);
				for (const id of chunk) remember(id, rows.find(raw => shortId(raw.id ?? "") === id));
			} catch { failed += chunk.length; }
		}
		const dois = missing.filter(id => !/^W\d+$/i.test(id));
		let cursor = 0;
		await Promise.all(Array.from({ length: Math.min(3, dois.length) }, async () => {
			while (cursor < dois.length) {
				const doi = dois[cursor++]!;
				try { remember(doi, await client().workByDoi(doi)); }
				catch (error) {
					if (error instanceof OpenAlexError && error.status === 404) cache.set(doi, null);
					else failed++;
				}
			}
		}));
		// Translate remote reference IDs into the displayed local identities without replacing papers.
		const aliases = new Map<string, string>();
		for (const paper of graph.nodes) {
			const remote = cache.get(key(paper))?.id || shortId(paper.openAlexUrl || paper.id);
			if (remote && !paper.recordsSeparated) aliases.set(remote, paper.id);
		}
		const lists = new Map(graph.referenceLists);
		for (const [lookup, paper] of wanted) {
			const value = cache.get(lookup);
			if (value) lists.set(paper.id, value.refs);
		}
		const normalized = new Map([...lists].map(([id, refs]) => [id, refs.map(ref => aliases.get(ref) ?? ref)]));
		const references = new Map([...normalized].map(([id, refs]) => [id, new Set(refs)]));
		const contexts = (graph.coCitationContextIds ?? []).map(id => references.get(id)).filter((refs): refs is Set<string> => Boolean(refs));
		const seed = graph.nodes.find(paper => paper.isSeed)!;
		const model = buildSimilarity({ ids: graph.nodes.map(paper => paper.id), seedId: seed.id, references, contexts });
		// The general layout builder adds weak fallback links for isolates. They are not citation evidence.
		const edges = model.edges.filter(edge => edge.sharedRefs > 0 || edge.coCitedBy > 0 || edge.direct !== "none");
		return { graph: { ...graph, referenceLists: normalized, edges }, failed };
	};
}
