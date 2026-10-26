/**
 * Evidence a graph build already downloaded that the research tools also cache: SPECTER2 vectors
 * from the Semantic Scholar batch and OpenAlex open-access fields. Clients report it here; with
 * research tools configured, the library stores it so the CLI never fetches it a second time.
 */
export interface FetchedVector { doi: string; paperId: string; vector: number[] }

export interface FetchedEvidence {
	vectors?: FetchedVector[];
	/** OpenAlex works reduced to doi, open_access, best_oa_location and locations. */
	works?: Array<Record<string, unknown>>;
}

let sink: ((evidence: FetchedEvidence) => void) | null = null;

export function setFetchedEvidenceSink(next: ((evidence: FetchedEvidence) => void) | null): void { sink = next; }

export function reportFetched(evidence: FetchedEvidence): void {
	if (!sink || !(evidence.vectors?.length || evidence.works?.length)) return;
	try { sink(evidence); } catch { /* Caching is an optimization; the graph never depends on it. */ }
}

const OA_FIELDS = ["open_access", "best_oa_location", "locations"] as const;

/** The open-access part of OpenAlex works that carry a DOI and the open-access fields. */
export function openAccessWorks(json: unknown): Array<Record<string, unknown>> {
	const items = json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results) ? (json as { results: unknown[] }).results : [json];
	return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && typeof (item as { doi?: unknown }).doi === "string" && "open_access" in item)
		.map(item => Object.fromEntries([["doi", item.doi], ...OA_FIELDS.map(field => [field, item[field] ?? null])]) as Record<string, unknown>);
}
