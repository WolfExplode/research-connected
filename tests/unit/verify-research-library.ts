import assert from "node:assert/strict";
import { openAccessWorks } from "../../src/fetched-evidence";
import { createOpenAccessQueue, type AvailabilityResults } from "../../src/open-access-queue";
import { ResearchLibrary, type LibraryHost, type VaultFile } from "../../src/research-library";
import { workerOpenAlexCache, type AvailabilityWorker, type CliResponse, type ProviderRecord, type ResearchTools } from "../../src/research-tools";
import type { PaperNode } from "../../src/types";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const paper = (fields: Partial<PaperNode>): PaperNode => ({ id: "W1", title: "Exercise and autonomic recovery in children", year: 2020, citedByCount: 0, authors: "", authorList: ["A. Author"],
	abstract: "", doiUrl: null, openAlexUrl: "", isSeed: false, origin: "related", language: null, workType: null, venue: null, concepts: [], retracted: false, ...fields });

function vault(notes: Record<string, Record<string, unknown>>, others: string[] = []): LibraryHost & { writes: Array<[string, Record<string, unknown>]>; props: Map<string, Record<string, unknown>> } {
	const props = new Map(Object.entries(notes));
	const file = (path: string): VaultFile => ({ path, extension: path.split(".").at(-1)!, basename: path.split("/").at(-1)!.replace(/\.[^.]+$/, "") });
	const writes: Array<[string, Record<string, unknown>]> = [];
	return {
		props, writes,
		files: () => [...props.keys(), ...others].map(file),
		frontmatter: path => props.get(path) ?? null,
		resolveLink: () => null,
		read: async path => { throw new Error(`no ${path}`); },
		async processFrontMatter(path, update) { const value = { ...props.get(path) }; update(value); props.set(path, value); writes.push([path, value]); },
		open() {},
	};
}

function tools(answer: (args: string[], input: string) => CliResponse | Promise<CliResponse>, worker?: Partial<AvailabilityWorker>): ResearchTools & { calls: Array<{ args: string[]; input: string }> } {
	const calls: Array<{ args: string[]; input: string }> = [];
	return {
		calls,
		json: async (args, options = {}) => { calls.push({ args, input: options.input ?? "" }); return answer(args, options.input ?? ""); },
		worker: () => ({ closed: false, check: async () => [], cached: async dois => dois.map(doi => ({ doi, providers: {} })),
			openAlexRead: async () => null, openAlexWrite: async () => undefined, pause: async () => undefined, dispose() {}, ...worker }),
		dispose() {},
	};
}

const settings = { autoOpenAccess: true, autoSpecter2: true };

