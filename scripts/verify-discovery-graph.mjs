import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/discovery-graph.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const loaded = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(loaded, loaded.exports);
const { buildDiscoveryGraph, vaultPath } = loaded.exports;
const row = (name, extra = {}) => ({ title: `A study of ${name}`, note: `Research/Papers/${name}.md`, ...extra });

const ranked = { engine: "asreview", mode: "rank", question: "Research/Questions/Exercise.md", papers: [row("First", { rank: 1, priority: 100 }), row("Second", { rank: 2, priority: 50 }), row("Training", { rank: null, priority: null, label: "relevant" })] };
const before = JSON.stringify(ranked);
const graph = buildDiscoveryGraph(ranked);
assert.equal(graph.nodes.length, 3);
assert.equal(graph.nodes[0].title, "Exercise", "question anchors use readable names instead of vault paths");
assert.equal(graph.rows.size, 2, "training labels are not predictions");
assert.ok(graph.edges.every(edge => edge.source === "discovery:query" && edge.direct === "none" && edge.coCitedBy === 0 && edge.sharedRefs === 0 && edge.structuralSimilarity === null));
assert.equal(JSON.stringify(ranked), before, "source output must remain unchanged");

const similar = buildDiscoveryGraph({ engine: "asreview", mode: "similar", source: row("Seed"), papers: [row("Seed", { similarity: 100 }), row("Neighbor", { similarity: 42 }), row("Neighbor", { similarity: 42 }), row("Zero", { similarity: 0 })] });
assert.equal(similar.nodes.length, 2);
assert.equal(similar.edges[0].weight, 0.42);
assert.equal(similar.nodes[1].doiUrl, null, "DOI-less local papers retain their file identity");

const search = buildDiscoveryGraph({ engine: "paperqa", mode: "search", query: "heart rate", papers: [row("One", { rank: 1 }), row("One", { rank: 2 }), row("Two", { rank: 10 }), row("Unsafe", { note: "../outside.md" })] });
assert.equal(search.nodes.length, 3);
assert.equal(search.edges[0].weight, search.edges[1].weight, "retrieval rank must not manufacture a similarity score");
assert.equal(search.rows.get("local:Research/Papers/One.md").rank, 1);
assert.equal(buildDiscoveryGraph(ranked, 1).nodes.length, 2);
for (const path of ["../file.pdf", "C:/private.pdf", "https://example.org/paper.pdf", "/absolute.pdf", "Research/./file.md", "Research/\u0000.md"]) assert.equal(vaultPath(path), null);
assert.throws(() => buildDiscoveryGraph({ engine: "paperqa", mode: "index", papers: [] }), /Invalid/);
console.log("discovery graphs preserve ranking, retrieval order, local identity and non-citation semantics");

const workspaceBundle = await build({ entryPoints: ["src/question-workspace.ts", "src/project-state.ts"], bundle: true, platform: "node", format: "cjs", alias: { obsidian: "./scripts/obsidian-stub.ts" }, write: false, outdir: "/unused" });
const modules = workspaceBundle.outputFiles.map(file => {
	const module = { exports: {} }; new Function("module", "exports", file.text)(module, module.exports); return module.exports;
});
const workspace = modules.find(module => module.graphsForQuestion);
const { normalizeProjects } = modules.find(module => module.normalizeProjects);
const firstQuestion = "Research/Questions/Exercise.md", secondQuestion = "Research/Questions/Heart rate.md";
const legacy = { version: 1, seedId: "W1", name: "Existing paper graph", updatedAt: 10, views: [], deepDives: [{ id: "legacy", parentId: "W1", additions: [], warnings: [] }] };
const records = normalizeProjects({ W1: legacy });
assert.deepEqual(records.W1.questionPaths, [], "old projects do not acquire inferred question memberships");
workspace.linkGraphToQuestion(records.W1, firstQuestion);
workspace.linkGraphToQuestion(records.W1, firstQuestion);
workspace.linkGraphToQuestion(records.W1, secondQuestion);
workspace.linkGraphToQuestion(records.W1, "Research/Questions/../private.md");
const restoredRecords = normalizeProjects(JSON.parse(JSON.stringify(records)));
assert.deepEqual(restoredRecords.W1.questionPaths, [firstQuestion, secondQuestion], "memberships persist once, without duplicating graph state");
assert.equal(restoredRecords.W1.name, legacy.name);
const snapshots = { W1: { ...restoredRecords.W1, snapshot: {} }, W2: { ...legacy, seedId: "W2", snapshot: {} } };
assert.deepEqual(workspace.graphsForQuestion(snapshots, firstQuestion).map(project => project.seedId), ["W1"]);
assert.deepEqual(workspace.graphsForQuestion(snapshots, "").map(project => project.seedId), ["W2"]);
for (const path of ["../private.md", "Research/Questions/../private.md", "Research/Questions/\u0000.md", "C:/question.md"]) assert.equal(workspace.questionPath(path), null);
console.log("question workspaces retain legacy graphs and explicit shared memberships across persistence");
