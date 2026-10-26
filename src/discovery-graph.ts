import type { GraphEdge, PaperNode } from "./types";

export interface DiscoveryPaper {
	abstract?: string;
	text_comparison?: Omit<import("./paper-comparison").TextComparison, "seedId">;
	title: string;
	note?: string;
	pdf?: string | null;
	file?: string | null;
	doi?: string;
	year?: number | null;
	id?: string;
	rank?: number | null;
	priority?: number | null;
	similarity?: number | null;
	label?: string;
}

export interface DiscoveryPayload {
	scoring?: string;
	engine: "asreview" | "paperqa";
	mode: "rank" | "similar" | "search" | "index";
	query?: string;
	question?: string;
	source?: DiscoveryPaper;
	papers: DiscoveryPaper[];
	notice?: string;
	indexed?: number;
}

export interface DiscoveryRequest {
	engine: "asreview" | "paperqa";
	mode?: "rank" | "similar";
	action?: "index";
	question?: string;
	paper?: string;
	query?: string;
	selection?: DiscoveryPaper[];
}

export function vaultPath(value: unknown): string | null {
	if (typeof value !== "string" || !value || /[\\:#]/.test(value) || [...value].some(c => c.charCodeAt(0) < 32) || value.startsWith("/") || value.split("/").some(p => p === ".." || p === ".")) return null;
	return value;
}

/** Query membership edges are deliberately not paper-to-paper citation or similarity claims. */
export function buildDiscoveryGraph(payload: DiscoveryPayload, limit = 30): {
	nodes: PaperNode[]; edges: GraphEdge[]; rows: Map<string, DiscoveryPaper>; seedScore: Map<string, number>; total: number;
} {
	if (!["asreview", "paperqa"].includes(payload.engine) || !["rank", "similar", "search"].includes(payload.mode) || !Array.isArray(payload.papers)) throw new Error("Invalid discovery graph payload");
	const cap = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 30));
	const nodes: PaperNode[] = [], edges: GraphEdge[] = [], rows = new Map<string, DiscoveryPaper>(), seedScore = new Map<string, number>();
	const makeNode = (row: DiscoveryPaper, id: string, seed: boolean): PaperNode => {
		const name = row.id || row.note?.split("/").pop() || "";
		const parsed = /^(.+?) ((?:18|19|20)\d{2})[a-z]? - /.exec(name);
		const doi = /^10\.\d{4,9}\/\S+$/i.test(row.doi || "") ? row.doi! : null;
		return { id, title: String(row.title || name), year: typeof row.year === "number" && Number.isFinite(row.year) ? row.year : parsed ? Number(parsed[2]) : null,
			citedByCount: 0, authors: parsed?.[1] || "", authorList: [], abstract: "", doiUrl: doi ? `https://doi.org/${doi}` : null, openAlexUrl: "",
			isSeed: seed, origin: seed ? "seed" : "related", language: null, workType: null, venue: null, concepts: [], retracted: false };
	};
	const source = payload.mode === "similar" ? payload.source : undefined;
	const sourcePath = vaultPath(source?.note);
	const anchorId = sourcePath ? `local:${sourcePath}` : "discovery:query";
	const questionTitle = payload.question?.split("/").pop()?.replace(/\.md$/, "");
	const title = payload.query && payload.query !== payload.question ? payload.query : questionTitle || "Related papers";
	nodes.push(makeNode(source || { title }, anchorId, true));
	if (!sourcePath) nodes[0]!.authors = payload.engine === "paperqa" ? "PaperQA2" : "ASReview";
	if (source && sourcePath) rows.set(anchorId, source);
	const unique = new Map<string, DiscoveryPaper>();
	for (const row of payload.papers.slice(0, 5000)) {
		if (!row || typeof row.title !== "string") continue;
		const path = vaultPath(row.note) || vaultPath(row.pdf || row.file);
		if (!path || `local:${path}` === anchorId || unique.has(path)) continue;
		// Labeled training examples do not have an ASReview prediction/ranking.
		if (payload.mode === "rank" && !(typeof row.rank === "number" && Number.isFinite(row.rank) && row.rank > 0)) continue;
		if (payload.mode === "similar" && row.similarity != null && !(typeof row.similarity === "number" && Number.isFinite(row.similarity) && row.similarity >= 0)) continue;
		unique.set(path, row);
	}
	for (const [path, row] of [...unique].slice(0, cap)) {
		const id = `local:${path}`;
		rows.set(id, row); nodes.push(makeNode(row, id, false));
		const value = payload.mode === "similar" ? row.similarity : payload.mode === "rank" ? row.priority : null;
		// Search returns retrieval order, not a calibrated relevance score. Equal springs avoid inventing one.
		const score = row.text_comparison?.score ?? value;
		const normalized = row.text_comparison?.score != null ? row.text_comparison.score : typeof value === "number" ? value / 100 : null;
		const weight = normalized !== null && Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : 0.5;
		if (payload.mode !== "similar" || (score != null && Number.isFinite(score))) seedScore.set(id, weight);
		edges.push({ source: anchorId, target: id, weight, structuralSimilarity: null, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "none" });
	}
	return { nodes, edges, rows, seedScore, total: unique.size };
}
