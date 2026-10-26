import assert from "node:assert/strict";
import { applyRecoveredDoi, cachedDoiRecovery, corroboratesDoi, doiRecoveryKey, recoverDoi, type DoiCandidate } from "../../src/doi-recovery";
import type { PaperNode } from "../../src/types";

export async function verifyDoiRecovery(): Promise<void> {
	const paper: PaperNode = { id: "W123", title: "Ventricular function during exercise in healthy adults", year: 1995,
		authorList: ["Jane Smith"], authors: "Jane Smith", venue: "Heart", bibliography: { volume: "74", firstPage: "123" },
		doiUrl: null, openAlexUrl: "https://openalex.org/W123", isSeed: true, origin: "seed", citedByCount: 0,
		abstract: "", language: "en", workType: "article", retracted: false, concepts: [] };
	const candidate: DoiCandidate = { doi: "10.1234/exercise", title: paper.title, year: 1995, authors: ["Smith"],
		venue: "Heart", volume: "74", firstPage: "123", source: "Crossref" };
	assert(corroboratesDoi(paper, candidate));
	assert(corroboratesDoi({ ...paper, authorList: [], authors: "Smith", venue: null, bibliography: undefined }, candidate), "local discovery supplies a filed surname without structured authors");
	assert(corroboratesDoi({ ...paper, authorList: [], authors: "", venue: "University repository" }, { ...candidate, authors: [] }), "volume and first page corroborate group-authored trials held in repositories");
	assert(!corroboratesDoi(paper, { ...candidate, title: "Ventricular function during exercise" }), "partial titles must not match");
	assert(!corroboratesDoi(paper, { ...candidate, title: "Correction: " + paper.title }));
	assert(!corroboratesDoi(paper, { ...candidate, year: 2000 }), "different publication years must not match");
	assert(!corroboratesDoi(paper, { ...candidate, authors: ["Jones"], volume: "75" }));
	assert(!corroboratesDoi({ ...paper, title: "Heart failure" }, { ...candidate, title: "Heart failure" }), "generic short titles need review");
	assert(!corroboratesDoi({ ...paper, year: null }, candidate), "unknown year is insufficient evidence");
	const row = { DOI: candidate.doi, title: [paper.title], published: { "date-parts": [[1995]] },
		author: [{ family: "Smith" }], "container-title": ["Heart"], volume: "74", page: "123-130", type: "journal-article" };
	let calls = 0;
	const found = await recoverDoi(paper, async url => {
		calls++; const query = new URL(url);
		assert.equal(query.hostname, "api.crossref.org");
		assert(query.searchParams.get("query.bibliographic")?.includes(paper.title));
		assert.equal(query.searchParams.get("mailto"), "research@example.org");
		return { message: { items: [row] } };
	}, "research@example.org");
	assert.equal(found.state, "found"); assert.equal(calls, 1);
	const cache = JSON.parse(JSON.stringify({ [doiRecoveryKey(paper)]: found }));
	const reopened = structuredClone(paper);
	applyRecoveredDoi(reopened, cachedDoiRecovery(reopened, cache));
	assert.equal(reopened.doiUrl, "https://doi.org/10.1234/exercise", "saved results survive reload");
	assert.equal(cachedDoiRecovery({ ...paper, year: 2000 }, cache), null, "bibliography changes invalidate cache");
	const existing = { ...paper, doiUrl: "https://doi.org/10.1234/original" };
	applyRecoveredDoi(existing, found); assert.equal(existing.doiUrl, "https://doi.org/10.1234/original");
	const ambiguous = await recoverDoi(paper, async () => ({ message: { items: [row, { ...row, DOI: "10.1234/other" }] } }), "");
	assert.equal(ambiguous.state, "ambiguous");
	applyRecoveredDoi(paper, ambiguous); assert.equal(paper.doiUrl, null, "ambiguous matches must not mutate records");
	const fallback = await recoverDoi(paper, async url => new URL(url).hostname === "api.crossref.org"
		? { message: { items: [] } }
		: { resultList: { result: [{ doi: candidate.doi, title: paper.title + ".", pubYear: "1995", authorString: "Smith J, Jones A", journalTitle: "Heart", journalVolume: "74", pageInfo: "123-130" }] } }, "");
	assert.equal(fallback.state, "found"); assert.equal(fallback.candidates[0]!.source, "Europe PMC");
	const missing = await recoverDoi(paper, async url => new URL(url).hostname === "api.crossref.org" ? { message: { items: [] } } : { resultList: { result: [] } }, "");
	assert.equal(missing.state, "not-found");
	const negative = { [doiRecoveryKey(paper)]: missing };
	assert(cachedDoiRecovery(paper, negative, missing.checkedAt + 1000));
	assert.equal(cachedDoiRecovery(paper, negative, missing.checkedAt + 86400001), null);
	await assert.rejects(() => recoverDoi(paper, async () => { throw new Error("HTTP 429"); }, ""), /429/, "network failures must remain retryable");
	await assert.rejects(() => recoverDoi(paper, async () => ({}), ""), /Invalid/, "malformed responses are not negative matches");
}
