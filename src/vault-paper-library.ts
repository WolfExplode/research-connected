import { TFile, type App } from "obsidian";
import { tr } from "./i18n";
import type { LibraryAvailability, PaperLibraryService } from "./library-panel";
import { lookupLiteratureNote, openLiteratureNote, rememberLiteratureNote } from "./vault-note";
import { paperDois } from "./work-identity";
import type { ConnectedPapersSettings } from "./settings-model";
import type { LibraryBookmark, LibraryPaperState, PaperLibrary } from "./paper-library";
import type { ReadingStatus } from "./project-state";
import type { PaperNode } from "./types";

const libraries = new WeakMap<App, { library: PaperLibrary; invalidate(path?: string): void }>();
const text = (value: unknown): string => typeof value === "string" ? value : "";
const bookmarked = (props: Record<string, unknown>): boolean => Object.prototype.hasOwnProperty.call(props, "bookmark") ? props.bookmark === true : props.favorite === true;
const key = (paper: PaperNode): string => paperDois(paper)[0] || paper.openAlexUrl || paper.id;
// The research tools are the only writer of paper notes; without them, Save and Bookmark explain why.
const noTools = (): string => tr("保存和收藏需要研究工具。请在 Research Connected 设置中配置研究工具仓库。", "Save and Bookmark need the research tools. Set the research tools repository in Research Connected settings.");

export function invalidatePaperLibrary(app: App, path?: string): void { libraries.get(app)?.invalidate(path); }

