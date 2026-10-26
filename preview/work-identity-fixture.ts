import type { SavedGraphSnapshot } from "../src/project-state";
import type { PaperNode } from "../src/types";
import type { GetJson, RawWork } from "../src/openalex";

export function nicholsSnapshot(): SavedGraphSnapshot {
	const seed: PaperNode = {
		id: "W4245234602", title: "Head-Marking and Dependent-Marking Grammar", year: 1986,
		authors: "Johanna Nichols", authorList: ["Johanna Nichols"], citedByCount: 404,
		abstract: "", doiUrl: "https://doi.org/10.2307/415601", openAlexUrl: "https://openalex.org/W4245234602",
		isSeed: true, origin: "seed", language: "en", workType: "article", venue: "Language",
		bibliography: { volume: "62", issue: "1", firstPage: "56", lastPage: "119" }, concepts: [], retracted: false,
	};
	const alias: PaperNode = { ...seed, id: "W2027889013", title: seed.title.toLowerCase(),
		doiUrl: "https://doi.org/10.1353/lan.1986.0014", openAlexUrl: "https://openalex.org/W2027889013",
		isSeed: false, origin: "reference", citedByCount: 1292 };
	return {
		version: 2, savedAt: 1, seedId: seed.id, nodes: [seed, alias], catalog: [seed, alias],
		edges: [{ source: seed.id, target: alias.id, weight: 1, sharedRefs: 14, coupling: 0.5, coCitation: 0, coCitedBy: 0, direct: "none" }],
		seedScore: [[seed.id, 1], [alias.id, 0.8]], warnings: [],
		strategies: { references: true, citations: true, related: true },
		referenceLists: [[seed.id, Array.from({ length: 16 }, (_, i) => `W${100 + i}`)],
			[alias.id, Array.from({ length: 49 }, (_, i) => `W${102 + i}`)]],
		citationEvidence: [], skippedNonResearch: 0,
	};
}


export const workIdentityFixtureGet: GetJson = async (url) => {
	if (url.includes("opencitations")) return [];
	const snapshot = nicholsSnapshot();
	const [seed, alias] = snapshot.nodes as [PaperNode, PaperNode];
	const raw = (paper: PaperNode): RawWork => ({
		id: paper.openAlexUrl, doi: paper.doiUrl, display_name: paper.title, publication_year: paper.year ?? undefined,
		type: paper.workType ?? undefined, authorships: paper.authorList.map((name) => ({ author: { display_name: name } })),
		primary_location: { source: { display_name: paper.venue ?? undefined } },
		biblio: { volume: paper.bibliography?.volume, issue: paper.bibliography?.issue, first_page: paper.bibliography?.firstPage, last_page: paper.bibliography?.lastPage },
		referenced_works: snapshot.referenceLists.find(([id]) => id === paper.id)?.[1], cited_by_count: paper.citedByCount,
	});
	const query = new URL(url), filter = query.searchParams.get("filter") ?? "";
	if (query.pathname !== "/works") return raw(decodeURIComponent(query.pathname).includes(alias.id) || decodeURIComponent(query.pathname).includes("10.1353/lan.1986.0014") ? alias : seed);
	if (filter.startsWith("openalex:")) return { results: snapshot.nodes.filter((paper) => filter.includes(paper.id)).map(raw) };
	return { results: filter.startsWith("cited_by:") ? [raw(alias)] : [], meta: { next_cursor: null } };
};
