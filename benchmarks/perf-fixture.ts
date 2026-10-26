import { CitationEvidenceStore, directEvidence } from "../src/citation-evidence";
import { selectNeighbors, type SimilarityGraph } from "../src/neighborhood";
import { buildSimilarity } from "../src/similarity";
import type { Origin, PaperNode } from "../src/types";

/** Deterministic PRNG so perf runs and offline tests see identical graphs. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TOPICS = ["深度学习", "图神经网络", "蛋白质结构", "强化学习", "语义解析", "气候建模"];
const WORDS = [
	"graph", "neural", "network", "attention", "protein", "folding", "reward", "policy",
	"parser", "climate", "embedding", "kernel", "sampling", "bayesian", "causal", "agent",
];

export interface SyntheticNeighborhood {
	seed: PaperNode;
	groups: { reference: PaperNode[]; citation: PaperNode[]; related: PaperNode[] };
	/** Reference lists for every generated paper, ids limited to the pool. */
	referenceLists: Map<string, string[]>;
	/** Reference lists of citation-origin papers, the co-citation contexts. */
	contexts: Array<Set<string>>;
	pool: PaperNode[];
}

/**
 * A deterministic OpenAlex-shaped neighborhood: one seed plus a candidate pool
 * sized so selectNeighbors(maxNodes = nodeCount) has room to choose. The seed
 * cites earlier reference papers and later citation papers cite the seed back.
 */
export function syntheticNeighborhood(nodeCount: number, rngSeed = 42): SyntheticNeighborhood {
	const rand = mulberry32(rngSeed);
	const poolSize = nodeCount * 2 + Math.ceil(nodeCount / 2);
	const pool: PaperNode[] = [];
	const seed = makePaper(0, "seed", rand);
	pool.push(seed);
	for (let i = 1; i < poolSize; i++) {
		const origin: Origin = i % 5 === 4 ? "related" : i % 2 === 0 ? "citation" : "reference";
		pool.push(makePaper(i, origin, rand));
	}

	const referenceLists = new Map<string, string[]>();
	const topicHubs = new Map<number, string[]>();
	for (let index = 0; index < pool.length; index++) {
		const paper = pool[index];
		if (!paper) continue;
		const topic = index % TOPICS.length;
		const hubs = topicHubs.get(topic) ?? [];
		topicHubs.set(topic, hubs);
		if (paper.isSeed) {
			const priors = pool.filter((item) => item.origin === "reference").slice(0, 60);
			referenceLists.set(paper.id, sampleIds(priors, 18 + Math.floor(rand() * 8), rand));
			continue;
		}
		const refs = new Set<string>();
		const wanted = 6 + Math.floor(rand() * 9);
		const candidates = pool.slice(1, index).filter((item, j) => (j + 1) % TOPICS.length === topic);
		for (const id of sampleIds(candidates, wanted, rand)) refs.add(id);
		if (rand() < 0.35 && hubs.length > 0) refs.add(hubs[Math.floor(rand() * hubs.length)] ?? "");
		if (paper.origin === "citation" && rand() < 0.6) refs.add(seed.id);
		if (rand() < 0.2 && hubs.length > 1) refs.add(hubs[0] ?? "");
		refs.delete("");
		refs.delete(paper.id);
		referenceLists.set(paper.id, [...refs]);
		if (hubs.length < 3) hubs.push(paper.id);
	}

	const contexts = pool
		.filter((paper) => paper.origin === "citation")
		.map((paper) => new Set(referenceLists.get(paper.id) ?? []))
		.filter((set) => set.size > 0);

	const groups = {
		reference: pool.filter((paper) => paper.origin === "reference"),
		citation: pool.filter((paper) => paper.origin === "citation"),
		related: pool.filter((paper) => paper.origin === "related"),
	};
	return { seed, groups, referenceLists, contexts, pool };
}

/** Full SimilarityGraph at the requested node count, ready for layout and aggregates. */
export function syntheticGraph(nodeCount: number, rngSeed = 42): SimilarityGraph {
	const nb = syntheticNeighborhood(nodeCount, rngSeed);
	const picked = selectNeighbors(
		{ maxNodes: nodeCount, includeReferences: true, includeCitations: true, includeRelated: true },
		nb.groups,
		nb.seed.id,
	);
	const nodes = [nb.seed, ...picked];
	const references = new Map<string, Set<string>>();
	for (const paper of nodes) references.set(paper.id, new Set(nb.referenceLists.get(paper.id) ?? []));
	const { edges, seedScore } = buildSimilarity({
		ids: nodes.map((paper) => paper.id),
		seedId: nb.seed.id,
		references,
		contexts: nb.contexts,
	});
	const byId = new Map(nb.pool.map((paper) => [paper.id, paper]));
	const citationEvidence = new CitationEvidenceStore();
	for (const [id, refs] of nb.referenceLists) {
		const source = byId.get(id);
		if (!source) continue;
		for (const ref of refs) {
			const target = byId.get(ref);
			if (target) citationEvidence.set(directEvidence(source, target, true, false));
		}
	}
	return {
		nodes,
		edges,
		seedScore,
		warnings: [],
		strategies: { references: true, citations: true, related: true },
		referenceLists: nb.referenceLists,
		catalog: [...byId.values()],
		citationEvidence,
		skippedNonResearch: 0,
	};
}

function makePaper(index: number, origin: Origin, rand: () => number): PaperNode {
	const id = `W${100000 + index}`;
	const topic = TOPICS[index % TOPICS.length] ?? TOPICS[0] ?? "";
	return {
		id,
		title: `${topic} study ${index}`,
		year: rand() < 0.12 ? null : 1980 + Math.floor(rand() * 45),
		citedByCount: Math.floor(Math.pow(10, rand() * 4)),
		authors: `Author ${index}, Coauthor ${index}`,
		authorList: [`Author ${index}`, `Coauthor ${index}`],
		abstract: Array.from({ length: 12 }, () => WORDS[Math.floor(rand() * WORDS.length)] ?? "").join(" "),
		doiUrl: rand() < 0.1 ? null : `https://doi.org/10.5555/${index}`,
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: "en",
		workType: "article",
		venue: rand() < 0.15 ? null : `Journal of ${topic}`,
		concepts: [topic, WORDS[index % WORDS.length] ?? ""],
		retracted: rand() < 0.01,
	};
}

function sampleIds(papers: readonly PaperNode[], count: number, rand: () => number): string[] {
	const ids: string[] = [];
	if (papers.length === 0) return ids;
	for (let i = 0; i < count; i++) {
		const paper = papers[Math.floor(rand() * papers.length)];
		if (paper) ids.push(paper.id);
	}
	return [...new Set(ids)];
}
