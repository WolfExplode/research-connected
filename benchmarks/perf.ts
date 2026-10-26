import { performance } from "node:perf_hooks";
import { derivativeWorks, priorWorks } from "../src/aggregates";
import { placeLayout, type LayoutMode } from "../src/layout-modes";
import { buildPairSimilarity } from "../src/diversity";
import { MMR_LAMBDA, selectNeighbors } from "../src/neighborhood";
import { buildSimilarity } from "../src/similarity";
import { syntheticGraph, syntheticNeighborhood } from "./perf-fixture";
import { normalizeWorkGraph } from "../src/graph-edit";
import { workIndex } from "../src/work-identity";

const SIZES = [50, 150, 300];
const ROUNDS = 7;

function median(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timeMedian(run: () => void): number {
	run();
	const samples: number[] = [];
	for (let round = 0; round < ROUNDS; round++) {
		const start = performance.now();
		run();
		samples.push(performance.now() - start);
	}
	return median(samples);
}

function format(ms: number): string {
	return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

console.log(`rounds=${ROUNDS} (median), fixture seed=42\n`);
console.log("| N | nodes | edges | select+similarity | force2d | temporal | radial | aggregates | identity | merge+score |");
console.log("| - | ----- | ----- | ----------------- | ------- | -------- | ------ | ---------- | -------- | ----------- |");

for (const size of SIZES) {
	const nb = syntheticNeighborhood(size);
	const scoring = timeMedian(() => {
		const pool = [...nb.groups.reference, ...nb.groups.citation, ...nb.groups.related];
		const picked = selectNeighbors(
			{ maxNodes: size, includeReferences: true, includeCitations: true, includeRelated: true },
			nb.groups,
			nb.seed.id,
			undefined,
			{ sim: buildPairSimilarity(pool), lambda: MMR_LAMBDA },
		);
		const references = new Map<string, Set<string>>();
		for (const paper of [nb.seed, ...picked]) {
			references.set(paper.id, new Set(nb.referenceLists.get(paper.id) ?? []));
		}
		buildSimilarity({
			ids: [nb.seed.id, ...picked.map((paper) => paper.id)],
			seedId: nb.seed.id,
			references,
			contexts: nb.contexts,
		});
	});

	const graph = syntheticGraph(size);
	const visible = new Set(graph.nodes.map((node) => node.id));
	const layouts: Record<"force2d" | "temporal" | "radial", number> = {
		force2d: 0,
		temporal: 0,
		radial: 0,
	};
	for (const mode of Object.keys(layouts) as Array<keyof typeof layouts>) {
		layouts[mode] = timeMedian(() => {
			placeLayout(mode as LayoutMode, graph.nodes, graph.edges, graph.seedScore);
		});
	}
	const aggregates = timeMedian(() => {
		priorWorks(graph, visible);
		derivativeWorks(graph, visible);
	});
	const seed = graph.nodes.find((paper) => paper.isSeed)!;
	const canonical = { ...seed, year: 2000, authorList: ["Test Author"], workType: "article", venue: "Test Journal", bibliography: { volume: "1", firstPage: "1", lastPage: "9" } };
	const alias = { ...canonical, id: "W9999999999", isSeed: false, doiUrl: "https://doi.org/10.1234/alias" };
	const identityGraph = { ...graph, nodes: [canonical, ...graph.nodes.filter((paper) => !paper.isSeed), alias], catalog: [canonical, ...graph.catalog.filter((paper) => !paper.isSeed), alias] };
	const identity = timeMedian(() => { workIndex(identityGraph.nodes); });
	const merge = timeMedian(() => { normalizeWorkGraph(identityGraph); });

	console.log(
		`| ${size} | ${graph.nodes.length} | ${graph.edges.length} | ${format(scoring)} ms | ${format(layouts.force2d)} ms | ${format(layouts.temporal)} ms | ${format(layouts.radial)} ms | ${format(aggregates)} ms | ${format(identity)} ms | ${format(merge)} ms |`,
	);
}
