import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { OpenAlexCacheStore } from "./openalex";

/**
 * The only way this plugin reaches the research repository's tools: child processes running
 * `Tools/research/cli.js … --json` and the long-lived availability worker. Repository modules are
 * never loaded into Obsidian's renderer, so the CLI stays the one writer of notes and caches.
 */
export interface CliResult {
	status: string;
	subject?: string;
	reason?: string;
	detail?: string;
	/** Shapes are pinned by the research repository's contract test; callers narrow them. */
	data?: unknown;
}

export interface CliResponse {
	results?: CliResult[];
	[key: string]: unknown;
}

export interface ProviderRecord {
	state: string;
	url?: string;
	links?: Array<{ url: string; kind: string }>;
	detail?: string;
	checkedAt?: string;
	cached?: boolean;
	stale?: boolean;
	refreshError?: string;
	retryAfter?: string;
	lastAttemptAt?: string;
}

export interface AvailabilityWorker {
	readonly closed: boolean;
	/** Up to 20 DOIs checked against OpenAlex, or up to 500 read from the provider cache. */
	check(dois: string[], refresh: boolean): Promise<Array<{ doi: string; value: ProviderRecord }>>;
	cached(dois: string[]): Promise<Array<{ doi: string; providers: Record<string, ProviderRecord> }>>;
	/** A stored OpenAlex response, or null. The worker is this plugin's only cache writer. */
	openAlexRead(url: string): Promise<unknown>;
	openAlexWrite(url: string, body: unknown): Promise<void>;
	/** Records a rate-limit pause in the shared file every research process reads. */
	pause(service: string, state: string, until: number): Promise<void>;
	dispose(): void;
}

export interface ResearchTools {
	json(args: string[], options?: { input?: string; acceptFailure?: boolean; onProgress?: (message: string) => void }): Promise<CliResponse>;
	worker(): AvailabilityWorker;
	dispose(): void;
}

export interface ResearchToolsConfig {
	repository: string;
	node: string;
	vault: string;
	env: () => Record<string, string | undefined>;
}

/** Why the configured checkout cannot serve this plugin, or null when it can. */
export function researchToolsProblem(repository: string): string | null {
	if (!existsSync(join(repository, "Tools", "research", "cli.js"))) return `No research tools at ${repository}`;
	// The shared OpenAlex cache arrived with the interface this plugin needs; an older checkout fails every action.
	if (!existsSync(join(repository, "Tools", "research", "openalex-cache.cjs"))) return `The research tools at ${repository} are too old; update that checkout`;
	return null;
}

export function nodeResearchTools(config: ResearchToolsConfig): ResearchTools {
	const cli = join(config.repository, "Tools", "research", "cli.js");
	let worker: AvailabilityWorker | null = null;
	return {
		json(args, { input = "", acceptFailure = false, onProgress } = {}) {
			return new Promise((resolve, reject) => {
				const child = execFile(config.node, [cli, ...args, "--vault", config.vault, "--json"], {
					cwd: config.repository, windowsHide: true, timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: { ...config.env(), ...(onProgress ? { RESEARCH_ACQUISITION_PROGRESS: "1" } : {}) },
				}, (error, stdout, stderr) => {
					if (error && !acceptFailure) return reject(new Error(String(stderr || stdout || error.message).trim()));
					try { resolve(JSON.parse(String(stdout)) as CliResponse); }
					catch {
						// A process that never started or crashed leaves no JSON; report why instead of blaming its output.
						if (error) reject(new Error(String(stderr || error.message).trim()));
						else reject(new Error("Research tools returned an unreadable response. Check the Node executable in Research Connected settings."));
					}
				});
				let progressBuffer = "";
				if (onProgress) child.stderr?.on("data", (chunk: Buffer) => {
					progressBuffer += chunk.toString();
					const lines = progressBuffer.split("\n"); progressBuffer = lines.pop() ?? "";
					for (const line of lines) if (line.startsWith("ACQUISITION_PROGRESS ")) {
						try { const value: unknown = JSON.parse(line.slice(21)); if (typeof value === "string") onProgress(value); } catch { /* Ignore malformed progress. */ }
					}
				});
				// Always close stdin so a command that accepts piped input never waits for more.
				child.stdin?.end(input);
			});
		},
		worker() {
			if (!worker || worker.closed) worker = availabilityWorker(config);
			return worker;
		},
		dispose() { worker?.dispose(); worker = null; },
	};
}

interface WorkerResponse { id?: number; results?: unknown; value?: unknown; error?: string }

function results<T>(response: WorkerResponse): T {
	if (!Array.isArray(response.results)) throw new Error("Open-access worker request failed");
	return response.results as T;
}

/** OpenAlex responses shared with the research CLI, read and stored by its worker. */
export function workerOpenAlexCache(worker: () => AvailabilityWorker | null): OpenAlexCacheStore {
	return {
		async read(url) { return (await worker()?.openAlexRead(url)) ?? undefined; },
		async write(url, body) { await worker()?.openAlexWrite(url, body); },
	};
}

/** One worker process serves many JSONL requests, one in flight per id. */
function availabilityWorker(config: ResearchToolsConfig, timeout = 45_000): AvailabilityWorker {
	const child = spawn(config.node, [join(config.repository, "Tools", "research", "availability-worker.js"), "--cache", join(config.repository, ".cache", "research")],
		{ cwd: config.repository, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env: config.env() });
	const pending = new Map<number, { resolve(value: WorkerResponse): void; reject(error: Error): void; timer: number }>();
	let stopped = false, buffer = "", nextId = 0;
	const fail = (): void => {
		stopped = true;
		for (const item of pending.values()) { window.clearTimeout(item.timer); item.reject(new Error("Open-access worker stopped")); }
		pending.clear();
	};
	child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
	child.stderr.resume(); child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		buffer += chunk;
		// Cached OpenAlex pages can be several megabytes; the bound only stops a runaway line.
		if (buffer.length > 64 * 1024 * 1024) { fail(); child.kill(); return; }
		let end;
		while ((end = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
			let response: WorkerResponse;
			try { response = JSON.parse(line) as WorkerResponse; } catch { fail(); child.kill(); return; }
			const item = pending.get(response.id ?? -1);
			if (!item) continue;
			window.clearTimeout(item.timer); pending.delete(response.id!);
			if (response.error) item.reject(new Error(response.error));
			else item.resolve(response);
		}
	});
	const request = (body: Record<string, unknown>): Promise<WorkerResponse> => {
		if (stopped) return Promise.reject(new Error("Open-access worker stopped"));
		return new Promise<WorkerResponse>((resolve, reject) => {
			const id = ++nextId;
			const timer = window.setTimeout(() => { fail(); child.kill(); }, timeout);
			pending.set(id, { resolve: resolve, reject, timer });
			child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
		});
	};
	return {
		get closed() { return stopped; },
		check: (dois, refresh) => request({ dois, refresh }).then(response => results<Array<{ doi: string; value: ProviderRecord }>>(response)),
		cached: dois => request({ dois, cached: true }).then(response => results<Array<{ doi: string; providers: Record<string, ProviderRecord> }>>(response)),
		openAlexRead: url => request({ op: "openalex-read", url }).then(response => response.value ?? null),
		openAlexWrite: async (url, body) => { await request({ op: "openalex-write", url, body }); },
		pause: async (service, state, until) => { await request({ op: "pause", service, state, until }); },
		dispose() { fail(); child.stdin.end(); child.kill(); },
	};
}
