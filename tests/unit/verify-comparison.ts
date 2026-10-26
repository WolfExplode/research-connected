import assert from "node:assert/strict";
import { compareText, comparisonData, wordCosine } from "../../src/paper-comparison";
import { saveGraphSnapshot, restoreGraphSnapshot } from "../../src/project-state";
import { CitationEvidenceStore } from "../../src/citation-evidence";
import type { SimilarityGraph } from "../../src/neighborhood";
import type { PaperNode } from "../../src/types";
import { searchSimilarity } from "../../src/similarity-search";

export function verifyComparison(): void {
	const paper = (id: string, title: string, isSeed = false): PaperNode => ({ id, title, isSeed, abstract: "", year: 2020,
		citedByCount: 0, authors: "", authorList: [], doiUrl: null, openAlexUrl: "", origin: isSeed ? "seed" : "related",
		language: null, workType: null, venue: null, concepts: [], retracted: false });
	const seed = paper("W1", "Exercise heart rate", true), near = paper("W2", "Exercise heart rate"), far = paper("W3", "Volcanic rocks");
	const vector = [1, ...Array<number>(767).fill(0)];
	const perpendicular = [0, 1, ...Array<number>(766).fill(0)];
	assert.equal(wordCosine("Heart heart exercise", "heart exercise"), 3 / Math.sqrt(10));
	assert.equal(wordCosine("the study", "the and"), null);
	assert.equal(wordCosine("心率恢复", "心率恢复"), 1);
	assert.equal(compareText(seed, near, vector, perpendicular).score, 0.25);
	assert.equal(compareText(seed, near, vector, perpendicular).method, "specter2+words");
	assert.equal(compareText(seed, near, vector).method, "words", "a missing candidate vector has an explicit fallback");
	assert.equal(compareText(paper("A", ""), paper("B", ""), vector, vector).method, "specter2");
	const graph: SimilarityGraph = { nodes: [seed, near, far], edges: [], seedScore: new Map([[near.id, 0.99]]), warnings: [],
		strategies: { references: true, citations: true, related: true }, referenceLists: new Map([[seed.id, ["W9"]], [near.id, ["W9"]]]),
		coCitationContextIds: [], catalog: [seed, near, far], citationEvidence: new CitationEvidenceStore(), skippedNonResearch: 0 };
	const first = comparisonData(graph, [{ id: seed.id, vector }, { id: near.id, vector: perpendicular }]);
	assert.equal(first.text.get(near.id), 0.25, "stored SPECTER2 contributes to actual layout scores");
	assert.equal(first.citations.get(near.id), 0.55, "citation scores exclude all text evidence");
	assert.equal(first.citations.has(far.id), false, "missing citation evidence is not a numeric zero");
	assert.equal(first.text.get(far.id), 0, "zero word overlap remains a valid score");
	graph.textVectors = new Map([[near.id, perpendicular]]);
	assert.equal(comparisonData(graph, [{ id: seed.id, vector }]).text.get(near.id), 0.25, "stored seed vectors can pair with API candidate vectors from the same model");
	const expanded = comparisonData({ ...graph, nodes: [...graph.nodes, paper("W4", "Other candidates")] }, [{ id: seed.id, vector }, { id: near.id, vector: perpendicular }]);
	assert.equal(expanded.text.get(near.id), first.text.get(near.id), "candidate additions cannot renormalize pair scores");
	graph.textComparisons = new Map([[near.id, compareText(seed, near, vector, perpendicular)]]);
	const restored = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph))))!;
	assert.equal(comparisonData(restored).text.get(near.id), 0.25, "saved graphs retain SPECTER2 comparisons and their provenance");
	assert.equal(restored.textComparisons?.get(near.id)?.method, "specter2+words");
	const changedSeed = { ...restored, nodes: restored.nodes.map(p => ({ ...p, isSeed: p.id === far.id })) };
	assert.equal(comparisonData(changedSeed).details.get(near.id)?.method, "words", "scores from a different center cannot be reused");
	seed.doiUrl = "https://doi.org/10.1234/seed";
	near.doiUrl = "https://doi.org/10.1234/near";
	const localSeed = { ...seed, id: "local:Seed", isSeed: false };
	const localNear = { ...near, id: "local:Near" };
	const missing = paper("local:Missing", "Exercise heart rate recovery");
	const library = [{ paper: localSeed, note: "Research/Papers/Seed.md", vector },
		{ paper: localNear, note: "Research/Papers/Near.md", vector: perpendicular },
		{ paper: missing, note: "Research/Papers/Missing.md", vector },
		{ paper: { ...missing, id: "local:NoData", title: "", abstract: "" }, note: "Research/Papers/NoData.md" }];
	const before = JSON.stringify({ ...saveGraphSnapshot(graph), savedAt: 0 });
	const local = searchSimilarity(graph, library, "library", 50);
	assert.equal(local.compared, 3, "every local source enters scoring, including papers absent from the citation neighborhood");
	assert.equal(local.graph.nodes.some(paper => paper.id === missing.id), true);
	assert.equal(local.graph.nodes.some(paper => paper.id === far.id), false, "library scope excludes external-only candidates");
	assert.equal(local.scores.details.get(near.id)?.method, "specter2+words", "DOI-matched sidecar vectors score the remote identity");
	assert.equal(local.scores.citations.has(missing.id), false, "local membership never invents citation evidence");
	assert.equal(local.scores.citations.get(near.id), 0.55, "matched local papers retain existing citation evidence");
	const both = searchSimilarity(graph, library, "both", 50);
	assert.equal(both.compared, 4, "Both merges candidates and deduplicates matching DOIs");
	assert.deepEqual(both.notes.get(near.id), ["Research/Papers/Near.md"]);
	assert.equal(searchSimilarity(graph, library, "external", 50).compared, 2, "external scope uses the sampled candidates");
	const idOnly = [{ paper: { ...localNear, doiUrl: null, openAlexUrl: "https://openalex.org/W2" }, note: "Research/Papers/ID only.md", vector }];
	assert.equal(searchSimilarity(graph, idOnly, "both", 50).compared, 2, "OpenAlex IDs deduplicate DOI-less library records against external candidates");
	const capped = searchSimilarity(graph, library, "library", 1);
	assert.equal(capped.compared, 3, "display limit never limits the pool that is scored");
	assert.equal(capped.shown, 1);
	assert.equal(capped.graph.nodes[1]?.id, missing.id, "a highly similar local paper missing from the original graph can rank first");
	assert.equal(searchSimilarity(graph, library, "library", 50, [], localNear).graph.nodes.find(paper => paper.isSeed)?.id, near.id, "recentring keeps a known external identity and its citation evidence");
	assert.equal(JSON.stringify({ ...saveGraphSnapshot(graph), savedAt: 0 }), before, "similarity search never replaces the saved citation graph");
}