/** The research library service over a fake vault and fake research CLI. */
export async function verifyResearchLibrary(): Promise<void> {
	const events: string[] = [];
	const host = window as unknown as { dispatchEvent?: (event: Event) => boolean };
	const previousDispatch = host.dispatchEvent;
	const libraries: ResearchLibrary[] = [];
	const track = (library: ResearchLibrary): ResearchLibrary => { libraries.push(library); return library; };
	host.dispatchEvent = event => { events.push(event.type); return true; };
	try {
		// Holdings: DOI first, then OpenAlex id, then a long exact title; several matches are ambiguous.
		const notes = vault({
			"Research/Papers/Author 2020 - Exercise and autonomic recovery in children.md": { type: "source", doi: "10.1234/a", openalex: "W1", bookmark: true, reading_status: "read" },
			"Research/Papers/Other 2019 - Cardiac output during exercise in adolescents.md": { type: "source", title: "Cardiac output during exercise in adolescents", year: 2019 },
			"Research/Papers/Twin 2018 - Shared title of two separate studies here.md": { type: "source" },
			"Research/Papers/Twin 2018 - Shared title of two separate studies here 2.md": { type: "source", title: "Shared title of two separate studies here" },
		}, ["Research/Papers/Author 2020 - Exercise and autonomic recovery in children.pdf", "Research/Inbox/Unfiled 2021 - A full text before its note was imported.pdf"]);
		const cli = tools(() => ({ results: [] }));
		const library = track(new ResearchLibrary(notes, cli, () => settings));
		// Explicit request cleanup delegates validation to the same offline command as automation.
		const reconciler = tools(() => ({ results: [{ status: "ok", reason: "request-fulfilled", subject: "Held paper" }] }));
		const requests = track(new ResearchLibrary(vault({}), reconciler, () => settings));
		assert.equal(await requests.reconcileRequest("Research/Papers/Held paper.md"), true);
		assert.equal(await requests.reconcileRequest("Research/Papers/Other paper.md"), false, "another fulfilled request must not suppress this paper's download");
		assert.deepEqual(reconciler.calls.map(call => call.args), [["reconcile"], ["reconcile"]]);
		const byDoi = library.read(paper({ doiUrl: "https://doi.org/10.1234/A" }));
		assert.equal(byDoi.local.state, "held"); assert.equal(byDoi.local.matchedBy, "doi"); assert.equal(byDoi.local.bookmark, true); assert.equal(byDoi.local.reading, "read");
		assert.equal(library.read(paper({ id: "https://openalex.org/W1" })).local.matchedBy, "openalex");
		const byTitle = library.read(paper({ id: "W9", title: "Cardiac output during exercise in adolescents", year: 2019 }));
		assert.equal(byTitle.local.state, "note-only"); assert.equal(byTitle.local.matchedBy, "title");
		assert.equal(library.read(paper({ id: "W9", title: "Cardiac output during exercise in adolescents", year: 2001 })).local.state, "absent", "a title match must agree on year");
		assert.equal(library.read(paper({ id: "W9", title: "Shared title of two separate studies here", year: null })).local.state, "ambiguous");
		assert.equal(library.read(paper({ id: "W9", title: "A full text before its note was imported", year: null })).local.files[0], "Research/Inbox/Unfiled 2021 - A full text before its note was imported.pdf");

		// Only changes a graph can show refresh open graphs.
		await delay(150); events.length = 0;
		const note = "Research/Papers/Other 2019 - Cardiac output during exercise in adolescents.md";
		notes.props.set(note, { ...notes.props.get(note), quality: "high" });
		library.vaultChanged(note, "modify"); await delay(150);
		assert.equal(events.length, 0, "a reading-notes or quality edit does not refresh graphs");
		notes.props.set(note, { ...notes.props.get(note), bookmark: true });
		library.vaultChanged(note, "modify"); library.vaultChanged(note, "modify"); await delay(150);
		assert.deepEqual(events, ["research-connected-library-changed"], "a bookmark change refreshes graphs once");
		assert.equal(library.read(paper({ id: `local:${note}` })).local.bookmark, true);
		events.length = 0;
		library.vaultChanged("Research/Papers/Some figure.png", "create"); await delay(150);
		assert.equal(events.length, 0, "unrelated attachments do not refresh graphs");

		// keep: one note writer, serialized; concurrent Saves of one DOI share a download.
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const keeper = tools(async args => {
			if (args.includes("--download")) await gate;
			return { results: [{ status: "ok", data: { note: "Research/Papers/New 2024 - A new paper.md", held: args.includes("--download"), bookmark: args.includes("--bookmark"), reading_status: "unread", reason: "" } }] };
		});
		const writer = track(new ResearchLibrary(vault({}), keeper, () => settings));
		const fresh = paper({ id: "W5", doiUrl: "https://doi.org/10.1234/new", title: "A new paper" });
		const first = writer.save(fresh), second = writer.save({ ...fresh, id: "alias" });
		assert.equal(first, second, "concurrent saves of one DOI share one acquisition");
		const marked = writer.bookmark(fresh, true);
		await delay(10);
		assert.equal(keeper.calls.length, 1, "a bookmark waits for the running write");
		release();
		const saved = await first, bookmarked = await marked;
		assert.equal(saved.local.state, "held"); assert.equal(saved.local.note, "Research/Papers/New 2024 - A new paper.md", "confirmed state precedes indexing");
		assert.equal(bookmarked.local.bookmark, true);
		assert.equal(keeper.calls[0]!.args[1], "-", "metadata goes on stdin, not the command line");
		assert.deepEqual(JSON.parse(keeper.calls[0]!.input), { title: "A new paper", doi: "10.1234/new", openalex: "W5", authors: ["A. Author"], year: 2020, abstract: "", note: null, files: [] });
		// An existing note's bookmark is a frontmatter edit, not a CLI call.
		const legacy = vault({ "Research/Papers/Old.md": { type: "source", doi: "10.1234/old", bookmark: false } });
		const existing = track(new ResearchLibrary(legacy, tools(() => ({})), () => settings));
		await existing.bookmark(paper({ doiUrl: "10.1234/old" }), true);
		assert.deepEqual(legacy.props.get("Research/Papers/Old.md"), { type: "source", doi: "10.1234/old", bookmark: true });

		// SPECTER2: one cached read per unseen DOI, then only real downloads; a failure pauses for 15 minutes.
		let now = 1_000_000;
		const embedder = tools(args => args.includes("--cached")
			? { results: [{ status: "ok", data: { doi: "10.1234/a", vector: [1, 0] } }, { status: "flagged", data: { doi: "10.1234/b", settled: true } }, { status: "flagged", data: { doi: "10.1234/c", settled: false } }] }
			: { results: [{ status: "failed", reason: "rate-limited" }] });
		const vectors = track(new ResearchLibrary(vault({}), embedder, () => settings, () => now));
		const graph = ["a", "b", "c"].map(id => paper({ id, doiUrl: `10.1234/${id}` }));
		const evidence = await vectors.textEvidence(graph);
		assert.deepEqual(evidence, [{ id: "a", vector: [1, 0] }]);
		await vectors.textEvidence(graph);
		assert.equal(embedder.calls.filter(call => call.args.includes("--cached")).length, 1, "known DOIs are not asked about again");
		assert.equal(embedder.calls[0]!.input, "10.1234/a\n10.1234/b\n10.1234/c");
		await delay(200);
		const downloads = embedder.calls.filter(call => call.args.includes("--remote"));
		assert.deepEqual(downloads.map(call => call.args.slice(2)), [["10.1234/c"]], "only a DOI without a vector or recent answer is downloaded");
		assert.equal(vectors.embeddingStatus().state, "rate-limited");
		now += 60_000; await vectors.textEvidence(graph); await delay(200);
		assert.equal(embedder.calls.filter(call => call.args.includes("--remote")).length, 1, "a failed batch pauses downloads");

		// Graph-fetched vectors are stored once through the CLI.
		const storer = tools(args => ({ results: args.includes("--store") ? [{ status: "ok", subject: "10.1234/s" }] : [] }));
		const store = track(new ResearchLibrary(vault({}), storer, () => settings));
		await store.storeFetched({ vectors: [{ doi: "10.1234/s", paperId: "p", vector: [0, 1] }] });
		assert.deepEqual(JSON.parse(storer.calls[0]!.input), [{ doi: "10.1234/s", paperId: "p", vector: [0, 1] }]);
		assert.deepEqual(await store.textEvidence([paper({ id: "s", doiUrl: "10.1234/s" })]), [{ id: "s", vector: [0, 1] }]);
		assert.equal(storer.calls.filter(call => call.args.includes("--cached")).length, 0, "stored vectors need no cache read");
		// OpenAlex responses reduce to the open-access part of works with a DOI.
		assert.deepEqual(openAccessWorks({ results: [{ id: "W1", doi: "https://doi.org/10.1/x", title: "T", open_access: { is_oa: true }, best_oa_location: null }, { doi: null, open_access: {} }, { doi: "10.1/y" }] }),
			[{ doi: "https://doi.org/10.1/x", open_access: { is_oa: true }, best_oa_location: null, locations: null }]);

		await verifyOpenAccessQueue();
		await verifyWorkerCache();
	} finally {
		// Disposing clears pending refresh timers before the host's dispatch is restored.
		for (const library of libraries) library.dispose();
		host.dispatchEvent = previousDispatch;
	}
}

