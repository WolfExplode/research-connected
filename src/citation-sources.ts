import { reportFetched, type FetchedVector } from "./fetched-evidence";
import { tr } from "./i18n";
import type { GetJson } from "./openalex";
import { cleanAbstractText, normalizeDoi } from "./paper";
import { limitedRequest } from "./provider-limits";

export interface OpenCitationRow {
	oci?: string;
	citing?: string;
	cited?: string;
	creation?: string;
}

export interface CrossrefWork {
	DOI?: string;
	abstract?: string;
	reference?: Array<{ DOI?: string; unstructured?: string }>;
}

/** Public Crossref DOI metadata, used only as a bounded fallback. */
export class CrossrefClient {
	constructor(private readonly getJson: GetJson, private readonly contactEmail: string) {}

	async work(doi: string): Promise<CrossrefWork | null> {
		const encodedDoi = encodeURIComponent(doi).replace(/%2F/gi, "/");
		const url = new URL(`https://api.crossref.org/works/${encodedDoi}`);
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.contactEmail)) url.searchParams.set("mailto", this.contactEmail);
		const json = await cachedGet(this.getJson, url.toString(), { headers: { Accept: "application/json" } });
		if (!json || typeof json !== "object") throw new CitationSourceError(tr("Crossref 返回格式错误。", "Crossref returned an invalid response."));
		const message = (json as { message?: unknown }).message;
		if (!message || typeof message !== "object") throw new CitationSourceError(tr("Crossref 未返回作品元数据。", "Crossref returned no work metadata."));
		return message;
	}

	async referenceDois(doi: string): Promise<string[]> {
		const work = await this.work(doi);
		return [...new Set((work?.reference ?? []).flatMap((row) => {
			const value = row.DOI?.trim().toLowerCase();
			return value ? [value] : [];
		}))];
	}

	async abstract(doi: string): Promise<string | null> {
		const work = await this.work(doi);
		if (!work?.abstract) return null;
		const text = work.abstract
			.replace(/<[^>]*>/g, " ")
			.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
			.replace(/\s+/g, " ").trim();
		return cleanAbstractText(text) || null;
	}
}

export class CitationSourceError extends Error {}

const S2_QUOTA_TEXT = tr("Semantic Scholar 额度已用完或请求过快。可在设置中填写 API 密钥，或稍后再试。", "Semantic Scholar rate limit reached. Add an API key in settings or try again later.");
const S2_QUOTA_MESSAGE = /too many requests|rate.?limit|quota|throttl/i;

/** Compact description of an unexpected Semantic Scholar payload, for diagnostics. */
function describeS2Shape(json: unknown): string {
	if (json === null) return "null";
	if (Array.isArray(json)) return tr(`数组(${json.length} 条)`, `Array (${json.length} items)`);
	if (typeof json === "object") {
		const keys = Object.keys(json).slice(0, 6).join(", ");
		const message = (json as { message?: unknown }).message;
		return `{${keys}}${typeof message === "string" ? tr(`，message="${message.slice(0, 160)}"`, `, message="${message.slice(0, 160)}"`) : ""}`;
	}
	return typeof json;
}

/**
 * S2 edge nodes occasionally answer 200 with an error body instead of data.
 * Log the actual shape so swallowed reconcile failures stay diagnosable, and
 * map recognizable quota messages back to the quota wording.
 */
