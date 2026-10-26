import { mountGraphApp } from "../../src/app";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { saveGraphSnapshot } from "../../src/project-state";
import type { DiscoveryPayload, DiscoveryRequest } from "../../src/discovery-graph";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

/** Runs in a browser or Obsidian against isolated in-memory settings and a controlled bridge. */
export async function verifyIntegratedWorkflow(root: HTMLElement): Promise<string> {
	const first = "Research/Questions/First.md", second = "Research/Questions/Second.md";
	const seed: PaperNode = { id: "W1", title: "Original citation seed", isSeed: true, origin: "seed", doiUrl: null, year: 2000, citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "Held abstract", openAlexUrl: "https://openalex.org/W1", language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const snapshot = saveGraphSnapshot({ nodes: [seed], edges: [], seedScore: new Map(), warnings: [], strategies: { references: false, citations: false, related: false }, referenceLists: new Map(), catalog: [seed], skippedNonResearch: 0 });
	const settings = { ...structuredClone(DEFAULT_SETTINGS), activeQuestion: first, s2Reconcile: false };
	settings.researchProjects.W1 = { version: 1, seedId: "W1", name: "Original graph", updatedAt: 1, questionPaths: [first], views: [], snapshot };
	const requests: Array<{ request: DiscoveryRequest; resolve: (payload: DiscoveryPayload) => void }> = [];
	let networkCalls = 0;
	const handle = mountGraphApp(root, {
		getSettings: () => settings,
		getJson: async () => { networkCalls++; throw new Error("Unexpected network request"); },
		openExternal() {}, persistSettings: async () => {},
		saveProject: project => { settings.researchProjects[project.seedId] = project; },
		libraryBridge: () => ({ version: 1, read: () => ({ doi: null, local: { state: "note-only", note: "Research/Papers/Result.md", files: [] }, providers: {} }), check: async () => { throw new Error("Unexpected provider request"); }, open() {}, discovery: {
			context: () => ({ questions: [{ path: first, title: "First" }, { path: second, title: "Second" }], papers: [] }),
			run: request => new Promise(resolve => requests.push({ request: structuredClone(request), resolve })),
		} }),
	});
	const select = (label: string) => root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
	const mode = (value: string) => { const input = select("Explore method"); input.value = value; input.dispatchEvent(new Event("change")); };
	const run = () => root.querySelector<HTMLButtonElement>(".cpo-explore-tools .cpo-primary")!.click();
	const payload = (question: string, title: string): DiscoveryPayload => ({ engine: "asreview", mode: "rank", question, papers: [{ title, note: "Research/Papers/Result.md", priority: 85, rank: 1 }] });
	try {
		const canvas = root.querySelector("canvas");
		mode("rank");
		const count = root.querySelector<HTMLInputElement>('input[aria-label="Discovery paper limit"]')!;
		const presets = select("Choose discovery paper limit preset");
		check(count.type === "number" && count.value === "30" && count.closest(".cpo-count-field"), "discovery uses the shared editable Show control");
		count.value = "17"; count.dispatchEvent(new Event("change"));
		check(Number(count.value) === 17, "discovery accepts a custom count");
		count.value = "500"; count.dispatchEvent(new Event("change"));
		check(Number(count.value) === 100, "custom discovery counts respect the workflow limit");
		count.value = ""; count.dispatchEvent(new Event("change"));
		check(Number(count.value) === 30, "empty counts restore the workflow default");
		presets.value = "50"; presets.dispatchEvent(new Event("change"));
		check(Number(count.value) === 50 && presets.value === "", "presets update the editable count and reset the arrow");
		run();
		check(count.disabled && presets.disabled, "both count controls disable during discovery");
		check(root.querySelector<HTMLButtonElement>('[data-layout="radial"]')?.disabled, "screening priorities must not be presented as similarity distances");
		for (const element of Array.from(root.querySelectorAll<HTMLElement>(".cpo-explore-tools [hidden]"))) check(getComputedStyle(element).display === "none", "irrelevant method controls must be visually hidden");
		check(requests[0]?.request.question === first, "ranking must inherit the workspace question");
		select("Research question").value = second; select("Research question").dispatchEvent(new Event("change"));
		requests[0]!.resolve(payload(first, "Stale result from previous question")); await tick();
		check(!root.textContent?.includes("Stale result from previous question"), "late results must not cross question boundaries");
		run(); requests[1]!.resolve(payload(second, "Current ranked paper")); await tick();
		check(root.querySelector(".cpo-detail")?.textContent?.includes("ASReview") || root.textContent?.includes("ASReview priority percentile"), "ranking must appear in the main details panel");
		check(!count.disabled && !presets.disabled, "both count controls recover after discovery");
		check(root.querySelector("canvas") === canvas && root.querySelectorAll("canvas").length === 1, "discovery must reuse the main canvas");
		check(root.querySelector<HTMLElement>(".cpo-project-group:not(.cpo-question-group)")?.hidden, "citation graph controls must be hidden for local results");
		check(root.querySelector<HTMLInputElement>(".cpo-diversify-results")?.disabled, "diversity must be disabled for local discovery results");
		mode("search");
		root.querySelector<HTMLButtonElement>(".cpo-explore-tools .cpo-ghost")!.click();
		check(requests[2]?.request.action === "index" && requests[2]!.request.question === second && requests[2]!.request.selection?.[0]?.title === "Current ranked paper", "PDF indexing must reuse this question's ranking");
		requests[2]!.resolve({ engine: "paperqa", mode: "index", indexed: 1, question: second, papers: [] }); await tick();
		const query = root.querySelector<HTMLInputElement>(".cpo-explore-query input")!; query.value = "pacemaker";
		run(); check(requests[3]?.request.query === "pacemaker" && requests[3]!.request.question === second && !requests[3]!.request.paper, "PDF retrieval must use the shared question and entered query");
		requests[3]!.resolve({ engine: "paperqa", mode: "search", question: second, query: "pacemaker", papers: [{ title: "Retrieved local PDF", note: "Research/Papers/Result.md", rank: 1 }] }); await tick();
		check(root.textContent?.includes("PaperQA2 retrieval rank: 1"), "PDF retrieval must use the same details panel");
		mode("rank"); check(requests.length === 4 && root.textContent?.includes("Current ranked paper"), "switching methods must reuse session results");
		handle.openDiscovery({ question: first, mode: "rank" }); mode("citation");
		check(root.querySelector<HTMLSelectElement>(".cpo-project-group:not(.cpo-question-group) > .cpo-project-select:not(.cpo-view-select)")!.value === "W1", "returning to citation mode must restore its graph");
		check(JSON.stringify(settings.researchProjects.W1!.snapshot?.nodes) === JSON.stringify(snapshot.nodes), "local results must never overwrite the citation snapshot");
		check(networkCalls === 0, "local mode switches must not fetch citation data");
		handle.openDiscovery({ payload: { engine: "asreview", mode: "similar", scoring: "specter2+words-v1",
			source: { title: "Comparison source", note: "Research/Papers/Source.md" },
			papers: [{ title: "Semantic neighbor", note: "Research/Papers/Neighbor.md", similarity: 62.5,
				text_comparison: { score: 0.625, method: "specter2+words", lexical: 0.25, embedding: 0.75 } }] } });
		root.querySelector<HTMLButtonElement>('[data-layout="radial"]')!.click();
		check(!root.querySelector<HTMLButtonElement>('[data-similarity="citations"]')?.disabled, "local papers can remain visible in Citations with unavailable evidence");
		check(root.querySelector(".cpo-detail")?.textContent?.includes("SPECTER2") && root.querySelector(".cpo-detail")?.textContent?.includes("0.63"), "local details expose the actual SPECTER2 scoring method and decimal score");
		root.querySelector<HTMLButtonElement>('[data-similarity="citations"]')!.click();
		check(root.querySelector(".cpo-detail")?.textContent?.includes("Citation similarity: unavailable"), "membership edges never become citation similarity claims");
		mode("rank"); run(); handle.destroy(); requests[4]!.resolve(payload(first, "Result after disposal")); await tick();
		check(root.childElementCount === 0, "disposed workspaces must ignore late results");
		return "PASS: shared canvas and question, ranking and PDF details, scoped indexing, session reuse, stale-result guards, citation preservation, cleanup";
	} finally { handle.destroy(); }
}
