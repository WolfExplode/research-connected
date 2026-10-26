import type { OpenAlexClient } from "../openalex";
import { nonResearchLabel, normalizeDoi, toPaper } from "../paper";
import type { PaperNode } from "../types";

// Shared across pane/embed instances: OpenAlex semantic search permits one request/second.
let nextRequest = 0;
export function literatureQuery(paper: PaperNode): string {
	return `${paper.title.trim()} ${paper.abstract.trim()}`.replace(/\s+/g, " ").trim().slice(0, 2000);
}

/** Session cache only; failures remain retryable and no library text is written to disk. */
export function createLiteratureSearch(client: () => OpenAlexClient, excludeRetracted: () => boolean) {
	const cache = new Map<string, Promise<readonly PaperNode[]>>();
	return (paper: PaperNode, refresh = false): Promise<readonly PaperNode[]> => {
		const query = literatureQuery(paper), exclude = excludeRetracted();
		if (!query) return Promise.reject(new Error("Choose a source paper with a title or abstract."));
		const key = `${exclude}:${query}`;
		if (refresh) cache.delete(key);
		let result = cache.get(key);
		if (!result) {
			const wait = Math.max(0, nextRequest - Date.now());
			nextRequest = Date.now() + wait + 1000;
			result = (async () => {
				if (wait) await new Promise<void>(resolve => window.setTimeout(resolve, wait));
				const rows = await client().semanticWorks(query);
				const papers = new Map<string, PaperNode>();
				for (const raw of rows.slice(0, 50)) {
					const candidate = toPaper(raw, "related");
					if (!candidate || nonResearchLabel(candidate) || exclude && candidate.retracted) continue;
					const identity = normalizeDoi(candidate.doiUrl) || candidate.id;
					if (!papers.has(identity)) papers.set(identity, candidate);
				}
				return [...papers.values()];
			})();
			cache.set(key, result);
			void result.catch(() => { if (cache.get(key) === result) cache.delete(key); });
			// Bound long-running sessions without evicting the newest request.
			if (cache.size > 20) cache.delete(cache.keys().next().value!);
		}
		return result;
	};
}
