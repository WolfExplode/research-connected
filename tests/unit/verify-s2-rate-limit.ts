import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SemanticScholarClient } from "../../src/citation-sources";

/** Real timers verify the transport boundary across clients, methods and failures. */
export async function verifyS2RateLimit(): Promise<void> {
	const starts: number[] = [];
	const record = () => { starts.push(performance.now()); };
	let attempts = 0;
	const bulk = new SemanticScholarClient(async () => ({}), "rate-test", async (url) => {
		record();
		attempts++;
		if (attempts <= 2) throw new Error("embedding unavailable");
		if (attempts === 3) assert.ok(!new URL(url).searchParams.get("fields")?.includes("embedding"));
		return [];
	});
	const get = new SemanticScholarClient(async () => {
		record();
		return { abstract: "Rate limit verification" };
	}, "rate-test");
	await Promise.all([
		bulk.bulkCounts(Array.from({ length: 501 }, (_, i) => `10.9999/rate-${i}`), { embedding: true }),
		get.abstract("10.9999/rate-abstract"),
	]);
	assert.equal(starts.length, 5, "GET, retry, fallback and second batch all reach transport");
	for (let i = 1; i < starts.length; i++) {
		const gap = starts[i]! - starts[i - 1]!;
		assert.ok(gap >= 1000, `Semantic Scholar requests started only ${gap.toFixed(1)} ms apart`);
	}
}
