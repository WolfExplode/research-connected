import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { OpenAlexClient, setOpenAlexCache, type OpenAlexCacheStore } from "../../src/openalex";
import { cacheKey, cacheKind, canonicalRequest, openAlexCacheFiles } from "../../src/openalex-cache-file";
import { resetProviderLimits, setProviderPauseStore } from "../../src/provider-limits";

const DAY = 86_400_000;

// The research library's tests/openalex-cache.test.js asserts these same values; change both together.
const GOLDEN: Array<[string, string, string]> = [
	["https://api.openalex.org/works/doi:10.1155/2013/151675?select=id,doi&api_key=SECRET&mailto=a@b.org", "work", "b8635735e881106dd74341a76faa294a5a7593aad4c84b8d0d2ca375adefef51"],
	["https://api.openalex.org/works?per-page=5&search=heart%20rate", "search", "c4112cb780f5a0fbf105fb480d7755746d48a321daf7698eace4ce9483e4e6e5"],
	["https://api.openalex.org/works?filter=cites:W2031043456&per_page=25&sort=cited_by_count:desc&cursor=*", "citing", "05724fe02bf9eb8e7daa95dddce671a0095beaa5c09201e2c0ef13d37c1a92ce"],
	// A bare % is not a valid escape; the key uses the path as sent rather than throwing.
	["https://api.openalex.org/works/doi:10.1000/50%_OFF", "work", "ceda7ac182dc72b1516980915eaef00ec4e0269fd793270c64a880131f989f71"],
];

function scratchRepository(): string {
	const repository = mkdtempSync(join(tmpdir(), "openalex-cache-"));
	mkdirSync(join(repository, "Tools", "research"), { recursive: true });
	writeFileSync(join(repository, "Tools", "research", "cli.js"), "");
	return repository;
}

/** The shared OpenAlex response cache: keys, lifetimes, the CLI's file format, LRU and the client's bypass. */
export async function verifyOpenAlexCache(): Promise<void> {
	for (const [url, kind, key] of GOLDEN) {
		assert.equal(cacheKind(url), kind, url);
		assert.equal(cacheKey(url), key, `${url} keeps the research CLI's key`);
	}
	assert.equal(cacheKey("https://api.openalex.org/works/doi:10.1155%2F2013%2F151675?select=id%2Cdoi"), GOLDEN[0]![2], "DOI path encoding does not change the key");
	assert.doesNotMatch(canonicalRequest(GOLDEN[0]![0]), /SECRET|mailto/);
	assert.equal(cacheKind("https://api.openalex.org/works?filter=cited_by:W1&per_page=50"), "references");
	assert.equal(cacheKind("https://api.openalex.org/works?filter=related_to:W1"), "related");
	assert.equal(cacheKind("https://api.openalex.org/works?filter=openalex:W1|W2"), "batch");
	assert.equal(cacheKind("https://api.openalex.org/works?search.semantic=arterial"), "search");

	assert.equal(openAlexCacheFiles(mkdtempSync(join(tmpdir(), "not-research-"))), null, "Only a research repository gets a disk cache");

	// Records match the CLI's: gzip JSON with the path but no query text or credentials.
	const repository = scratchRepository();
	let clock = Date.UTC(2026, 9, 1);
	const store = openAlexCacheFiles(repository, { now: () => clock })!;
	const semantic = "https://api.openalex.org/works?search.semantic=private%20abstract%20text&per_page=50&api_key=SECRET";
	await store.write(semantic, { results: [{ id: "W1" }] });
	const file = join(repository, ".cache", "research", "openalex", cacheKey(semantic).slice(0, 2), `${cacheKey(semantic)}.json.gz`);
	const text = gunzipSync(readFileSync(file)).toString("utf8");
	assert.doesNotMatch(text, /private abstract|SECRET/);
	assert.deepEqual(JSON.parse(text), { v: 1, kind: "search", path: "/works", storedAt: clock, expiresAt: clock + 7 * DAY, body: { results: [{ id: "W1" }] } });
	clock += DAY;
	assert.deepEqual(await store.read(semantic), { results: [{ id: "W1" }] });
	clock += 7 * DAY;
	assert.equal(await store.read(semantic), undefined, "Expired records miss");
	assert.equal(existsSync(file), false, "Expired records are removed");

	// Least recently used records go first.
	const lru = scratchRepository(), now = Date.now();
	const writer = openAlexCacheFiles(lru, { now: () => now })!;
	const urls = [1, 2, 3, 4].map((n) => `https://api.openalex.org/works/W${n}`);
	for (const url of urls) await writer.write(url, { padding: "x".repeat(2000) + url });
	const files = urls.map((url) => join(lru, ".cache", "research", "openalex", cacheKey(url).slice(0, 2), `${cacheKey(url)}.json.gz`));
	files.forEach((path, i) => { const at = new Date(now - (10 - i) * 60_000); utimesSync(path, at, at); });
	await writer.read(urls[0]!);
	const capped = openAlexCacheFiles(lru, { maxBytes: statSync(files[0]!).size * 3 })!;
	assert.equal((await capped.sweep()).removed, 2);
	assert.deepEqual(files.map((path) => existsSync(path)), [true, false, false, true]);

	// The client answers from the store, `fresh` refetches and replaces, and a paused lane still reads it.
	resetProviderLimits();
	setProviderPauseStore(null);
	const memory = new Map<string, unknown>();
	const recorded: OpenAlexCacheStore = {
		read: async (url) => memory.get(canonicalRequest(url)),
		write: async (url, body) => { memory.set(canonicalRequest(url), body); },
	};
	setOpenAlexCache(recorded);
	try {
		let calls = 0;
		const getJson = async (): Promise<unknown> => ({ id: "https://openalex.org/W7", display_name: `call ${++calls}` });
		const auth = { apiKey: "", contactEmail: "" };
		assert.equal((await new OpenAlexClient(getJson, auth).workById("W7")).display_name, "call 1");
		await Promise.resolve();
		assert.equal((await new OpenAlexClient(getJson, auth).workById("W7")).display_name, "call 1", "A stored response answers without a request");
		assert.equal((await new OpenAlexClient(getJson, auth, { fresh: true }).workById("W7")).display_name, "call 2", "Reload skips the store");
		await Promise.resolve();
		assert.equal((await new OpenAlexClient(getJson, auth).workById("W7")).display_name, "call 2", "The fresh response replaced the stored one");
		assert.equal(calls, 2);
	} finally {
		setOpenAlexCache(null);
		resetProviderLimits();
	}
}
