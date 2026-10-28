import { mountGraphApp } from "../../src/app";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { saveGraphSnapshot } from "../../src/project-state";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Runs in a browser or Obsidian against isolated in-memory settings and a controlled library service. */
export async function verifyIntegratedWorkflow(root: HTMLElement): Promise<string> {
	const node = (id: string, title: string, updatedYear: number): PaperNode => ({ id, title, isSeed: true, origin: "seed", doiUrl: null, year: updatedYear, citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "Held abstract", openAlexUrl: `https://openalex.org/${id}`, language: "en", workType: "article", venue: null, retracted: false, concepts: [] });
	const snapshotOf = (seed: PaperNode) => saveGraphSnapshot({ nodes: [seed], edges: [], seedScore: new Map(), warnings: [], strategies: { references: false, citations: false, related: false }, referenceLists: new Map(), catalog: [seed], skippedNonResearch: 0 });
	const older = node("W1", "Older citation seed", 2000), newer = node("W2", "Newer citation seed", 2010);
	const settings = { ...structuredClone(DEFAULT_SETTINGS), s2Reconcile: false };
	settings.researchProjects.W1 = { version: 1, seedId: "W1", name: "Older graph", updatedAt: 1, views: [], snapshot: snapshotOf(older) };
	settings.researchProjects.W2 = { version: 1, seedId: "W2", name: "Newer graph", updatedAt: 2, views: [], snapshot: snapshotOf(newer) };
	const saved = JSON.stringify(settings.researchProjects.W2.snapshot?.nodes);
	let networkCalls = 0;
	const handle = mountGraphApp(root, {
		getSettings: () => settings,
		getJson: async () => { networkCalls++; throw new Error("Unexpected network request"); },
		openExternal() {}, persistSettings: async () => {},
		saveProject: project => { settings.researchProjects[project.seedId] = project; },
		loadSavedProject: () => settings.researchProjects.W2 ?? null,
		researchLibrary: () => ({ read: () => ({ doi: null, local: { state: "note-only", note: "Research/Papers/Result.md", files: [] }, providers: {} }), check: async () => { throw new Error("Unexpected provider request"); }, open() {},
			textLibrary: async () => [{ note: "Research/Papers/Result.md", paper: node("W3", "Result", 2020) }],
			libraryPapers: () => [{ path: "Research/Papers/Result.md", title: "Result" }] }),
	});
	const graphs = () => root.querySelector<HTMLSelectElement>(".cpo-project-group > .cpo-project-select:not(.cpo-view-select)")!;
	try {
		check(!root.querySelector('[aria-label="Explore method"]'), "the workspace has no method selector");
		check(!root.querySelector(".cpo-question-group, .cpo-explore-query, .cpo-index-pdfs"), "question, screening and PDF-search controls are gone");
		check(graphs().value === "W2", "the most recently updated saved graph opens");
		check(Array.from(graphs().options).map(option => option.value).filter(Boolean).join() === "W2,W1", "every saved graph is listed, newest first");
		handle.openSimilar("Research/Papers/Result.md");
		check(root.querySelector('[data-layout="radial"]')?.getAttribute("aria-pressed") === "true", "library similarity opens the shared Similarity map");
		check(root.querySelector<HTMLInputElement>(".cpo-input")?.value === "Result", "the library paper becomes the similarity source");
		await new Promise(resolve => setTimeout(resolve, 0));
		check(root.querySelector(".cpo-status")?.textContent?.includes("No comparison papers"), "a local source loads in the shared map without a network request");
		root.querySelector<HTMLButtonElement>('[data-layout="force2d"]')!.click();
		check(graphs().value === "W2" && root.querySelector('[data-layout="force2d"]')?.getAttribute("aria-pressed") === "true", "returning to Network retains its citation graph");
		check(JSON.stringify(settings.researchProjects.W2?.snapshot?.nodes) === saved, "similarity results never overwrite the citation snapshot");
		check(networkCalls === 0, "opening a library source does not fetch citation data");
		return "PASS: unified workspace, saved graph list, library similarity source, citation preservation";
	} finally { handle.destroy(); }
}
