/**
 * One-off live regression: the Comrie book-review seed (W2091966899).
 * Expects the reconcile pass to flag citation-count mismatches and to keep
 * non-research records out of the map. Not part of npm test.
 */
import { loadNeighborhood } from "../../src/neighborhood";
import { OpenAlexClient, explainStatus, OpenAlexError, type GetJson } from "../../src/openalex";
import { SemanticScholarClient } from "../../src/citation-sources";
import { DEFAULT_SETTINGS } from "../../src/settings-model";

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const postJson = async (url: string, init: { headers: Record<string, string>; body: string }): Promise<unknown> => {
	const response = await fetch(url, { method: "POST", headers: init.headers, body: init.body });
	if (!response.ok) throw new Error(`S2 bulk HTTP ${response.status}`);
	return (await response.json()) as unknown;
};

async function main(): Promise<void> {
	const client = new OpenAlexClient(getJson, { apiKey: "", contactEmail: "" });
	const s2 = new SemanticScholarClient(getJson, "", postJson);
	const depth = process.env.SAMPLE_DEPTH;
	const graph = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W2091966899" },
		{
			...DEFAULT_SETTINGS,
			maxNodes: 30,
			...(depth === "extended" || depth === "deep" ? { sampleDepth: depth } : {}),
		},
		undefined,
		s2,
	);
	const seed = graph.nodes.find((node) => node.isSeed);
	console.log("seed:", seed?.id, seed?.workType, "·", seed?.title.slice(0, 70));
	console.log("seed authors:", seed?.authors);
	console.log("seed citedByCount (OpenAlex):", seed?.citedByCount);
	console.log("nodes:", graph.nodes.length, "edges:", graph.edges.length, "skippedNonResearch:", graph.skippedNonResearch);
	console.log("warnings:", graph.warnings.join(",") || "none");
	const checks = graph.crossCheck ?? new Map();
	let mismatched = 0;
	for (const node of graph.nodes) {
		const check = checks.get(node.id);
		if (!check) continue;
		if (check.mismatched) {
			mismatched++;
			console.log(
				`MISMATCH ${node.id}: openalex=${node.citedByCount} s2=${check.s2Citations} · ${node.title.slice(0, 60)}`,
			);
		}
		if (check.refsAdded > 0) {
			console.log(`BACKFILL ${node.id}: +${check.refsAdded} links · ${node.title.slice(0, 60)}`);
		}
	}
	console.log("cross-checked nodes:", checks.size, "mismatched:", mismatched);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
