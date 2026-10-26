import { mountSimilarityExplorer } from "../../src/similarity-explorer";
import { createComparisonCitations } from "../../src/workflow/comparison-citations";
import { OpenAlexClient, OpenAlexError } from "../../src/openalex";
import type { SimilarityGraph } from "../../src/neighborhood";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function verifyCitationComparison(root: HTMLElement, seed: PaperNode): Promise<void> {
	const local = { ...seed, id: "local:paper", isSeed: false, doiUrl: "https://doi.org/10.1234/local", openAlexUrl: "" };
	const graph: SimilarityGraph = { nodes: [seed, local], catalog: [], edges: [], referenceLists: new Map([[seed.id, ["W99"]]]),
		seedScore: new Map(), warnings: [], skippedNonResearch: 0, strategies: { references: true, citations: true, related: false } };
	const before = JSON.stringify([...graph.referenceLists]);
	let fail = true, calls = 0, paints = 0, kind: "text" | "citations" = "text";
	let release!: () => void;
	const pending = new Promise<void>(resolve => { release = resolve; });
	const client = new OpenAlexClient(async () => {
		calls++; await pending;
		if (fail) throw new Error("temporary source failure");
		return { id: "https://openalex.org/W2", referenced_works: ["https://openalex.org/W99", seed.openAlexUrl] };
	}, { apiKey: "", contactEmail: "" });
	const stage = document.createElement("div"); root.append(stage);
	const evidence: [] = [];
	const explorer = mountSimilarityExplorer(stage, () => null, () => { paints++; paint(); }, () => {}, undefined, createComparisonCitations(() => client));
	const paint = () => explorer.update(graph, evidence, true, kind);
	try {
		paint(); check(calls === 0, "Text mode must not request citation evidence");
		kind = "citations"; paint(); paint();
		check(Number(calls) === 1 && explorer.status?.text.includes("Loading citation data"), "Citations mode must load displayed library references once and expose pending state");
		kind = "text"; paint(); release();
		for (let i = 0; i < 30 && paints === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
		check(explorer.result?.graph.nodes[0]?.id === seed.id, "completion while viewing Text must retain the comparison center");
		kind = "citations"; paint();
		const retry = Array.from(stage.querySelectorAll("button")).find(button => button.textContent === "Retry citation data")!;
		check(!retry.hidden && explorer.status?.text.includes("failed to load"), "citation load failure must be visible and retryable");
		fail = false; retry.click();
		for (let i = 0; i < 30 && !explorer.result?.scores.citations.has(local.id); i++) await new Promise(resolve => setTimeout(resolve, 5));
		check(explorer.result?.scores.citations.has(local.id), "retry must give a DOI-only library paper a real citation score");
		check(explorer.result?.graph.edges.some(edge => edge.direct !== "none" && [edge.source, edge.target].includes(local.id)), "reference evidence must generate actual citation connections for local identities");
		check(retry.hidden && !explorer.status?.text.includes("Citation evidence:") && !explorer.status?.text.includes("Loading citation data"), "successful citation retrieval must clear transient status without a redundant coverage summary");
		const count = calls; kind = "text"; paint(); kind = "citations"; paint();
		check(calls === count, "mode switches must reuse successful evidence");
		check(JSON.stringify([...graph.referenceLists]) === before && graph.nodes[1] === local && graph.edges.length === 0, "transient comparison evidence must not mutate the saved project");
	} finally { explorer.destroy(); stage.remove(); }
	let requests = 0, active = 0, maximum = 0, retryFailure = true;
	const load = createComparisonCitations(() => new OpenAlexClient(async url => {
		requests++;
		if (new URL(url).searchParams.has("filter")) return { results: [{ id: "https://openalex.org/W2", referenced_works: ["https://openalex.org/W99"] }] };
		active++; maximum = Math.max(maximum, active);
		await new Promise(resolve => setTimeout(resolve, 5)); active--;
		if (url.includes("absent")) throw new OpenAlexError("Not indexed", 404);
		if (url.includes("retry") && retryFailure) throw new OpenAlexError("Unavailable", 503);
		return { id: "https://openalex.org/W8", referenced_works: ["https://openalex.org/W99"] };
	}, { apiKey: "", contactEmail: "" }));
	const candidates = ["W2", "W3", "absent", "retry", "other", "last"].map(id => ({ ...local, id,
		doiUrl: /^W/.test(id) ? null : `https://doi.org/10.1234/${id}` }));
	const pool = { ...graph, nodes: [seed, ...candidates] };
	const loaded = await load(pool);
	check(loaded.failed === 1 && maximum === 3, "citation lookups must bound DOI concurrency and distinguish provider misses from failures");
	check(loaded.graph.referenceLists.has("W2") && !loaded.graph.referenceLists.has("W3"), "batch ID lookups must only attach records actually returned by the provider");
	const firstRequests = requests; retryFailure = false;
	const retried = await load(pool);
	check(retried.failed === 0 && requests === firstRequests + 1, "retry must reuse successful, empty and not-indexed lookups and request only failed papers");
}