/** One shared adapter per vault, so panes/embeds cannot create duplicate notes or race toggles. */
export function vaultPaperLibrary(app: App, settings: () => ConnectedPapersSettings, bridge: () => PaperLibraryService | null): PaperLibrary {
	const existing = libraries.get(app); if (existing) return existing.library;
	const confirmed = new Map<string, { paper: PaperNode; state: LibraryPaperState }>();
	const errors = new Map<string, string>();
	const pending = new Map<string, Promise<unknown>>(), downloads = new Map<string, Promise<LibraryPaperState>>();
	const changed = (): void => { window.dispatchEvent(new Event("research-connected-library-changed")); };
	const propsAt = (note: string): Record<string, unknown> => {
		const file = app.vault.getAbstractFileByPath(note);
		return file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {};
	};
	function readState(paper: PaperNode): LibraryPaperState {
		const cached = confirmed.get(key(paper)); if (cached) return cached.state;
		const local = bridge()?.read(paper).local;
		if (local?.state === "ambiguous") return { note: null, held: false, bookmark: false, ambiguous: true };
		const direct = paper.id.startsWith("local:") ? app.vault.getAbstractFileByPath(paper.id.slice(6)) : null;
		const found = local?.note ? { path: local.note } : direct instanceof TFile && direct.extension === "md" ? { path: direct.path } : lookupLiteratureNote(app, paper, settings().literatureDoiProperty);
		if (found && "alternatives" in found && found.alternatives?.length) return { note: null, held: false, bookmark: false, ambiguous: true };
		const note = found?.path ?? null, props = note ? propsAt(note) : {};
		const files = note ? [...["pdf", "xml", "html", "htm", "docx", "epub", "txt"].map(ext => note.replace(/\.md$/i, `.${ext}`)), ...[props.pdf, props.fulltext, props.full_text].flat().filter((p): p is string => typeof p === "string").map(p => p.replace(/^!?\[\[|\]\]$/g, "").split("|")[0]!)] : [];
		return { note, bookmark: local?.bookmark ?? bookmarked(props), held: local?.state === "held" || files.some(path => app.vault.getAbstractFileByPath(path) instanceof TFile), reason: local?.reason || text(props.needs_reason) };
	}
	function read(paper: PaperNode): LibraryPaperState { return { ...readState(paper), error: errors.get(key(paper)) }; }
	function remember(paper: PaperNode, value: LibraryAvailability): LibraryPaperState {
		const local = value.local;
		const state = { note: local.note, bookmark: local.bookmark === true, held: local.state === "held", reason: local.reason || "" };
		confirmed.set(key(paper), { paper, state });
		if (state.note) { const props = propsAt(state.note), reading = local.reading || props.reading_status || props["rc-status"]; rememberLiteratureNote(paper, state.note, reading === "read" ? "read" : reading === "to-read" ? "to-read" : "unread"); }
		return state;
	}
	async function serial<T>(paper: PaperNode, operation: () => Promise<T>): Promise<T> {
		const id = key(paper), prior = pending.get(id) ?? Promise.resolve();
		errors.delete(id);
		const task = prior.catch(() => {}).then(operation); pending.set(id, task); changed();
		try { return await task; } catch (error) { errors.set(id, error instanceof Error ? error.message : "Library action failed"); throw error; } finally { if (pending.get(id) === task) { pending.delete(id); changed(); } }
	}
	async function bookmark(paper: PaperNode, value: boolean, onlyIfMissing = false, source = "", reading?: ReadingStatus): Promise<void> {
		await serial(paper, async () => {
			const host = bridge();
			if (!host?.bookmark) throw new Error(noTools());
			remember(paper, await host.bookmark(paper, value, { onlyIfMissing, source, reading }));
			changed();
		});
	}
	const library: PaperLibrary = {
		read,
		busy: paper => pending.has(key(paper)),
		setBookmark: (paper, value) => bookmark(paper, value),
		migrateBookmark: (paper, source, reading) => bookmark(paper, true, true, source, reading),
		save(paper) {
			const id = key(paper), running = downloads.get(id); if (running) return running;
			const task = serial(paper, async () => {
				let state = read(paper); if (state.ambiguous) throw new Error("Multiple literature notes match. Review them before saving.");
				if (state.held) return state;
				const host = bridge();
				if (!host?.save) throw new Error(noTools());
				state = remember(paper, await host.save(paper));
				changed(); return state;
			});
			downloads.set(id, task); void task.finally(() => { if (downloads.get(id) === task) downloads.delete(id); }).catch(() => {}); return task;
		},
		bookmarks() {
			const byNote = new Map<string, LibraryBookmark>();
			for (const file of app.vault.getMarkdownFiles()) {
				const props = propsAt(file.path); if (!bookmarked(props) || (props.type !== "source" && !props.doi && !props.openalex && !file.path.startsWith("Research/Papers/"))) continue;
				const doi = typeof props.doi === "string" ? props.doi : "";
				const paper: PaperNode = { id: `local:${file.path}`, title: text(props.title) || file.basename, year: Number(props.year) || null,
					authors: Array.isArray(props.authors) ? props.authors.filter((a): a is string => typeof a === "string").join(", ") : text(props.authors), authorList: [], citedByCount: 0, abstract: "",
					doiUrl: doi ? (doi.startsWith("https://") ? doi : `https://doi.org/${doi}`) : null, openAlexUrl: /^W\d+$/i.test(text(props.openalex)) ? `https://openalex.org/${text(props.openalex).toUpperCase()}` : text(props.openalex), isSeed: false, origin: "related", language: null, venue: null, workType: null, concepts: [], retracted: false };
				byNote.set(file.path, { paper, note: file.path, reading: props.reading_status === "read" ? "read" : props.reading_status === "to-read" ? "to-read" : "unread" });
			}
			for (const { paper, state } of confirmed.values()) if (state.note) {
				if (state.bookmark) byNote.set(state.note, { paper, note: state.note, reading: byNote.get(state.note)?.reading ?? "unread" });
				else byNote.delete(state.note);
			}
			return [...byNote.values()].sort((a, b) => a.paper.title.localeCompare(b.paper.title));
		},
		open: note => { void openLiteratureNote(app, note); },
	};
	libraries.set(app, { library, invalidate(path) { for (const [id, entry] of confirmed) if (!path || entry.state.note === path) confirmed.delete(id); } });
	return library;
}