function s2FormatError(context: string, json: unknown): CitationSourceError {
	console.warn(tr(`[research-connected] Semantic Scholar ${context}返回了非预期结构：${describeS2Shape(json)}`, `[research-connected] Semantic Scholar ${context} returned an unexpected structure: ${describeS2Shape(json)}`), json);
	const message = json && typeof json === "object" ? (json as { message?: unknown }).message : undefined;
	if (typeof message === "string" && S2_QUOTA_MESSAGE.test(message)) return new CitationSourceError(S2_QUOTA_TEXT);
	return new CitationSourceError(tr(`Semantic Scholar ${context}返回格式错误。`, `Semantic Scholar ${context} returned an invalid response.`));
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class OpenCitationsClient {
	constructor(private readonly getJson: GetJson, private readonly token: string) {}

	async references(doi: string): Promise<OpenCitationRow[]> {
		return this.rows(`https://api.opencitations.net/index/v2/references/doi:${encodeURIComponent(doi)}`);
	}

	private async rows(url: string): Promise<OpenCitationRow[]> {
		const json = await cachedGet(this.getJson, url, {
			headers: {
				Accept: "application/json",
				...(this.token ? { authorization: this.token } : {}),
			},
		});
		if (!Array.isArray(json)) throw new CitationSourceError(tr("OpenCitations 返回格式错误。", "OpenCitations returned an invalid response."));
		return json as OpenCitationRow[];
	}
}

export type PostJson = (
	url: string,
	init: { headers: Record<string, string>; body: string },
) => Promise<unknown>;

export interface S2Counts {
	citationCount: number | null;
	referenceCount: number | null;
	/** SPECTER2 vector, present only when the request asked for embeddings. */
	embedding?: number[] | null;
}

export interface SemanticCitation {
	citedPaper?: { paperId?: string; externalIds?: Record<string, string | null> | null };
	citingPaper?: {
		paperId?: string;
		title?: string | null;
		year?: number | null;
		externalIds?: Record<string, string | null> | null;
	};
	contexts?: string[] | null;
	intents?: string[] | null;
	isInfluential?: boolean | null;
}

export class SemanticScholarClient {
	constructor(
		private readonly getJson: GetJson,
		private readonly apiKey: string,
		private readonly postJson?: PostJson,
	) {}

	/** Model name of the embeddings returned by the last bulkCounts call (null when none). */
	embeddingModel: string | null = null;

	/**
	 * One batched lookup (POST /paper/batch, up to 500 ids) that cross-checks
	 * OpenAlex numbers. Keys of the returned map are the lowercased DOIs that
	 * Semantic Scholar recognized. With `opts.embedding` the same request also
	 * asks for SPECTER2 vectors; a chunk that fails with embeddings is retried
	 * without them so semantic scoring can never endanger the cross-check.
	 */
	async bulkCounts(dois: string[], opts?: { embedding?: boolean }): Promise<Map<string, S2Counts>> {
		if (!this.postJson || dois.length === 0) return new Map();
		const base = "https://api.semanticscholar.org/graph/v1/paper/batch";
		const fields = opts?.embedding
			? "citationCount,referenceCount,externalIds,embedding.specter_v2"
			: "citationCount,referenceCount,externalIds";
		const out = new Map<string, S2Counts>();
		const fetched: FetchedVector[] = [];
		this.embeddingModel = null;
		for (let i = 0; i < dois.length; i += 500) {
			const chunk = dois.slice(i, i + 500);
			const body = JSON.stringify({ ids: chunk.map((doi) => `DOI:${doi}`) });
			let json: unknown = null;
			let ok = false;
			let lastError: unknown = new CitationSourceError(tr("Semantic Scholar 批量接口返回格式错误。", "Semantic Scholar bulk API returned an invalid response."));
			const attempt = async (fieldSet: string): Promise<boolean> => {
				const url = new URL(base);
				url.searchParams.set("fields", fieldSet);
				try {
					json = await limitedRequest(url.toString(), () => this.postJson!(url.toString(), {
						headers: {
							Accept: "application/json",
							"Content-Type": "application/json",
							...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
						},
						body,
					}));
					if (Array.isArray(json)) return true;
					lastError = s2FormatError(tr("批量接口", "bulk API"), json);
				} catch (error) {
					lastError = error;
				}
				return false;
			};
			if (await attempt(fields)) ok = true;
			else {
				await pause(1200);
				if (await attempt(fields)) ok = true;
				// Embedding field rejected outright (e.g. endpoint change): drop to counts-only.
				else if (opts?.embedding && (await attempt("citationCount,referenceCount,externalIds"))) ok = true;
			}
			if (!ok) throw lastError;
			for (const item of json as Array<{
				paperId?: string | null;
				citationCount?: number | null;
				referenceCount?: number | null;
				externalIds?: Record<string, string | null> | null;
				embedding?: { model?: string | null; vector?: number[] | null } | null;
			} | null>) {
				const doi = item?.externalIds?.DOI?.toLowerCase();
				if (!item || !doi) continue;
				const candidate = item.embedding?.vector;
				const vector = item.embedding?.model === "specter_v2" && Array.isArray(candidate) && candidate.length === 768
					&& candidate.every(Number.isFinite) && candidate.some(value => value !== 0) ? candidate : null;
				if (vector && item.embedding?.model && !this.embeddingModel) this.embeddingModel = item.embedding.model;
				if (vector && typeof item.paperId === "string" && item.paperId) fetched.push({ doi, paperId: item.paperId, vector });
				out.set(doi, {
					citationCount: typeof item.citationCount === "number" ? item.citationCount : null,
					referenceCount: typeof item.referenceCount === "number" ? item.referenceCount : null,
					...(opts?.embedding ? { embedding: vector } : {}),
				});
			}
		}
		reportFetched({ vectors: fetched });
		return out;
	}

	/**
	 * DOIs of the works this paper references, one page of up to 1000. Used to
	 * backfill reference lists that OpenAlex does not have.
	 */
	async referenceDois(doi: string): Promise<string[]> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/references`);
		url.searchParams.set("fields", "externalIds");
		url.searchParams.set("limit", "1000");
		const result = await this.getList<{ citedPaper?: { externalIds?: Record<string, string | null> | null } | null }>(url.toString(), tr("参考文献接口", "reference API"));
		const dois: string[] = [];
		for (const row of result.data) {
			const ref = row?.citedPaper?.externalIds?.DOI?.toLowerCase();
			if (ref) dois.push(ref);
		}
		return dois;
	}

	async referenceEvidence(doi: string): Promise<{ data: SemanticCitation[]; partial: boolean }> {
		const data: SemanticCitation[] = [];
		let offset = 0;
		for (let page = 0; page < 3; page++) {
			const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/references`);
			url.searchParams.set("fields", "contexts,intents,isInfluential,title,year,externalIds");
			url.searchParams.set("limit", "1000");
			url.searchParams.set("offset", String(offset));
			const result = await this.getList<SemanticCitation>(url.toString(), tr("引用语义接口", "citation intent API"));
			data.push(...result.data);
			if (typeof result.next !== "number") return { data, partial: false };
			if (result.next <= offset) throw new CitationSourceError(tr("Semantic Scholar 分页无进展。", "Semantic Scholar pagination made no progress."));
			offset = result.next;
		}
		return { data, partial: true };
	}

	/** Single-paper abstract lookup, used when OpenAlex has none. */
	async abstract(doi: string): Promise<string | null> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`);
		url.searchParams.set("fields", "abstract");
		const result = (await this.get(url.toString())) as { abstract?: string | null };
		const text = typeof result.abstract === "string" ? cleanAbstractText(result.abstract) : "";
		return text || null;
	}

	/**
	 * GET a paged list endpoint with one retry: S2 edge nodes occasionally
	 * answer 200 with an error body, which a fresh request usually fixes.
	 */
	private async getList<T>(url: string, context: string): Promise<{ data: T[]; next?: number }> {
		let lastError: unknown = new CitationSourceError(tr(`Semantic Scholar ${context}返回格式错误。`, `Semantic Scholar ${context} returned an invalid response.`));
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt > 0) await pause(1200);
			let result: unknown;
			try {
				result = await this.get(url);
			} catch (error) {
				lastError = error;
				continue;
			}
			if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) {
				return result as { data: T[]; next?: number };
			}
			lastError = s2FormatError(context, result);
		}
		throw lastError;
	}

	private async get(url: string): Promise<unknown> {
		const json = await cachedGet(this.getJson, url, { headers: this.headers() });
		if (!json || typeof json !== "object") throw s2FormatError(tr("接口", "API"), json);
		return json;
	}

	private headers(): Record<string, string> {
		return {
			Accept: "application/json",
			...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
		};
	}
}

export function doisFromOpenCitation(row: OpenCitationRow): { citing: string[]; cited: string[] } {
	return { citing: pids(row.citing), cited: pids(row.cited) };
}

/** Bare DOI from a paper's https://doi.org/ link, or null when the paper has none. */
export function doiFromPaper(paper: { doiUrl: string | null }): string | null {
	return normalizeDoi(paper.doiUrl);
}

/**
 * OpenAlex has no abstract for many papers (Nature and friends deposit
 * none). Ask Semantic Scholar for one; null means "don't bother again".
 */
export async function semanticAbstract(
	getJson: GetJson,
	apiKey: string,
	paper: { doiUrl: string | null },
): Promise<string | null> {
	const doi = doiFromPaper(paper);
	if (!doi) return null;
	try {
		return await new SemanticScholarClient(getJson, apiKey).abstract(doi);
	} catch {
		return null;
	}
}

export async function crossrefAbstract(
	getJson: GetJson,
	contactEmail: string,
	paper: { doiUrl: string | null },
): Promise<string | null> {
	const doi = doiFromPaper(paper);
	if (!doi) return null;
	try { return await new CrossrefClient(getJson, contactEmail).abstract(doi); }
	catch { return null; }
}

function pids(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(/\bdoi:([^\s;]+)/gi)].map(match => match[1]!.toLowerCase());
}

const responses = new Map<string, { at: number; result: Promise<unknown> }>();

async function cachedGet(get: GetJson, url: string, init: { headers: Record<string, string> }): Promise<unknown> {
	const key = url + JSON.stringify(init.headers);
	const cached = responses.get(key);
	if (cached && Date.now() - cached.at < 300_000) return cached.result;
	const result = limitedRequest(url, () => get(url, init));
	if (responses.size >= 200) responses.delete(responses.keys().next().value!);
	responses.set(key, { at: Date.now(), result });
	try { return await result; } catch (error) { responses.delete(key); throw error; }
}
