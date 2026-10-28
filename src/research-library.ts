import { needsRefresh } from "./availability-policy";
import { createOpenAccessQueue, type AvailabilityResults, type OpenAccessQueue } from "./open-access-queue";
import type { FetchedEvidence, FetchedVector } from "./fetched-evidence";
import { normalizeDoi } from "./paper";
import { paperDois } from "./work-identity";
import type { LibraryAvailability, PaperLibraryService } from "./library-panel";
import type { StoredTextEvidence } from "./paper-comparison";
import type { AvailabilityWorker, CliResponse, ProviderRecord, ResearchTools } from "./research-tools";
import type { PaperNode } from "./types";

/**
 * The paper workflows backed by the research repository: holdings, availability, Save and
 * Bookmark, SPECTER2 vectors and stored text. Every write and provider call goes
 * through the research CLI; this service orchestrates, caches what the CLI returned, and tells open
 * graphs when something they show has changed.
 */
export interface VaultFile { path: string; extension: string; basename: string }

/** The vault operations the service needs; main.ts adapts Obsidian's App to it. */
export interface LibraryHost {
	files(): VaultFile[];
	frontmatter(path: string): Record<string, unknown> | null;
	resolveLink(link: string, from: string): string | null;
	read(path: string): Promise<string>;
	processFrontMatter(path: string, update: (props: Record<string, unknown>) => void): Promise<void>;
	open(path: string): void;
}

export interface ResearchLibrarySettings { autoOpenAccess: boolean; autoSpecter2: boolean }

export const PAPERS = "Research/Papers/";
const FULL_TEXT = new Set(["pdf", "xml", "html", "htm", "docx", "epub", "txt"]);
const EMBEDDING_PAUSE = 15 * 60_000;

