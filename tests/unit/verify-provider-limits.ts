import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { OpenAlexClient } from "../../src/openalex";
import { limitedRequest, ProviderPausedError, resetProviderLimits, setProviderPauseStore, type ProviderPause } from "../../src/provider-limits";

const failure = (status: number, retryAfter?: number) => Object.assign(new Error(`HTTP ${status}`), { status, retryAfter });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Real timers: lanes space and bound requests per service, and pauses are shared through the store. */
export async function verifyProviderLimits(): Promise<void> {
	resetProviderLimits();
	const writes: Array<[string, ProviderPause]> = [];
	let shared: Record<string, ProviderPause> = {};
	setProviderPauseStore({ read: service => shared[service] ?? null, write: (service, pause) => { writes.push([service, pause]); } });
	try {
		// OpenAlex: at most three at once, starts spaced by its interval.
		let active = 0, peak = 0;
		const starts: number[] = [];
		await Promise.all(Array.from({ length: 5 }, (_, i) => limitedRequest(`https://api.openalex.org/works/W${i}`, async () => {
			starts.push(performance.now()); active++; peak = Math.max(peak, active);
			await delay(60); active--;
		})));
		assert.ok(peak <= 3, `OpenAlex ran ${peak} requests at once`);
		for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= 100, "OpenAlex starts are spaced");

		// A brief 429 is retried after Retry-After and does not pause the service.
		let calls = 0;
		assert.equal(await limitedRequest("https://api.crossref.org/works/10.1/x", async () => { if (++calls === 1) throw failure(429, 0); return "ok"; }), "ok");
		assert.equal(calls, 2); assert.equal(writes.length, 0);

		// A persistent 429 spends three retries, then pauses Crossref for every caller.
		calls = 0;
		await assert.rejects(limitedRequest("https://api.crossref.org/works/10.1/y", async () => { calls++; throw failure(429, 0); }), (error: unknown) => (error as { status?: number }).status === 429);
		assert.equal(calls, 4);
		assert.equal(writes[0]![0], "crossref"); assert.equal(writes[0]![1].state, "rate-limited");
		assert.ok(writes[0]![1].until - Date.now() >= 55_000);
		await assert.rejects(limitedRequest("https://api.crossref.org/works/10.1/z", async () => assert.fail("paused service is not called")), ProviderPausedError);

		// OpenAlex 402 is a spent daily budget: no retries, a long pause.
		calls = 0;
		await assert.rejects(limitedRequest("https://api.openalex.org/works/W9", async () => { calls++; throw failure(402); }));
		assert.equal(calls, 1); assert.equal(writes.at(-1)![1].state, "budget");

		// A pause another process wrote (the research CLI) stops this renderer too.
		shared = { "semantic-scholar": { state: "rate-limited", until: Date.now() + 60_000 } };
		await assert.rejects(limitedRequest("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x", async () => assert.fail("shared pause applies")), ProviderPausedError);

		// Other failures pass through once; hosts without a policy run directly.
		calls = 0;
		await assert.rejects(limitedRequest("https://www.ebi.ac.uk/europepmc/x", async () => { calls++; throw failure(404); }));
		assert.equal(calls, 1);
		assert.equal(await limitedRequest("https://llm.example/v1/chat", async () => "direct"), "direct");

		// Two clients asking OpenAlex for the same work at once share one request; later asks go again.
		resetProviderLimits();
		let gets = 0;
		const getJson = async () => { gets++; await delay(20); return { id: "https://openalex.org/W1", display_name: "Shared" }; };
		const auth = { apiKey: "", contactEmail: "" };
		const [a, b] = await Promise.all([new OpenAlexClient(getJson, auth).workByDoi("10.1/shared"), new OpenAlexClient(getJson, auth).workByDoi("10.1/shared")]);
		assert.equal(gets, 1); assert.equal(a, b);
		await new OpenAlexClient(getJson, auth).workByDoi("10.1/shared");
		assert.equal(gets, 2);
	} finally {
		setProviderPauseStore(null);
		resetProviderLimits();
	}
}
