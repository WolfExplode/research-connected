import { mergeResult, needsRefresh, providerView } from "./availability-policy";
import type { AvailabilityWorker, ProviderRecord } from "./research-tools";

export type AvailabilityResults = Map<string, { providers: Record<string, ProviderRecord> }>;

export interface OpenAccessQueueOptions {
	worker: () => AvailabilityWorker;
	results: AvailabilityResults;
	notify: () => void;
	enabled: () => boolean;
	now?: () => number;
	debounce?: number;
	minInterval?: number;
	batchSize?: number;
}

export interface OpenAccessQueue {
	/** Reads stored results for DOIs not seen yet, in the background; notifies when they arrive. */
	load(dois: readonly string[]): void;
	/** Drops session results for DOIs whose stored result another writer just replaced. */
	forget(dois: readonly string[]): void;
	view(value: ProviderRecord | undefined, name?: string): ProviderRecord;
	check(doi: string, options?: { force?: boolean; automatic?: boolean }): Promise<ProviderRecord>;
	prefetch(dois: readonly string[]): Promise<ProviderRecord[]>;
	isPending(doi: string): boolean;
	dispose(): void;
}

interface Pending { promise: Promise<ProviderRecord>; resolve(value: ProviderRecord): void; reject(error: Error): void; force: boolean; automatic: boolean }

/** One background queue shared by every graph pane and embed; cache reads never start requests. */
export function createOpenAccessQueue({ worker, results, notify, enabled, now = Date.now, debounce = 150, minInterval = 350, batchSize = 20 }: OpenAccessQueueOptions): OpenAccessQueue {
	const loaded = new Set<string>(), pending = new Map<string, Pending>();
	let queue: string[] = [], timer: number | null = null, running = false, closed = false, nextStart = 0;
	let reads: string[] = [], readTimer: number | null = null, reading: Promise<void> = Promise.resolve();
	const view = (value: ProviderRecord | undefined, name = "oa"): ProviderRecord => providerView(value, name, now());
	const store = (doi: string, providers: Record<string, ProviderRecord>): void => {
		const current = results.get(doi);
		results.set(doi, { ...current, providers: { ...current?.providers, ...providers } });
	};
	// Stored results come back in one cache-only worker request per tick, not one per DOI.
	const flushReads = (): Promise<void> => {
		readTimer = null;
		const dois = reads.splice(0, 500);
		if (!dois.length || closed) return Promise.resolve();
		reading = worker().cached(dois).then(rows => {
			if (closed) return;
			// A result checked in this session is newer than the stored one.
			for (const row of rows) store(row.doi, { ...row.providers, ...results.get(row.doi)?.providers });
			notify();
		}).catch(() => { for (const doi of dois) loaded.delete(doi); })
			.then(() => reads.length ? flushReads() : undefined);
		return reading;
	};
	const load = (dois: readonly string[]): void => {
		for (const doi of dois) if (!loaded.has(doi)) { loaded.add(doi); reads.push(doi); }
		if (reads.length && readTimer === null && !closed) readTimer = window.setTimeout(() => { void flushReads(); }, 0);
	};
	const schedule = (): void => {
		if (closed || running || timer !== null || !queue.length) return;
		timer = window.setTimeout(() => { timer = null; void drain(); }, Math.max(debounce, nextStart - now()));
	};
	const settle = (doi: string, value: ProviderRecord): void => {
		const item = pending.get(doi);
		if (!item) return;
		if (!closed) store(doi, { oa: value });
		item.resolve(value); pending.delete(doi);
	};
	const drain = async (): Promise<void> => {
		if (closed || running) return;
		// A preference change also stops automatic work that has not started yet.
		const skipped = queue.filter(doi => pending.get(doi)?.automatic && !enabled());
		for (const doi of skipped) { pending.get(doi)!.resolve(view(results.get(doi)?.providers.oa)); pending.delete(doi); }
		queue = queue.filter(doi => !skipped.includes(doi));
		const dois = queue.splice(0, Math.max(1, Math.min(20, batchSize)));
		if (!dois.length) return;
		running = true; notify();
		// Stored results must be in place before a merge decides whether a link goes stale.
		await reading;
		let values: Array<{ doi: string; value: ProviderRecord }>;
		try { values = await worker().check(dois, dois.some(doi => pending.get(doi)?.force)); }
		catch { values = dois.map(doi => ({ doi, value: mergeResult(results.get(doi)?.providers.oa, { state: "error", detail: "Background open-access check failed" }, "oa", now()) })); }
		const byDoi = new Map(values.map(row => [row.doi, row.value]));
		for (const doi of dois) {
			const value = byDoi.get(doi) ?? mergeResult(results.get(doi)?.providers.oa, { state: "error", detail: "No availability response returned" }, "oa", now());
			settle(doi, value);
			// Apply a provider-requested cooldown to the remaining queued batches.
			if (value.state === "error" || value.refreshError) nextStart = Math.max(nextStart, Date.parse(value.retryAfter ?? "") || 0);
		}
		const failure = values.find(row => row.value.state === "error" || row.value.refreshError)?.value;
		if (failure) for (const doi of queue.splice(0)) {
			settle(doi, mergeResult(results.get(doi)?.providers.oa, { state: "error", detail: "Background OA queue paused after a provider failure", retryAfter: failure.retryAfter }, "oa", now()));
		}
		running = false; nextStart = Math.max(nextStart, now() + minInterval);
		if (!closed) { notify(); schedule(); }
	};
	const check = async (doi: string, { force = false, automatic = false } = {}): Promise<ProviderRecord> => {
		if (closed) throw new Error("Open-access queue is closed");
		load([doi]);
		const existing = pending.get(doi);
		if (existing) {
			if (force) existing.force = true;
			if (!automatic) existing.automatic = false;
			if (force && queue.includes(doi)) { queue = queue.filter(d => d !== doi); queue.unshift(doi); }
			return existing.promise;
		}
		if (automatic && !enabled()) return view(results.get(doi)?.providers.oa);
		// Never ask the provider about a DOI whose stored result has not been read yet.
		if (!force) {
			if (readTimer !== null) { window.clearTimeout(readTimer); await flushReads(); } else await reading;
			const cached = results.get(doi)?.providers.oa;
			if (!needsRefresh(cached, "oa", now())) return view(cached);
			if (pending.has(doi)) return pending.get(doi)!.promise;
		}
		let resolve!: (value: ProviderRecord) => void, reject!: (error: Error) => void;
		const promise = new Promise<ProviderRecord>((yes, no) => { resolve = yes; reject = no; });
		pending.set(doi, { promise, resolve, reject, force, automatic });
		if (force) queue.unshift(doi); else queue.push(doi);
		schedule(); return promise;
	};
	const forget = (dois: readonly string[]): void => {
		for (const doi of dois) {
			if (pending.has(doi)) continue;
			loaded.delete(doi);
			const current = results.get(doi);
			if (current) { const { oa: _replaced, ...rest } = current.providers; results.set(doi, { providers: rest }); }
		}
	};
	return {
		load, forget, view, check,
		prefetch: dois => Promise.all([...new Set(dois)].slice(0, 300).map(doi => check(doi, { automatic: true }))),
		isPending: doi => pending.has(doi),
		dispose() {
			closed = true;
			if (timer !== null) window.clearTimeout(timer);
			if (readTimer !== null) window.clearTimeout(readTimer);
			timer = readTimer = null; queue = []; reads = [];
			for (const item of pending.values()) item.reject(new Error("Open-access queue is closed"));
			pending.clear();
		},
	};
}
