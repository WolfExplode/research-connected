import { mountGraphApp } from "../../src/app";
import { mountEmbed } from "../../src/embed-mount";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { fixtureGet } from "../../preview/fixture";
import type { LibraryPaperState, PaperLibrary } from "../../src/paper-library";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(test: () => boolean): Promise<void> {
	const end = Date.now() + 6000;
	while (!test()) { if (Date.now() > end) throw new Error("Library action test timed out"); await new Promise(resolve => setTimeout(resolve, 10)); }
}

export async function verifyPaperLibrary(root: HTMLElement): Promise<void> {
	let stored: PaperNode | null = null, downloads = 0, opened = "";
	let state: LibraryPaperState = { note: null, held: false, bookmark: false };
	const changed = (): void => { window.dispatchEvent(new Event("research-connected-library-changed")); };
	const library: PaperLibrary = {
		read: () => ({ ...state }),
		async setBookmark(paper, value) { stored = paper; state = { ...state, note: state.note || "Research/Papers/Example.md", bookmark: value }; changed(); },
		async save(paper) { downloads++; stored = paper; state = { ...state, note: state.note || "Research/Papers/Example.md", reason: "no-oa-copy" }; changed(); return { ...state }; },
		bookmarks: () => stored && state.bookmark ? [{ paper: stored, note: state.note!, reading: "unread" }] : [],
		migrateBookmark: async () => {}, open: note => { opened = note; },
	};
	const settings = structuredClone(DEFAULT_SETTINGS); settings.s2Reconcile = false;
	const handle = mountGraphApp(root, { getSettings: () => settings, getJson: fixtureGet, openExternal() {}, paperLibrary: library, initialDoi: "10.1234/seed" });
	const bookmark = () => root.querySelector<HTMLButtonElement>(".cpo-detail .cpo-paper-bookmark")!;
	const save = () => root.querySelector<HTMLButtonElement>(".cpo-detail .cpo-paper-save")!;
	try {
		await until(() => !!bookmark());
		const beforeWidth = root.style.width; root.style.width = "480px";
		await until(() => root.classList.contains("is-narrow"));
		for (const action of [bookmark(), save()]) {
			const bounds = action.getBoundingClientRect(), card = action.closest(".cpo-card")!.getBoundingClientRect();
			check(bounds.left >= card.left && bounds.right <= card.right + 1, "paper actions wrap inside narrow cards");
		}
		root.style.width = beforeWidth;
		check(bookmark().textContent?.includes("Bookmark") && save().textContent?.includes("Save"), "Save and Bookmark are distinct actions");
		bookmark().click(); await until(() => bookmark()?.getAttribute("aria-pressed") === "true");
		check(Number(downloads) === 0 && state.note, "bookmark keeps a note without downloading");
		save().click(); await until(() => save()?.textContent?.includes("Retry download") ?? false);
		check(Number(downloads) === 1 && state.bookmark && root.querySelector(".cpo-paper-library-feedback")?.textContent?.includes("No downloadable open-access copy"), "failed acquisition retains the bookmark, note, retry and visible reason");
		bookmark().click(); await until(() => bookmark()?.getAttribute("aria-pressed") === "false");
		check(state.note && !state.bookmark, "removing bookmark keeps the library note");
		bookmark().click(); await until(() => state.bookmark);
		const method = root.querySelector<HTMLSelectElement>('[aria-label="Explore method"]')!;
		method.value = "search"; method.dispatchEvent(new Event("change"));
		const entry = root.querySelector<HTMLButtonElement>(".cpo-library-open")!;
		check(entry.getClientRects().length, "bookmarks are reachable outside the citation task");
		entry.click();
		check(root.querySelectorAll(".cpo-library-card").length === 1 && !root.querySelector(".cpo-staged-group-title"), "bookmarks are a global collection without seed grouping");
		root.querySelector<HTMLButtonElement>(".cpo-library-card .cpo-local-paper")!.click();
		check(opened === state.note, "bookmark cards reopen the same library note");
	} finally { handle.destroy(); }
	const destroy = mountEmbed(root, { source: "doi: 10.1234/seed", getSettings: () => settings, getJson: fixtureGet, openExternal() {}, paperLibrary: library });
	try {
		await until(() => !!root.querySelector(".cpo-paper-bookmark"));
		check(root.querySelector(".cpo-paper-bookmark")?.getAttribute("aria-pressed") === "true", "embeds read the same vault-wide bookmark");
		root.querySelector<HTMLButtonElement>(".cpo-paper-bookmark")!.click();
		await until(() => !state.bookmark);
		check(!!state.note && Number(downloads) === 1, "embed unbookmark keeps the note and never downloads");
	} finally { destroy(); }
}
