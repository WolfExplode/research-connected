import { mountGraphApp } from "../../src/app";
import { mountEmbed } from "../../src/embed-mount";
import { OpenAlexClient } from "../../src/openalex";
import { createLiteratureSearch, literatureQuery } from "../../src/workflow/literature-search";
import { mountSimilarityExplorer } from "../../src/similarity-explorer";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { saveGraphSnapshot } from "../../src/project-state";
import { fixtureGet } from "../../preview/fixture";
import type { SimilarityGraph } from "../../src/neighborhood";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(test: () => boolean): Promise<void> {
	const end = Date.now() + 8000;
	while (!test()) { if (Date.now() > end) throw new Error("Literature test timed out"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
export async function verifyLiterature(root: HTMLElement): Promise<void> {
	const seed: PaperNode = { id: "W1", title: "Cardiac fitness", abstract: "Autonomic modulation in children", isSeed: true,
		origin: "seed", doiUrl: "https://doi.org/10.1234/seed", year: 2020, authors: "Author", authorList: ["Author"],
		citedByCount: 1, openAlexUrl: "https://openalex.org/W1", language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const graph: SimilarityGraph = { nodes: [seed], edges: [], catalog: [seed], referenceLists: new Map(), seedScore: new Map([[seed.id, 1]]),
		warnings: [], skippedNonResearch: 0, strategies: { references: false, citations: false, related: false } };
	check(literatureQuery({ ...seed, title: "x".repeat(2500) }).length === 1500, "semantic input respects the provider character cap");
	const remote = { id: "https://openalex.org/W90", display_name: "Cardiac fitness and autonomic modulation", doi: "https://doi.org/10.1234/new", type: "article" };
	const stage = document.createElement("div"); root.append(stage);
	let calls = 0, fail = false, resolve!: (value: unknown) => void;
	const search = createLiteratureSearch(() => new OpenAlexClient(async (url, init) => {
		calls++; const request = new URL(url);
		check(request.searchParams.get("search.semantic") === "Cardiac fitness Autonomic modulation in children", "wider retrieval uses source title and abstract");
		check(request.searchParams.get("per_page") === "50" && !request.searchParams.has("filter"), "semantic retrieval searches beyond citation filters and caps the provider request");
		check(init.headers.Authorization === "Bearer fixture-key" && !url.includes("fixture-key"), "semantic search uses the existing authenticated HTTP adapter");
		if (fail) throw new Error("Temporary failure");
		return new Promise(done => { resolve = done; });
	}, { apiKey: "fixture-key", contactEmail: "" }), () => true);
	const local = { ...seed, id: "local:neighbor", isSeed: false, doiUrl: remote.doi };
	let kind: "text" | "citations" = "text";
	const explorer = mountSimilarityExplorer(stage, () => ({ version: 1, read: () => ({ doi: null, local: { state: "absent", note: null, files: [] }, providers: {} }),
		check: async () => { throw new Error("Unexpected request"); }, open() {}, textLibrary: async () => [{ paper: local, note: "Research/Papers/Neighbor.md" }] }),
		() => paint(), () => {}, undefined, undefined, { literature: search });
	const paint = () => explorer.update(graph, [], true, kind);
	try {
		paint(); await until(() => explorer.result?.compared === 1);
		explorer.setScope("both"); await until(() => calls === 1);
		check(explorer.status?.kind === "busy", "wider literature exposes pending state");
		resolve({ results: [remote, { ...remote, id: "https://openalex.org/W91" }, { ...remote, id: seed.openAlexUrl, doi: seed.doiUrl },
			{ ...remote, id: "https://openalex.org/W92", doi: "https://doi.org/10.1234/retracted", is_retracted: true },
			{ ...remote, id: "https://openalex.org/W93", doi: "https://doi.org/10.1234/editorial", type: "editorial" }] });
		await until(() => explorer.status?.kind === "summary");
		check(explorer.result?.compared === 1 && explorer.result.graph.nodes.some(paper => paper.id === "W90"), "new literature is retrieved, deduplicated with library holdings, and filtered");
		const members = explorer.result!.graph.nodes.map(paper => paper.id).join(",");
		kind = "citations"; paint(); kind = "text"; paint();
		check(calls === 1 && explorer.result!.graph.nodes.map(paper => paper.id).join(",") === members, "comparison switches retain candidate membership and cached retrieval");
		explorer.setScope("library"); explorer.setScope("both");
		check(calls === 1, "scope switches reuse the session result");
		fail = true; explorer.refresh(); await until(() => explorer.status?.kind === "error");
		const retry = Array.from(stage.querySelectorAll("button")).find(button => button.textContent === "Retry literature search")!;
		check(!retry.hidden, "provider failure exposes a retry action");
		fail = false; retry.click(); await until(() => calls === 3);
		paint(); explorer.update(graph, [], false);
		resolve({ results: [remote] }); await new Promise(done => setTimeout(done, 20));
		check(explorer.result === null && graph.nodes.length === 1 && graph.edges.length === 0, "late results never reactivate a closed search or change the saved graph");
	} finally { explorer.destroy(); stage.remove(); }

	const staleStage = document.createElement("div"); root.append(staleStage);
	const completions: Array<(papers: readonly PaperNode[]) => void> = [];
	let current = graph;
	const secondSeed = { ...seed, id: "W2", title: "Different source", doiUrl: "https://doi.org/10.1234/second" };
	const staleExplorer = mountSimilarityExplorer(staleStage, () => null, () => { staleExplorer.update(current, [], true); }, () => {}, undefined, undefined,
		{ literature: () => new Promise(done => completions.push(done)) });
	try {
		staleExplorer.update(current, [], true);
		current = { ...graph, nodes: [secondSeed], catalog: [secondSeed] };
		staleExplorer.update(current, [], true);
		completions[0]!([{ ...seed, id: "W80", isSeed: false, title: "Stale candidate" }]);
		await new Promise(done => setTimeout(done, 0));
		check(staleExplorer.status?.kind === "busy" && !staleExplorer.result?.graph.nodes.some(paper => paper.id === "W80"), "an old source completion cannot enter the new candidate pool");
		completions[1]!([]); await new Promise(done => setTimeout(done, 0));
		check(staleExplorer.result?.compared === 0 && staleExplorer.status?.text.includes("No comparison papers"), "a successful empty literature query has an explicit empty state");
	} finally { staleExplorer.destroy(); staleStage.remove(); }

	const settings = { ...structuredClone(DEFAULT_SETTINGS), s2Reconcile: false };
	const project = { version: 1 as const, seedId: seed.id, name: seed.title, updatedAt: 1, views: [], snapshot: saveGraphSnapshot(graph) };
	settings.researchProjects.W1 = project;
	const before = JSON.stringify(project.snapshot);
	let semanticCalls = 0;
	const getJson: typeof fixtureGet = async (url, init) => {
		if (new URL(url).searchParams.has("search.semantic")) { semanticCalls++; return { results: [remote] }; }
		return fixtureGet(url, init);
	};
	const handle = mountGraphApp(root, { getSettings: () => settings, getJson, openExternal() {}, loadSavedProject: () => project });
	const layout = (mode: string) => root.querySelector<HTMLButtonElement>(`[data-layout="${mode}"]`)!.click();
	try {
		layout("radial"); layout("temporal");
		check(semanticCalls === 0, "layouts alone never search wider literature");
		const method = root.querySelector<HTMLSelectElement>('[aria-label="Explore method"]')!;
		check(Array.from(method.options).map(option => option.text).join("|") === "Explore citations|Find similar papers|Screen papers|Search PDFs", "top-level tasks have one similarity entry and no engine names");
		method.value = "similar"; method.dispatchEvent(new Event("change"));
		check(root.querySelector<HTMLButtonElement>(".cpo-form .cpo-primary")?.disabled, "the same query cannot be repeatedly submitted while retrieval is pending");
		await until(() => root.querySelector(".cpo-status")?.textContent?.includes("Compared 1") ?? false);
		const summary = root.querySelector(".cpo-status")?.textContent;
		check(root.querySelector(".cpo-similarity-toolbar")?.closest(".cpo-project-tools"), "similarity criteria live beside the task controls");
		layout("force2d"); layout("radial"); layout("temporal");
		check(Number(semanticCalls) === 1 && root.querySelector(".cpo-status")?.textContent === summary, "layouts preserve the retrieved pool without new requests");
		method.value = "citation"; method.dispatchEvent(new Event("change"));
		check(JSON.stringify(settings.researchProjects.W1!.snapshot) === before, "transient literature results preserve the citation project snapshot");
		check(root.querySelector<HTMLElement>(".cpo-similarity-toolbar")?.hidden, "citation exploration does not retain similarity search controls");
	} finally { handle.destroy(); }
	const destroy = mountEmbed(root, { source: "doi: 10.1234/seed\nlayout: radial", getSettings: () => settings, getJson, openExternal() {} });
	try {
		await until(() => Boolean(root.querySelector(".cpo-paper-identity")));
		const beforeSearch = semanticCalls;
		root.querySelector<HTMLButtonElement>('[data-layout="force2d"]')!.click();
		check(semanticCalls === beforeSearch, "embed layouts also preserve the citation pool");
		const method = root.querySelector<HTMLSelectElement>('[aria-label="Explore method"]')!;
		method.value = "similar"; method.dispatchEvent(new Event("change"));
		await until(() => semanticCalls > beforeSearch && root.querySelector(".cpo-status")?.textContent?.includes("Compared 1") === true);
	} finally { destroy(); }
}
