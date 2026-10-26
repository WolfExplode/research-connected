import type { GetJson } from "./openalex";
import { normalizeDoi } from "./paper";
import { limitedRequest } from "./provider-limits";
import type { PaperNode } from "./types";
import { paperDois } from "./work-identity";

export interface DoiCandidate {
	doi: string;
	title: string;
	year: number | null;
	authors: string[];
	venue: string;
	volume: string;
	firstPage: string;
	source: "Crossref" | "Europe PMC";
}
export interface DoiRecovery {
	state: "found" | "not-found" | "ambiguous";
	checkedAt: number;
	candidates: DoiCandidate[];
}

const normalized = (value: string): string => value.normalize("NFKC").toLowerCase().replace(/<[^>]*>/g, " ").replace(/&amp;/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const surname = (value: string): string => normalized(value).split(" ").at(-1) ?? "";
const firstAuthor = (paper: PaperNode): string => paper.authorList[0] ?? paper.authors.split(/[,;·]/)[0]!.replace(/\bet\s+al\.?|…|\.\.\./gi, "").trim();
const text = (value: unknown): string => typeof value === "string" ? value : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Versioned bibliographic key: changing a paper's metadata invalidates its old lookup. */
export function doiRecoveryKey(paper: PaperNode): string {
	return JSON.stringify([1, paper.id, normalized(paper.title), paper.year, firstAuthor(paper), paper.venue, paper.bibliography]);
}

/** Full title equality avoids accepting shortened titles, corrections, and near-identical trials. */
export function corroboratesDoi(paper: PaperNode, candidate: DoiCandidate): boolean {
	const title = normalized(paper.title);
	if (title.length < 24 || title.split(" ").length < 4 || title !== normalized(candidate.title)) return false;
	if (!paper.year || !candidate.year || Math.abs(paper.year - candidate.year) > 1) return false;
	const first = surname(firstAuthor(paper));
	const author = first.length > 1 && surname(candidate.authors[0] ?? "") === first;
	const b = paper.bibliography;
	// OpenAlex's venue can name a repository instead of the journal. Volume and page
	// still corroborate an exact full title and year, including group-authored trials.
	const bibliography = Boolean(b?.volume && b.firstPage && normalized(b.volume) === normalized(candidate.volume)
		&& normalized(b.firstPage) === normalized(candidate.firstPage));
	return author || bibliography;
}

export function cachedDoiRecovery(paper: PaperNode, cache: Record<string, DoiRecovery> | undefined, now = Date.now()): DoiRecovery | null {
	const result = cache?.[doiRecoveryKey(paper)];
	if (!result || !Array.isArray(result.candidates) || !Number.isFinite(result.checkedAt)) return null;
	if (!result.candidates.every(candidate => candidate && typeof candidate.doi === "string" && typeof candidate.title === "string"
		&& (candidate.year === null || typeof candidate.year === "number") && Array.isArray(candidate.authors) && candidate.authors.every(name => typeof name === "string")
		&& typeof candidate.venue === "string" && typeof candidate.volume === "string" && typeof candidate.firstPage === "string"
		&& ["Crossref", "Europe PMC"].includes(candidate.source))) return null;
	const existing = paperDois(paper);
	if (result.state === "found" && existing.length && !existing.includes(normalizeDoi(result.candidates[0]?.doi) ?? "")) return null;
	if (result.state === "found") return result.candidates.length === 1 && normalizeDoi(result.candidates[0]!.doi)
		&& corroboratesDoi(paper, result.candidates[0]!) ? result : null;
	return ["not-found", "ambiguous"].includes(result.state) && now >= result.checkedAt && now - result.checkedAt < 86400000 ? result : null;
}

export function applyRecoveredDoi(paper: PaperNode, result: DoiRecovery | null): void {
	if (!result || result.state !== "found" || paperDois(paper).length) return;
	const candidate = result.candidates[0];
	const doi = normalizeDoi(candidate?.doi);
	if (!candidate || !doi || !corroboratesDoi(paper, candidate)) return;
	paper.doiUrl = `https://doi.org/${doi}`;
	// Keep the representative's source record consistent without assigning a DOI to every alias.
	const record = paper.records?.find(record => record.id === paper.id);
	if (record && !record.doiUrl) record.doiUrl = paper.doiUrl;
}

/** Two bounded metadata queries; transport errors never become cached negative matches. */
export async function recoverDoi(paper: PaperNode, getJson: GetJson, contactEmail: string): Promise<DoiRecovery> {
	const candidates: DoiCandidate[] = [];
	let failure: unknown;
	const get = (url: URL) => limitedRequest(url.href, () => getJson(url.href, { headers: { Accept: "application/json" } }));
	try {
		const url = new URL("https://api.crossref.org/works");
		url.searchParams.set("query.bibliographic", [paper.title, firstAuthor(paper), paper.year, paper.venue, paper.bibliography?.volume, paper.bibliography?.firstPage].filter(Boolean).join(" "));
		url.searchParams.set("rows", "5");
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) url.searchParams.set("mailto", contactEmail);
		const items = object(object(await get(url)).message).items;
		if (!Array.isArray(items)) throw new Error("Invalid Crossref metadata response");
		for (const value of items) {
			const row = object(value), doi = normalizeDoi(text(row.DOI));
			if (!doi || (paper.workType === "article" && row.type !== "journal-article")) continue;
			const dates = object(row.published)["date-parts"];
			const year = Array.isArray(dates) && Array.isArray(dates[0]) && typeof dates[0][0] === "number" ? dates[0][0] : null;
			candidates.push({ doi, title: strings(row.title)[0] ?? "", year,
				authors: Array.isArray(row.author) ? row.author.map(value => text(object(value).family)) : [],
				venue: strings(row["container-title"])[0] ?? "", volume: text(row.volume), firstPage: text(row.page).split(/[-–]/)[0] ?? "", source: "Crossref" });
		}
	} catch (error) { failure = error; }
	let matches = candidates.filter(candidate => corroboratesDoi(paper, candidate));
	if (!matches.length) {
		try {
			const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
			url.searchParams.set("query", `TITLE:"${paper.title.replace(/["\\]/g, " ")}"`);
			url.searchParams.set("format", "json"); url.searchParams.set("pageSize", "5");
			const items = object(object(await get(url)).resultList).result;
			if (!Array.isArray(items)) throw new Error("Invalid Europe PMC metadata response");
			for (const value of items) {
				const row = object(value), doi = normalizeDoi(text(row.doi));
				if (!doi) continue;
				candidates.push({ doi, title: text(row.title).replace(/\.$/, ""), year: Number(row.pubYear) || null,
					authors: text(row.authorString).split(",").map(name => name.trim().split(/\s+/)[0] ?? ""),
					venue: text(row.journalTitle), volume: text(row.journalVolume), firstPage: text(row.pageInfo).split(/[-–]/)[0] ?? "", source: "Europe PMC" });
			}
		} catch (error) { failure = error; }
		matches = candidates.filter(candidate => corroboratesDoi(paper, candidate));
	}
	const unique = [...new Map(matches.map(candidate => [candidate.doi, candidate])).values()];
	if (!unique.length && failure) throw failure instanceof Error ? failure : new Error("DOI metadata lookup failed");
	return { state: unique.length === 1 ? "found" : unique.length > 1 ? "ambiguous" : "not-found", checkedAt: Date.now(), candidates: unique.slice(0, 5) };
}
