import { tr } from "./i18n";
import { shortAuthor } from "./labels";
import { normalizeDoi } from "./paper";
import { paperDois, paperRecords, workIndex } from "./work-identity";
import type { ReadingStatus } from "./project-state";
import type { PaperNode } from "./types";

export function toBibTeX(nodes: readonly PaperNode[]): string {
	const used = new Set<string>();
	return workIndex(nodes, nodes.map((paper) => paper.id)).papers.map((paper) => bibEntry(paper, used)).join("\n\n");
}

export function toYamlList(nodes: readonly PaperNode[]): string {
	const lines = ["papers:"];
	for (const paper of workIndex(nodes, nodes.map((paper) => paper.id)).papers) {
		lines.push(`  - title: ${yamlString(paper.title)}`);
		lines.push(`    authors: ${yamlString(paper.authors)}`);
		lines.push(`    year: ${paper.year ?? "null"}`);
		lines.push(`    citations: ${paper.citedByCount}`);
		const doi = doiOf(paper);
		if (doi) lines.push(`    doi: ${yamlString(doi)}`);
		if (paper.records?.length) lines.push(`    doi_aliases: ${JSON.stringify(paperDois(paper))}`, `    openalex_aliases: ${JSON.stringify(paperRecords(paper).map((record) => record.id))}`);
		lines.push(`    openalex: ${yamlString(paper.openAlexUrl)}`);
	}
	return lines.join("\n");
}

export function toMarkdownTable(nodes: readonly PaperNode[]): string {
	const header = tr("| 题名 | 作者 | 年份 | 被引 | DOI | OpenAlex |", "| Title | Authors | Year | Citations | DOI | OpenAlex |");
	const rule = "| --- | --- | --- | --- | --- | --- |";
	const rows = workIndex(nodes, nodes.map((paper) => paper.id)).papers.map((paper) => {
		const year = paper.year === null ? "" : String(paper.year);
		const doi = doiOf(paper) ?? "";
		return `| ${cell(paper.title)} | ${cell(paper.authors)} | ${year} | ${paper.citedByCount} | ${cell(doi)} | ${cell(paper.openAlexUrl)} |`;
	});
	return [header, rule, ...rows].join("\n");
}

export function orderedForExport(nodes: readonly PaperNode[]): PaperNode[] {
	return [...nodes].sort((a, b) => {
		if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
		return (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title);
	});
}

function bibEntry(paper: PaperNode, used: Set<string>): string {
	const type = bibType(paper.workType);
	const key = citeKey(paper, used);
	const fields = [
		`  title = {${bibText(paper.title)}}`,
		`  author = {${(paper.authorList?.length ? paper.authorList : [paper.authors]).map(bibText).join(" and ")}}`,
		`  year = {${paper.year ?? ""}}`,
	];
	const doi = doiOf(paper);
	if (doi) fields.push(`  doi = {${bibText(doi)}}`);
	fields.push(`  url = {${bibText(paper.openAlexUrl)}}`);
	return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

function bibType(workType: string | null): string {
	if (workType === "book") return "book";
	if (workType === "book-chapter") return "incollection";
	if (workType === "dissertation") return "phdthesis";
	if (workType === "article" || workType === "editorial" || workType === "preprint") return "article";
	return "misc";
}

function citeKey(paper: PaperNode, used: Set<string>): string {
	const author = shortAuthor(paper.authors).replace(/[^A-Za-z0-9]+/g, "") || "anon";
	const year = paper.year ?? "nd";
	let key = `${author}${year}`;
	if (used.has(key)) key = `${key}${paper.id.replace(/\D/g, "").slice(-4)}`;
	used.add(key);
	return key;
}

function bibText(value: string): string {
	return value.replace(/[{}\\]/g, "");
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function cell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function doiOf(paper: Pick<PaperNode, "doiUrl">): string | null {
	if (!paper.doiUrl) return null;
	const match = paper.doiUrl.match(/10\.\d{4,9}\/\S+/);
	return match?.[0]?.replace(/[)\].,;>]+$/g, "") ?? null;
}

export interface LiteratureFields {
	project: string;
	relation: string;
	status: ReadingStatus;
}

export function fillLiteratureTemplate(template: string, paper: PaperNode, fields: LiteratureFields): string {
	const values: Record<"title" | "authors" | "year" | "doi" | "openalex" | "relation" | "project" | "status", string> = {
		title: paper.title,
		authors: paper.authors,
		year: paper.year === null ? "" : String(paper.year),
		doi: normalizeDoi(paper.doiUrl) ?? "",
		openalex: paper.openAlexUrl,
		relation: fields.relation,
		project: fields.project,
		status: fields.status,
	};
	return template.replace(/\{\{\s*(title|authors|year|doi|openalex|relation|project|status)\s*\}\}/g, (_match, key: keyof typeof values) => values[key] ?? "");
}

