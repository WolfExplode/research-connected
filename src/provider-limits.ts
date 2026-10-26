import { tr } from "./i18n";

/**
 * Every scholarly request in this renderer goes through one lane per service: panes, embeds and
 * clients share its spacing and concurrency. Rate limits are retried with Retry-After or backoff,
 * then pause the service for every caller, including the research CLI through a shared file.
 */
interface Policy { service: string; name: string; spacing: number; concurrency: number }

const POLICIES: Record<string, Policy> = {
	"api.openalex.org": { service: "openalex", name: "OpenAlex", spacing: 120, concurrency: 3 },
	"api.semanticscholar.org": { service: "semantic-scholar", name: "Semantic Scholar", spacing: 1100, concurrency: 1 },
	"api.crossref.org": { service: "crossref", name: "Crossref", spacing: 200, concurrency: 2 },
	"api.opencitations.net": { service: "opencitations", name: "OpenCitations", spacing: 400, concurrency: 1 },
	"www.ebi.ac.uk": { service: "europe-pmc", name: "Europe PMC", spacing: 200, concurrency: 2 },
};

export interface ProviderPause { state: string; until: number }

/** Durable pauses shared with other processes; absent outside a research repository. */
export interface ProviderPauseStore {
	read(service: string): ProviderPause | null;
	write(service: string, pause: ProviderPause): void;
}

const RETRIES = 3;
const MAX_RETRY_WAIT = 30_000;
const RATE_PAUSE = 60_000;
// OpenAlex 402 means the daily budget is spent; retrying sooner only spends requests.
const BUDGET_PAUSE = 60 * 60_000;

interface Lane { active: number; nextStart: number; waiting: Array<() => void>; pause: ProviderPause | null }
const lanes = new Map<string, Lane>();
let store: ProviderPauseStore | null = null;

export function setProviderPauseStore(next: ProviderPauseStore | null): void { store = next; }

/** Test hook: forget lanes and in-memory pauses. */
export function resetProviderLimits(): void { lanes.clear(); }

export class ProviderPausedError extends Error {
	readonly status = 429;
	constructor(readonly service: string, readonly until: number, name: string) {
		super(tr(`${name} 因请求限额暂停，${new Date(until).toLocaleTimeString()} 后恢复。`, `${name} is paused after a rate limit until ${new Date(until).toLocaleTimeString()}.`));
		this.name = "ProviderPausedError";
	}
}

/** Seconds or an HTTP date, as milliseconds from now; undefined when absent or invalid. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function policyFor(url: string): Policy | undefined {
	try { return POLICIES[new URL(url).hostname]; } catch { return undefined; }
}

function laneFor(service: string): Lane {
	let lane = lanes.get(service);
	if (!lane) lanes.set(service, lane = { active: 0, nextStart: 0, waiting: [], pause: null });
	return lane;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

function activePause(policy: Policy, lane: Lane): ProviderPause | null {
	const now = Date.now();
	let shared: ProviderPause | null = null;
	try { shared = store?.read(policy.service) ?? null; } catch { /* An unreadable pause file never blocks requests. */ }
	const pauses = [lane.pause, shared].filter((p): p is ProviderPause => !!p && p.until > now);
	return pauses.sort((a, b) => b.until - a.until)[0] ?? null;
}

function pauseService(policy: Policy, lane: Lane, state: string, ms: number): void {
	const pause = { state, until: Date.now() + ms };
	lane.pause = pause;
	try { store?.write(policy.service, pause); } catch { /* The in-memory pause still protects this renderer. */ }
}

/** Claims a slot; returns null when the request may start in this tick, so an idle service adds no delay. */
function acquire(policy: Policy, lane: Lane): Promise<void> | null {
	if (lane.active >= policy.concurrency) return (async () => {
		while (lane.active >= policy.concurrency) await new Promise<void>(resolve => lane.waiting.push(resolve));
		const wait = acquire(policy, lane);
		if (wait) await wait;
	})();
	lane.active++;
	const now = Date.now(), start = Math.max(now, lane.nextStart);
	lane.nextStart = start + policy.spacing;
	return start > now ? sleep(start - now) : null;
}

function release(lane: Lane): void {
	lane.active--;
	lane.waiting.shift()?.();
}

/** Run one request in its service lane. Hosts without a policy (such as an LLM endpoint) run directly. */
export async function limitedRequest<T>(url: string, run: () => Promise<T>): Promise<T> {
	const policy = policyFor(url);
	if (!policy) return run();
	const lane = laneFor(policy.service);
	for (let attempt = 0; ; attempt++) {
		const paused = activePause(policy, lane);
		if (paused) throw new ProviderPausedError(policy.service, paused.until, policy.name);
		const wait = acquire(policy, lane);
		if (wait) await wait;
		try {
			return await run();
		} catch (error) {
			const { status, retryAfter } = error as { status?: number; retryAfter?: number };
			if (status === 402 && policy.service === "openalex") { pauseService(policy, lane, "budget", BUDGET_PAUSE); throw error; }
			if (status !== 429 && status !== 502 && status !== 503 && status !== 504) throw error;
			const wait = retryAfter ?? 1000 * 2 ** attempt;
			if (attempt >= RETRIES || wait > MAX_RETRY_WAIT) {
				if (status === 429) pauseService(policy, lane, "rate-limited", Math.min(BUDGET_PAUSE, Math.max(RATE_PAUSE, retryAfter ?? 0)));
				throw error;
			}
			// Holding the lane while waiting keeps other callers from spending the same limit.
			await sleep(wait);
		} finally {
			release(lane);
		}
	}
}