const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const localTitle = (value: unknown): string => text(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const openAlexId = (value: unknown): string | null => /^(?:https?:\/\/openalex\.org\/)?(W\d+)\/?$/i.exec(text(value).trim())?.[1]!.toUpperCase() ?? null;
const fileTitle = (file: VaultFile): string => file.path.split("/").at(-1)!.replace(/\.[^.]+$/, "").replace(/^.+? (?:18|19|20)\d{2}[a-z]? - /i, "");
const fileYear = (file: VaultFile): string | null => /^.+? ((?:18|19|20)\d{2})[a-z]? - /i.exec(file.path.split("/").at(-1)!)?.[1] ?? null;
const propDoi = (value: unknown): string | null => typeof value === "string" ? normalizeDoi(value) : null;
export const bookmarkOf = (props: Record<string, unknown>): boolean => props.bookmark === true;

interface Holding {
	state: "held" | "note-only"; note: string | null; files: string[]; doi: string | null; openalex: string | null;
	year: unknown; bookmark?: boolean; reading?: string; reason?: string;
}
interface HoldingsIndex { doi: Map<string, Holding[]>; openalex: Map<string, Holding[]>; title: Map<string, Holding[]>; note: Map<string, Holding>; files: Set<string> }

// What a graph shows about a note; any other frontmatter edit does not refresh open graphs.
const FINGERPRINT = ["type", "title", "year", "doi", "openalex", "pdf", "fulltext", "full_text", "bookmark", "reading_status", "needs_reason"];
const fingerprint = (props: Record<string, unknown> | null): string => JSON.stringify(FINGERPRINT.map(key => props?.[key] ?? null));

export class ResearchLibrary implements PaperLibraryService {
	private index: HoldingsIndex | null = null;
	private readonly fingerprints = new Map<string, string>();
	private readonly results: AvailabilityResults = new Map();
	private readonly availabilityPending = new Map<string, Promise<LibraryAvailability>>();
	private readonly oa: OpenAccessQueue;
	private writes: Promise<unknown> = Promise.resolve();
	private readonly downloads = new Map<string, Promise<LibraryAvailability>>();
	// SPECTER2: vectors the CLI returned, DOIs already asked about, and the download queue.
	private readonly vectors = new Map<string, number[]>();
	private readonly vectorsChecked = new Set<string>();
	private readonly settled = new Set<string>();
	private readonly embeddingQueue = new Set<string>();
	private readonly embeddingAttempts = new Map<string, number>();
	private embeddingRetryAt = 0;
	private embeddingRunning = false;
	private embeddingTimer: number | null = null;
	private embeddingProgress = { pending: 0, state: "idle" };
	private changedTimer: number | null = null;
	private readonly fetchedVectors = new Map<string, FetchedVector>();
	private readonly fetchedWorks = new Map<string, Record<string, unknown>>();
	private fetchedTimer: number | null = null;
	private closed = false;
	private textLibraryLoad: Promise<Array<{ paper: PaperNode; note: string; vector?: number[] }>> | null = null;

	constructor(private readonly host: LibraryHost, private readonly tools: ResearchTools, private readonly settings: () => ResearchLibrarySettings, private readonly now = Date.now) {
		this.oa = createOpenAccessQueue({ worker: () => tools.worker(), results: this.results, notify: () => this.changed(), enabled: () => settings().autoOpenAccess, now });
	}

	libraryPapers(): Array<{ path: string; title: string }> {
		return this.host.files().filter(f => f.extension === "md" && f.path.startsWith(PAPERS)).map(f => ({ path: f.path, title: text(this.host.frontmatter(f.path)?.title) || f.basename }));
	}

	/** The research CLI's long-lived worker, shared with the OpenAlex cache and provider pauses. */
	worker(): AvailabilityWorker { return this.tools.worker(); }

	dispose(): void {
		this.closed = true;
		if (this.embeddingTimer !== null) window.clearTimeout(this.embeddingTimer);
		if (this.changedTimer !== null) window.clearTimeout(this.changedTimer);
		if (this.fetchedTimer !== null) window.clearTimeout(this.fetchedTimer);
		this.oa.dispose();
		this.tools.dispose();
		window.dispatchEvent(new Event("research-connected-library-changed"));
	}

	/** Open graphs repaint once per burst of changes. */
	changed(): void {
		if (this.changedTimer !== null || this.closed) return;
		this.changedTimer = window.setTimeout(() => {
			this.changedTimer = null;
			if (!this.closed) window.dispatchEvent(new Event("research-connected-library-changed"));
		}, 100);
	}

	/**
	 * A vault event. Only changes a graph can show refresh open graphs, so editing reading notes
	 * does not rerun stored-text loading or open-access prefetch.
	 */
	vaultChanged(path: string, kind: "modify" | "create" | "delete" | "rename"): void {
		const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
		if (extension === "md") {
			const next = kind === "delete" || kind === "rename" ? "" : fingerprint(this.host.frontmatter(path));
			if (kind !== "rename" && this.fingerprints.get(path) === next) return;
			if (next) this.fingerprints.set(path, next); else this.fingerprints.delete(path);
		} else if (!FULL_TEXT.has(extension) && !(extension === "json" && path.startsWith(PAPERS))) return;
		else if (kind === "modify" && extension !== "json") return;
		this.index = null;
		this.changed();
	}

	private holdings(): HoldingsIndex {
		if (this.index) return this.index;
		const files = this.host.files();
		const index: HoldingsIndex = { doi: new Map(), openalex: new Map(), title: new Map(), note: new Map(), files: new Set() };
		const add = (map: Map<string, Holding[]>, key: string | null, item: Holding): void => { if (key) map.set(key, [...(map.get(key) ?? []), item]); };
		const byPath = new Set(files.map(f => f.path));
		const primaryByStem = new Map<string, string[]>();
		for (const file of files) if (FULL_TEXT.has(file.extension.toLowerCase())) {
			index.files.add(file.path);
			const stem = file.path.slice(0, -(file.extension.length + 1));
			primaryByStem.set(stem, [...(primaryByStem.get(stem) ?? []), file.path]);
		}
		const owned = new Set<string>();
		for (const file of files) {
			if (file.extension !== "md") continue;
			const props = this.host.frontmatter(file.path) ?? {};
			this.fingerprints.set(file.path, fingerprint(props));
			const doi = propDoi(props.doi), id = openAlexId(props.openalex);
			if (!file.path.startsWith(PAPERS) && !doi && !id && props.type !== "source") continue;
			const primary = [...(primaryByStem.get(file.path.slice(0, -3)) ?? [])];
			// Explicit full-text properties can point to renamed attachments in another vault folder.
			for (const field of ["pdf", "fulltext", "full_text"]) for (const value of [props[field]].flat()) {
				if (typeof value !== "string" || /^https?:\/\//i.test(value)) continue;
				const link = value.replace(/^!?\[\[|\]\]$/g, "").split("|")[0]!.split("#")[0]!;
				const sibling = `${file.path.slice(0, file.path.lastIndexOf("/") + 1)}${link}`;
				const target = this.host.resolveLink(link, file.path) ?? (byPath.has(link) ? link : byPath.has(sibling) ? sibling : null);
				if (target && index.files.has(target)) primary.push(target);
			}
			const item: Holding = { state: primary.length ? "held" : "note-only", note: file.path, files: [...new Set(primary)], doi, openalex: id,
				year: props.year || fileYear(file), bookmark: bookmarkOf(props), reading: typeof props.reading_status === "string" ? props.reading_status : undefined,
				reason: typeof props.needs_reason === "string" ? props.needs_reason : "" };
			index.note.set(file.path, item);
			for (const path of item.files) owned.add(path);
			add(index.doi, doi, item); add(index.openalex, id, item);
			add(index.title, localTitle(props.title || fileTitle(file)), item);
		}
		// A full text can exist before a note is imported. Match its complete filename title only.
		for (const file of files) if (index.files.has(file.path) && !owned.has(file.path)) {
			add(index.title, localTitle(fileTitle(file)), { state: "held", note: null, files: [file.path], doi: null, openalex: null, year: fileYear(file) });
		}
		return this.index = index;
	}

	read(paper: PaperNode): LibraryAvailability {
		const index = this.holdings();
		const dois = paperDois(paper);
		this.oa.load(dois);
		const ids = [...new Set([paper.id, paper.openAlexUrl, ...(paper.records ?? []).flatMap(p => [p.id, p.openAlexUrl])].map(openAlexId).filter((id): id is string => !!id))];
		const localPath = paper.id.startsWith("local:") ? paper.id.slice(6) : "";
		const exact: Holding | null = index.note.get(localPath) ?? (index.files.has(localPath) ? { state: "held", note: null, files: [localPath], doi: null, openalex: null, year: null } : null);
		let candidates: Holding[] = exact ? [exact] : dois.flatMap(d => index.doi.get(d) ?? []);
		let matchedBy: "doi" | "openalex" | "title" | "file" = exact ? "file" : "doi";
		if (!candidates.length) { candidates = ids.flatMap(id => index.openalex.get(id) ?? []).filter(s => !s.doi || !dois.length || dois.includes(s.doi)); matchedBy = "openalex"; }
		if (!candidates.length) {
			matchedBy = "title";
			for (const record of [paper, ...(paper.records ?? [])]) {
				const title = localTitle(record.title);
				if (title.length < 24) continue;
				candidates.push(...(index.title.get(title) ?? []).filter(s => (!s.doi || !dois.length || dois.includes(s.doi))
					&& (!s.openalex || !ids.length || ids.includes(s.openalex)) && (!s.year || !record.year || text(s.year) === text(record.year))));
			}
		}
		const matches = [...new Map(candidates.map(s => [s.note ?? s.files.join("\n"), s])).values()];
		const match = matches[0];
		const local: LibraryAvailability["local"] = matches.length > 1 ? { state: "ambiguous", files: [], note: null }
			: match ? { state: match.state, files: match.files, note: match.note, matchedBy, bookmark: match.bookmark, reading: match.reading, reason: match.reason }
				: { state: "absent", files: [], note: null };
		const remote = dois.map(d => this.results.get(d)).find(Boolean);
		const providers: LibraryAvailability["providers"] = Object.fromEntries(Object.entries(remote?.providers ?? {}).map(([name, value]) => [name, this.oa.view(value, name)]));
		if (dois.some(d => this.oa.isPending(d))) providers.oa = { ...(providers.oa ?? { state: "checking" }), checking: true };
		return { doi: dois[0] ?? null, local, providers, checking: dois.some(d => this.availabilityPending.has(d)) };
	}

	open(note: string): void { this.host.open(note); }

	prefetch(papers: readonly PaperNode[]): void {
		void this.oa.prefetch(papers.flatMap(paper => paperDois(paper))).catch(() => {});
	}

	save(paper: PaperNode): Promise<LibraryAvailability> { return this.keep(paper, { download: true }); }

	bookmark(paper: PaperNode, value: boolean): Promise<LibraryAvailability> {
		return this.keep(paper, { bookmark: value });
	}

	// Serialize mutations across panes and embeds; repeated acquisitions share one in-flight request.
	private keep(paper: PaperNode, options: { download?: boolean; bookmark?: boolean }): Promise<LibraryAvailability> {
		const key = paperDois(paper)[0] || openAlexId(paper.openAlexUrl || paper.id) || localTitle(paper.title);
		const running = options.download ? this.downloads.get(key) : undefined;
		if (running) return running;
		const task = this.writes.catch(() => {}).then(async (): Promise<LibraryAvailability> => {
			const local = this.read(paper).local;
			if (local.state === "ambiguous") throw new Error("Multiple library notes match. Review them before saving.");
			if (local.note && !options.download) {
				await this.host.processFrontMatter(local.note, props => { props.bookmark = options.bookmark; });
				this.index = null; this.changed();
				return this.read(paper);
			}
			if (local.note && !local.note.startsWith(PAPERS)) {
				if (local.state === "held") return this.read(paper);
				await this.host.processFrontMatter(local.note, props => {
					props.needs = "you"; props.needs_reason = "unsupported-location"; props.acquisition_status = "failed"; props.acquisition_attempted_at = new Date(this.now()).toISOString();
				});
				this.index = null; this.changed();
				const current = this.read(paper);
				return { ...current, local: { ...current.local, reason: "unsupported-location" } };
			}
			const metadata = { title: paper.title, doi: paperDois(paper)[0] ?? null, openalex: openAlexId(paper.openAlexUrl || paper.id),
				authors: paper.authorList?.filter(Boolean) ?? [], year: paper.year, abstract: paper.abstract,
				note: local.note, files: local.files };
			// Metadata goes on stdin: long abstracts and author lists exceed Windows' argument limit.
			const args = ["keep", "-"];
			if (options.download) args.push("--download");
			if (typeof options.bookmark === "boolean") args.push(options.bookmark ? "--bookmark" : "--unbookmark");
			const response = await this.tools.json(args, { acceptFailure: true, input: JSON.stringify(metadata) });
			const outcome = response.results?.[0];
			this.index = null; this.changed();
			const data = outcome?.data as { note?: string; held?: boolean; bookmark?: boolean; reading_status?: string; reason?: string; attemptedAt?: string } | undefined;
			if (!data?.note) throw new Error(outcome?.detail || "The library note could not be created.");
			// CLI writes precede Obsidian indexing. Return confirmed data for immediate button state.
			const current = this.read(paper);
			return { ...current, local: { ...current.local, note: data.note, state: data.held ? "held" : "note-only", bookmark: data.bookmark, reading: data.reading_status,
				reason: data.reason || (outcome!.status === "failed" ? outcome!.reason || "network" : ""), attemptedAt: data.attemptedAt } };
		});
		this.writes = task;
		if (options.download) {
			this.downloads.set(key, task);
			void task.finally(() => { if (this.downloads.get(key) === task) this.downloads.delete(key); }).catch(() => {});
		}
		return task;
	}

	async check(paper: PaperNode, { provider = "all", refresh = false, local = false }: { provider?: string; refresh?: boolean; local?: boolean } = {}): Promise<LibraryAvailability> {
		const doi = paperDois(paper)[0];
		if (!doi) throw new Error("A DOI is required for availability checks.");
		if (!local && (provider === "oa" || provider === "all")) {
			await this.oa.check(doi, { force: refresh });
			if (provider === "oa") return this.read(paper);
			provider = "scihub";
		}
		const key = `${doi}:${provider}:${local}:${refresh}`;
		const running = this.availabilityPending.get(key);
		if (running) return running;
		const task = (async (): Promise<LibraryAvailability> => {
			const args = ["availability", doi, "--provider", provider];
			if (local) args.push("--local"); else if (refresh) args.push("--refresh");
			const response = await this.tools.json(args);
			const value = response.results?.find(r => r.reason === "availability")?.data as { providers?: Record<string, ProviderRecord> } | undefined;
			if (!value) throw new Error(response.results?.map(r => r.detail || r.reason).join("; ") || "Availability returned no result.");
			const updates = Object.fromEntries(Object.entries(value.providers ?? {}).filter(([, p]) => p.state !== "not-checked"));
			const old = this.results.get(doi);
			this.results.set(doi, { providers: { ...old?.providers, ...updates } });
			return { ...this.read(paper), ...value, local: this.read(paper).local };
		})();
		this.availabilityPending.set(key, task); this.availabilityPending.set(doi, task);
		this.changed();
		try { return await task; }
		finally {
			this.availabilityPending.delete(key);
			if (this.availabilityPending.get(doi) === task) this.availabilityPending.delete(doi);
			this.changed();
		}
	}

	embeddingStatus(): { pending: number; state: string } { return this.embeddingProgress; }

	/**
	 * Stored SPECTER2 vectors by DOI, asking the CLI only about DOIs not seen yet. The same call
	 * reports recently answered lookups and a provider pause, so only real downloads are queued.
	 */
	private async cachedVectors(dois: readonly string[]): Promise<Map<string, number[]>> {
		const unknown = [...new Set(dois)].filter(doi => !this.vectorsChecked.has(doi));
		if (unknown.length) {
			try {
				const response = await this.tools.json(["embeddings", "--cached"], { acceptFailure: true, input: unknown.join("\n") });
				// Every DOI asked counts as checked, including ones the CLI rejects or writes differently;
				// otherwise each batch of a library would start another process for them.
				if (response.results) for (const doi of unknown) this.vectorsChecked.add(doi);
				for (const row of response.results ?? []) {
					const data = row.data as { doi?: string; vector?: number[]; settled?: boolean } | undefined;
					if (!data?.doi) continue;
					this.vectorsChecked.add(data.doi);
					if (data.vector) this.vectors.set(data.doi, data.vector);
					if (data.settled) this.settled.add(data.doi); else this.settled.delete(data.doi);
				}
				const cooldown = (response as CliResponse & { cooldown?: { until: number; state: string } }).cooldown;
				if (cooldown && cooldown.until > this.now()) {
					this.embeddingRetryAt = cooldown.until;
					if (!this.embeddingRunning) this.embeddingProgress = { pending: 0, state: cooldown.state };
				}
			} catch { /* Word overlap is used for papers without a vector. */ }
		}
		return this.vectors;
	}

	// Queue only DOIs the CLI would actually fetch: no cached vector and no recent provider answer.
	private prefetchEmbeddings(papers: readonly PaperNode[]): void {
		if (!this.settings().autoSpecter2 || this.closed || this.now() < this.embeddingRetryAt) return;
		const now = this.now();
		for (const paper of papers) for (const doi of paperDois(paper)) {
			if (this.vectors.has(doi) || this.settled.has(doi) || now - (this.embeddingAttempts.get(doi) ?? 0) < EMBEDDING_PAUSE) continue;
			this.embeddingQueue.add(doi);
		}
		if (!this.embeddingQueue.size || this.embeddingRunning || this.embeddingTimer !== null) return;
		this.embeddingProgress = { pending: this.embeddingQueue.size, state: "downloading" };
		this.embeddingTimer = window.setTimeout(() => { this.embeddingTimer = null; void this.drainEmbeddings(); }, 150);
	}

	private async drainEmbeddings(): Promise<void> {
		if (this.closed || !this.settings().autoSpecter2 || this.embeddingRunning) return;
		this.embeddingRunning = true;
		let state = "ready";
		try {
			while (this.embeddingQueue.size && !this.closed && this.settings().autoSpecter2) {
				const dois = [...this.embeddingQueue].slice(0, 100);
				for (const doi of dois) { this.embeddingQueue.delete(doi); this.embeddingAttempts.set(doi, this.now()); this.vectorsChecked.delete(doi); }
				this.embeddingProgress = { pending: dois.length + this.embeddingQueue.size, state: "downloading" };
				const response = await this.tools.json(["embeddings", "--remote", ...dois], { acceptFailure: true });
				const failed = response.results?.find(row => row.status === "failed" || row.status === "invalid");
				this.changed();
				if (failed) { state = failed.reason || "provider-error"; break; }
				if (this.embeddingQueue.size) await new Promise(resolve => window.setTimeout(resolve, 1100));
			}
		} catch { state = "network"; }
		finally {
			// A failed batch pauses the whole queue, including other graph panes, for 15 minutes.
			for (const doi of this.embeddingQueue) this.embeddingAttempts.set(doi, this.now());
			this.embeddingQueue.clear(); this.embeddingRunning = false;
			if (state !== "ready") this.embeddingRetryAt = this.now() + EMBEDDING_PAUSE;
			this.embeddingProgress = { pending: 0, state };
			this.changed();
		}
	}

	async textEvidence(papers: readonly PaperNode[]): Promise<StoredTextEvidence[]> {
		const rows = await this.storedTextEvidence(papers);
		this.prefetchEmbeddings(papers);
		return rows;
	}

	private async storedTextEvidence(papers: readonly PaperNode[]): Promise<StoredTextEvidence[]> {
		const targets = papers.map(paper => {
			const status = this.read(paper);
			const note = status.local.note && status.local.state !== "ambiguous" ? status.local.note : null;
			return { paper, note, graphDois: paperDois(paper), doi: note ? propDoi(this.host.frontmatter(note)?.doi) : null };
		});
		const vectors = await this.cachedVectors(targets.flatMap(t => [...t.graphDois, ...(t.doi ? [t.doi] : [])]));
		const rows = await Promise.all(targets.map(async ({ paper, note, graphDois, doi }): Promise<StoredTextEvidence | null> => {
			const cached = graphDois.map(d => vectors.get(d)).find(Boolean);
			const fallback = cached ? { id: paper.id, vector: cached } : null;
			if (!note) return fallback;
			if (doi && graphDois.length && !graphDois.includes(doi)) return null;
			try {
				const data = JSON.parse(await this.host.read(note.replace(/\.md$/i, ".json"))) as { card?: { summary?: unknown } };
				const own = doi ? vectors.get(doi) : undefined;
				return { id: paper.id, summary: typeof data.card?.summary === "string" ? data.card.summary : "", ...(own ? { vector: own } : cached ? { vector: cached } : {}) };
			} catch { return fallback; }
		}));
		return rows.filter((row): row is StoredTextEvidence => !!row);
	}

	/** Panes and embeds that ask while a load is running share it; each finished load starts fresh. */
	textLibrary(): Promise<Array<{ paper: PaperNode; note: string; vector?: number[] }>> {
		if (!this.textLibraryLoad) this.textLibraryLoad = this.loadTextLibrary().finally(() => { this.textLibraryLoad = null; });
		return this.textLibraryLoad;
	}

	private async loadTextLibrary(): Promise<Array<{ paper: PaperNode; note: string; vector?: number[] }>> {
		const rows = this.host.files().filter(file => file.extension === "md" && file.path.startsWith(PAPERS) && this.host.frontmatter(file.path)?.type === "source").map((file): { note: string; paper: PaperNode; vector?: number[] } => {
			const props = this.host.frontmatter(file.path) ?? {};
			const doi = propDoi(props.doi), openalex = openAlexId(props.openalex);
			const paper: PaperNode = { id: `local:${file.path}`, title: text(props.title) || file.basename,
				year: Number.isFinite(Number(props.year)) && props.year ? Number(props.year) : null,
				citedByCount: 0, authors: "", authorList: [], abstract: "", doiUrl: doi ? `https://doi.org/${doi}` : null,
				openAlexUrl: openalex ? `https://openalex.org/${openalex}` : "", isSeed: false, origin: "related", language: null, workType: null, venue: null, concepts: [], retracted: false };
			return { note: file.path, paper };
		});
		// One CLI call reads every stored vector; the batches below then find them in memory.
		await this.cachedVectors(rows.flatMap(row => paperDois(row.paper)));
		// Bound simultaneous sidecar reads; malformed or missing sidecars never remove a source note.
		for (let start = 0; start < rows.length; start += 32) {
			const batch = rows.slice(start, start + 32);
			const evidence = new Map((await this.storedTextEvidence(batch.map(row => row.paper))).map(row => [row.id, row]));
			for (const row of batch) {
				const stored = evidence.get(row.paper.id);
				row.paper.abstract = stored?.summary || "";
				if (stored?.vector) row.vector = [...stored.vector];
			}
		}
		this.prefetchEmbeddings(rows.map(row => row.paper));
		return rows;
	}

	/** Collects what graph builds fetched and stores it in one CLI call per kind every few seconds. */
	queueFetched(evidence: FetchedEvidence): void {
		if (this.closed) return;
		for (const row of evidence.vectors ?? []) { const doi = normalizeDoi(row.doi); if (doi && !this.vectors.has(doi)) this.fetchedVectors.set(doi, { ...row, doi }); }
		for (const work of evidence.works ?? []) {
			const doi = typeof work.doi === "string" ? normalizeDoi(work.doi) : null;
			// A result the worker already holds fresh needs no rewrite.
			if (doi && needsRefresh(this.results.get(doi)?.providers.oa, "oa", this.now())) this.fetchedWorks.set(doi, work);
		}
		if (this.fetchedTimer !== null || !(this.fetchedVectors.size || this.fetchedWorks.size)) return;
		this.fetchedTimer = window.setTimeout(() => {
			this.fetchedTimer = null;
			const batch = { vectors: [...this.fetchedVectors.values()], works: [...this.fetchedWorks.values()] };
			this.fetchedVectors.clear(); this.fetchedWorks.clear();
			void this.storeFetched(batch).catch(() => { /* The CLI downloads these itself when asked. */ });
		}, 2000);
	}

	/**
	 * Evidence a graph build already fetched: SPECTER2 vectors from the Semantic Scholar batch and
	 * OpenAlex open-access fields. The CLI caches them so neither is downloaded a second time.
	 */
	async storeFetched(evidence: FetchedEvidence): Promise<void> {
		const vectors = (evidence.vectors ?? []).filter(row => !this.vectors.has(row.doi));
		const works = evidence.works ?? [];
		if (vectors.length) {
			const response = await this.tools.json(["embeddings", "--store"], { acceptFailure: true, input: JSON.stringify(vectors) });
			const stored = new Set((response.results ?? []).filter(row => row.status === "ok").map(row => row.subject));
			for (const row of vectors) if (stored.has(row.doi)) { this.vectors.set(row.doi, row.vector); this.vectorsChecked.add(row.doi); }
		}
		if (works.length) {
			const response = await this.tools.json(["availability", "--store"], { acceptFailure: true, input: JSON.stringify(works) });
			// The worker now holds fresh results; read them again on the next display.
			const dois = (response.results ?? []).filter(row => row.status === "ok").map(row => row.subject!).filter(Boolean);
			if (dois.length) { this.oa.forget(dois); this.oa.load(dois); }
		}
	}
}