/** Filename stays inside one folder: slashes and other path characters are removed. */
export function literatureFilename(paper: PaperNode, template: string, fields: LiteratureFields): string {
	const raw = fillLiteratureTemplate(template.trim() || "{{year}} {{title}}", paper, fields);
	const cleaned = raw.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
	return `${cleaned || paper.id}.md`;
}

/** Frontmatter is always written by the plugin. A custom template is the note body. */
export function literatureMarkdown(paper: PaperNode, template: string, fields: LiteratureFields): string {
	const doi = normalizeDoi(paper.doiUrl);
	const lines = [
		"---",
		`title: ${yamlString(paper.title)}`,
		`authors: ${yamlString(paper.authors)}`,
		`year: ${paper.year ?? "null"}`,
	];
	if (doi) lines.push(`doi: ${yamlString(doi)}`);
	if (paper.records?.length) lines.push(`rc-doi-aliases: ${JSON.stringify(paperDois(paper))}`, `rc-openalex-aliases: ${JSON.stringify(paperRecords(paper).map((record) => record.id))}`);
	lines.push(
		`openalex: ${yamlString(paper.openAlexUrl)}`,
		`rc-project: ${yamlString(fields.project)}`,
		`rc-status: ${fields.status}`,
		"---",
		"",
	);
	const body = template.trim() ? fillLiteratureTemplate(template, paper, fields).trim() : `# ${paper.title}`;
	return [...lines, body, ""].join("\n");
}

export interface IndexedNote {
	path: string;
	reading: ReadingStatus | null;
	alternatives?: string[];
}

/** All known identifiers participate; ambiguous notes are returned for selection. */
export function matchLiteratureNote(
	files: readonly { path: string; frontmatter?: Record<string, unknown> }[],
	paper: Pick<PaperNode, "id" | "doiUrl" | "records">,
	doiProperty: string,
): IndexedNote | null {
	const index = indexLiteratureFiles(files, doiProperty);
	const matches = new Map<string, IndexedNote>();
	for (const doi of paperDois(paper)) { const note = index.byDoi.get(doi); if (note) for (const path of note.alternatives ?? [note.path]) matches.set(path, note); }
	for (const id of [paper.id, ...(paper.records ?? []).map((record) => record.id)]) { const note = index.byId.get(id); if (note) for (const path of note.alternatives ?? [note.path]) matches.set(path, note); }
	return matches.size > 1 ? { path: [...matches.keys()][0]!, reading: null, alternatives: [...matches.keys()] } : [...matches.values()][0] ?? null;
}

export function indexLiteratureFiles(
	files: readonly { path: string; frontmatter?: Record<string, unknown> }[],
	doiProperty: string,
): { byDoi: Map<string, IndexedNote>; byId: Map<string, IndexedNote> } {
	const keys = [...new Set([doiProperty.trim() || "doi", "doi"])];
	const byDoi = new Map<string, IndexedNote>();
	const byId = new Map<string, IndexedNote>();
	const remember = (index: Map<string, IndexedNote>, key: string, note: IndexedNote): void => {
		const previous = index.get(key);
		if (!previous || previous.path === note.path) { index.set(key, note); return; }
		index.set(key, { path: previous.path, reading: null, alternatives: [...new Set([...(previous.alternatives ?? [previous.path]), note.path])] });
	};
	for (const file of files) {
		const frontmatter = file.frontmatter;
		if (!frontmatter) continue;
		const note = { path: file.path, reading: readingValue(frontmatter.reading_status) ?? readingValue(frontmatter["rc-status"]) };
		const doi = keys.map((key) => normalizeDoi(frontmatterText(frontmatter[key]))).find((value): value is string => Boolean(value));
		const id = frontmatterText(frontmatter.openalex)?.match(/W\d+/i)?.[0]?.toUpperCase();
		if (doi) remember(byDoi, doi, note);
		if (id) remember(byId, id, note);
		if (Array.isArray(frontmatter["rc-doi-aliases"])) for (const value of frontmatter["rc-doi-aliases"]) { const alias = typeof value === "string" ? normalizeDoi(value) : null; if (alias) remember(byDoi, alias, note); }
		if (Array.isArray(frontmatter["rc-openalex-aliases"])) for (const value of frontmatter["rc-openalex-aliases"]) { const alias = typeof value === "string" ? value.match(/W\d+/i)?.[0]?.toUpperCase() : null; if (alias) remember(byId, alias, note); }
	}
	return { byDoi, byId };
}

function readingValue(value: unknown): ReadingStatus | null {
	return value === "unread" || value === "to-read" || value === "read" ? value : null;
}

function frontmatterText(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}
