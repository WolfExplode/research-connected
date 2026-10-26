import { tr } from "./i18n";
import { embeddingCosine } from "./text-similarity";
import { pairScore } from "./similarity";
import type { PaperNode } from "./types";
import type { SimilarityGraph } from "./neighborhood";

export type SimilarityKind = "text" | "citations";
export interface TextComparison {
	seedId: string;
	score: number | null;
	method: "specter2+words" | "specter2" | "words" | "unavailable";
	lexical: number | null;
	embedding: number | null;
}
export interface StoredTextEvidence { id: string; summary?: string; vector?: number[] }

// Pairwise word cosine is independent of the candidate collection. Keep in sync with discovery.py.
const STOP = new Set("the and for with from that this these those are was were has have had not but into using study studies analysis results method methods paper".split(" "));
export function wordCosine(a: string, b: string): number | null {
	const vector = (text: string): Map<string, number> => {
		const tokens = (text.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? []).filter(word => word.length >= 3 && !STOP.has(word));
		const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? [];
		for (let i = 0; i + 1 < cjk.length; i++) tokens.push(`${cjk[i]}${cjk[i + 1]}`);
		const counts = new Map<string, number>();
		for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
		return counts;
	};
	const x = vector(a), y = vector(b);
	if (!x.size || !y.size) return null;
	let dot = 0, nx = 0, ny = 0;
	for (const [token, count] of x) { dot += count * (y.get(token) ?? 0); nx += count * count; }
	for (const count of y.values()) ny += count * count;
	return Math.min(1, dot / Math.sqrt(nx * ny));
}

export function compareText(seed: PaperNode, paper: PaperNode, seedVector?: readonly number[], vector?: readonly number[]): TextComparison {
	const lexical = wordCosine(`${seed.title} ${seed.abstract}`, `${paper.title} ${paper.abstract}`);
	const embedding = seedVector && vector ? embeddingCosine(seedVector, vector) : null;
	return combineText(seed.id, lexical, embedding);
}

function combineText(seedId: string, lexical: number | null, embedding: number | null): TextComparison {
	return { seedId, lexical, embedding,
		score: embedding === null ? lexical : lexical === null ? embedding : 0.75 * embedding + 0.25 * lexical,
		method: embedding === null ? lexical === null ? "unavailable" : "words" : lexical === null ? "specter2" : "specter2+words" };
}

export function textMethodLabel(method: TextComparison["method"]): string {
	return { "specter2+words": tr("SPECTER2 75% + 词语重合度 25%", "75% SPECTER2 + 25% word overlap"),
		specter2: "SPECTER2", words: tr("词语重合度（缺少配对 SPECTER2 向量）", "Word overlap (paired SPECTER2 vectors unavailable)"),
		unavailable: tr("数据不足", "Insufficient data") }[method];
}

export function comparisonData(graph: SimilarityGraph, stored: readonly StoredTextEvidence[] = []): {
	text: Map<string, number>; citations: Map<string, number>; details: Map<string, TextComparison>;
} {
	const seed = graph.nodes.find(paper => paper.isSeed);
	const text = new Map<string, number>(), citations = new Map<string, number>(), details = new Map<string, TextComparison>();
	if (!seed) return { text, citations, details };
	const evidence = new Map(stored.map(row => [row.id, row]));
	const enriched = (paper: PaperNode): PaperNode => ({ ...paper, abstract: paper.abstract || evidence.get(paper.id)?.summary || "" });
	for (const paper of graph.nodes) {
		if (paper.isSeed) { text.set(paper.id, 1); continue; }
		const localSeed = evidence.get(seed.id)?.vector ?? graph.textVectors?.get(seed.id);
		const localPaper = evidence.get(paper.id)?.vector ?? graph.textVectors?.get(paper.id);
		const saved = graph.textComparisons?.get(paper.id);
		const fresh = compareText(enriched(seed), enriched(paper), localSeed, localPaper);
		const value = fresh.embedding !== null ? fresh
			: saved?.seedId === seed.id && saved.embedding !== null && Number.isFinite(saved.embedding)
				? combineText(seed.id, fresh.lexical, saved.embedding) : fresh;
		details.set(paper.id, value);
		if (value.score !== null && Number.isFinite(value.score)) text.set(paper.id, value.score);
	}
	const references = new Map([...graph.referenceLists].map(([id, list]) => [id, new Set(list)]));
	const contexts = (graph.coCitationContextIds ?? []).map(id => references.get(id)).filter((list): list is Set<string> => Boolean(list?.size));
	for (const paper of graph.nodes) {
		// No references/context evidence is absence of data, not a zero similarity claim.
		if (paper.isSeed || ((references.get(seed.id)?.size ?? 0) > 0 && (references.get(paper.id)?.size ?? 0) > 0)
			|| references.get(seed.id)?.has(paper.id) || references.get(paper.id)?.has(seed.id)
			|| contexts.some(context => context.has(seed.id) && context.has(paper.id))) {
			citations.set(paper.id, paper.isSeed ? 1 : pairScore(seed.id, paper.id, references, contexts));
		}
	}
	return { text, citations, details };
}