// The plugin writes no cache files itself: OpenAlex responses go through the research CLI's worker.
async function verifyWorkerCache(): Promise<void> {
	const stored = new Map<string, unknown>();
	const worker = tools(() => ({}), {
		openAlexRead: async url => stored.get(url) ?? null,
		openAlexWrite: async (url, body) => { stored.set(url, body); },
	}).worker();
	const cache = workerOpenAlexCache(() => worker);
	assert.equal(await cache.read("https://api.openalex.org/works/W1"), undefined, "a worker miss is a cache miss");
	await cache.write("https://api.openalex.org/works/W1", { id: "W1" });
	assert.deepEqual(await cache.read("https://api.openalex.org/works/W1"), { id: "W1" });
	assert.equal(await workerOpenAlexCache(() => null).read("https://api.openalex.org/works/W1"), undefined, "no research tools means no cache");
}

async function verifyOpenAccessQueue(): Promise<void> {
	const now = Date.parse("2026-10-26T12:00:00Z");
	const fresh: ProviderRecord = { state: "available", url: "https://example.org/a.pdf", checkedAt: new Date(now - 60_000).toISOString() };
	const cachedReads: string[][] = [], checks: string[][] = [];
	let notified = 0, fail = false;
	const results: AvailabilityResults = new Map();
	const worker: AvailabilityWorker = {
		closed: false,
		cached: async dois => { cachedReads.push([...dois]); return dois.map(doi => ({ doi, providers: (doi === "10.1/fresh" ? { oa: fresh } : {}) as Record<string, ProviderRecord> })); },
		check: async dois => { checks.push([...dois]); return dois.map(doi => ({ doi, value: fail ? { state: "error", detail: "down", retryAfter: new Date(now + 60_000).toISOString(), checkedAt: new Date(now).toISOString() } : { state: "not-found", checkedAt: new Date(now).toISOString() } })); },
		openAlexRead: async () => null, openAlexWrite: async () => undefined, pause: async () => undefined,
		dispose() {},
	};
	const queue = createOpenAccessQueue({ worker: () => worker, results, notify: () => { notified++; }, enabled: () => true, now: () => now, debounce: 5, minInterval: 0 });
	// Stored results are read in one request for a whole graph, and never trigger provider checks.
	queue.load(["10.1/fresh", "10.1/new"]); queue.load(["10.1/fresh", "10.1/other"]);
	await delay(10);
	assert.deepEqual(cachedReads, [["10.1/fresh", "10.1/new", "10.1/other"]]);
	assert.ok(notified > 0); assert.equal(checks.length, 0);
	assert.equal(queue.view(results.get("10.1/fresh")?.providers.oa).state, "available");
	// A fresh stored link is answered from cache; missing ones go out together.
	const values = await queue.prefetch(["10.1/fresh", "10.1/new", "10.1/other"]);
	assert.deepEqual(values.map(value => value.state), ["available", "not-found", "not-found"]);
	assert.deepEqual(checks, [["10.1/new", "10.1/other"]]);
	// A forced check asks the provider even with a fresh link; a failure delays the next batch.
	fail = true;
	const refreshed = await queue.check("10.1/fresh", { force: true });
	assert.equal(refreshed.state, "error"); assert.deepEqual(checks.at(-1), ["10.1/fresh"]);
	queue.dispose();
	await assert.rejects(queue.check("10.1/fresh"), /closed/);
}
