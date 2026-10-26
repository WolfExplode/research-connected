import { createHash } from "crypto";
import { existsSync, promises as fs } from "fs";
import { dirname, join } from "path";
import { gunzip, gzip } from "zlib";
import type { OpenAlexCacheStore } from "./openalex";

/**
 * The research CLI's OpenAlex response cache (`.cache/research/openalex/<k[0:2]>/<k>.json.gz`),
 * so a work fetched by the plugin or by a CLI command is not fetched again by the other. This
 * mirrors Tools/research/openalex-cache.cjs; both repositories pin the format with the same golden
 * keys. The key hashes the request without credentials, and the record keeps only the URL path,
 * so search text never reaches disk. A file's mtime is its last use; the least recently used files
 * go first when the cache outgrows its cap.
 */
const VERSION = 1;
const DAY = 86_400_000;
// Citation counts and citing lists change; a work's references and identity rarely do.
export const TTL_DAYS = { work: 30, references: 30, batch: 30, citing: 7, related: 7, search: 7, list: 1 } as const;
export type CacheKind = keyof typeof TTL_DAYS;
// Bounds a corrupt or clock-skewed record; the longest real lifetime is 30 days.
const MAX_TTL = 31 * DAY;
const MAX_BYTES = 500 * 1024 * 1024;
const SWEEP_EVERY = 10 * 60_000;
const CREDENTIALS = new Set(["api_key", "mailto"]);

interface CacheRecord { v: number; kind: CacheKind; path: string; storedAt: number; expiresAt: number; body: unknown }

/** The request without credentials, with parameters sorted and OpenAlex's `per-page` spelling folded. */
export function canonicalRequest(url: string): string {
	const parsed = new URL(url);
	let path = decodeURIComponent(parsed.pathname);
	if (/^\/works\/doi:/i.test(path)) path = path.toLowerCase();
	const params = [...parsed.searchParams]
		.map(([name, value]): [string, string] => [name.replace(/-/g, "_"), value])
		.filter(([name]) => !CREDENTIALS.has(name))
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
	const query = new URLSearchParams(params).toString();
	return `${parsed.origin.toLowerCase()}${path}${query ? `?${query}` : ""}`;
}

export function cacheKey(url: string): string {
	return createHash("sha256").update(canonicalRequest(url)).digest("hex");
}

export function cacheKind(url: string): CacheKind {
	const parsed = new URL(url);
	if (/^\/works\/(?:doi:.+|[^/]+)$/i.test(decodeURIComponent(parsed.pathname))) return "work";
	const filter = parsed.searchParams.get("filter") ?? "";
	if ([...parsed.searchParams.keys()].some((name) => name === "search" || name.startsWith("search.")) || /(^|,)[a-z_.]*\.search:/.test(filter)) return "search";
	if (/(^|,)cited_by:/.test(filter)) return "references";
	if (/(^|,)cites:/.test(filter)) return "citing";
	if (/(^|,)related_to:/.test(filter)) return "related";
	if (/(^|,)(openalex|ids\.openalex):/.test(filter)) return "batch";
	return "list";
}

function isOpenAlex(url: string): boolean {
	try { return new URL(url).hostname === "api.openalex.org"; } catch { return false; }
}

const zip = (data: Buffer): Promise<Buffer> => new Promise((resolve, reject) => gzip(data, (error, out) => (error ? reject(error) : resolve(out))));
const unzip = (data: Buffer): Promise<Buffer> => new Promise((resolve, reject) => gunzip(data, (error, out) => (error ? reject(error) : resolve(out))));

/** Null when the folder is not a research repository; the plugin then caches nothing on disk. */
export function openAlexCacheFiles(repository: string, options: { maxBytes?: number; now?: () => number } = {}): (OpenAlexCacheStore & { sweep(): Promise<{ files: number; bytes: number; removed: number }> }) | null {
	if (!existsSync(join(repository, "Tools", "research", "cli.js"))) return null;
	const root = join(repository, ".cache", "research", "openalex");
	const maxBytes = options.maxBytes ?? MAX_BYTES;
	const now = options.now ?? Date.now;
	const fileFor = (key: string): string => join(root, key.slice(0, 2), `${key}.json.gz`);
	let lastSweep = 0;

	async function sweep(): Promise<{ files: number; bytes: number; removed: number }> {
		const files: Array<{ file: string; size: number; used: number }> = [];
		let total = 0;
		let shards: string[] = [];
		try { shards = await fs.readdir(root); } catch { return { files: 0, bytes: 0, removed: 0 }; }
		for (const shard of shards) {
			let names: string[] = [];
			try { names = await fs.readdir(join(root, shard)); } catch { continue; }
			for (const name of names) {
				if (!name.endsWith(".json.gz")) continue;
				const file = join(root, shard, name);
				try { const stat = await fs.stat(file); files.push({ file, size: stat.size, used: stat.mtimeMs }); total += stat.size; } catch { /* Removed meanwhile. */ }
			}
		}
		let removed = 0;
		if (total > maxBytes) {
			files.sort((a, b) => a.used - b.used);
			for (const entry of files) {
				if (total <= maxBytes * 0.9) break;
				try { await fs.unlink(entry.file); total -= entry.size; removed += 1; } catch { /* Removed meanwhile. */ }
			}
		}
		return { files: files.length - removed, bytes: total, removed };
	}

	return {
		async read(url) {
			if (!isOpenAlex(url)) return undefined;
			const file = fileFor(cacheKey(url)), at = now();
			let record: Partial<CacheRecord>;
			try { record = JSON.parse((await unzip(await fs.readFile(file))).toString("utf8")) as Partial<CacheRecord>; } catch { return undefined; }
			const { storedAt, expiresAt } = record;
			const fresh = record.v === VERSION && typeof storedAt === "number" && typeof expiresAt === "number"
				&& expiresAt > at && expiresAt - storedAt <= MAX_TTL && storedAt <= at + DAY && "body" in record;
			if (!fresh) { try { await fs.unlink(file); } catch { /* Another process may have replaced or removed it. */ } return undefined; }
			try { const used = new Date(at); await fs.utimes(file, used, used); } catch { /* Use order is best effort. */ }
			return record.body;
		},
		async write(url, body) {
			if (!isOpenAlex(url) || body === null || body === undefined) return;
			const at = now(), kind = cacheKind(url);
			const record: CacheRecord = { v: VERSION, kind, path: new URL(url).pathname, storedAt: at, expiresAt: at + TTL_DAYS[kind] * DAY, body };
			const file = fileFor(cacheKey(url)), temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
			await fs.mkdir(dirname(file), { recursive: true });
			await fs.writeFile(temp, await zip(Buffer.from(JSON.stringify(record), "utf8")));
			await fs.rename(temp, file);
			if (at - lastSweep >= SWEEP_EVERY) { lastSweep = at; await sweep(); }
		},
		sweep,
	};
}
