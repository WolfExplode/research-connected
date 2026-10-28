import { verifyPaperLibrary } from "./paper-library";
import { verifyInfoBar } from "./info-bar";
import { mountGraphApp, type AppDeps, type GraphAppHandle } from "../../src/app";
import { mountEmbed } from "../../src/embed-mount";
import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../../src/settings-model";
import { fixtureGet } from "../../preview/fixture";
import { saveGraphSnapshot } from "../../src/project-state";
import type { ReadingStatus } from "../../src/project-state";
import type { PaperLibraryService } from "../../src/library-panel";
import { verifyCanvasLifecycle } from "./canvas";
import { verifyCitationComparison } from "./comparison";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 30));
async function until(test: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!test()) { if (Date.now() > deadline) throw new Error("Maintenance check timed out"); await tick(); }
}

async function verify(): Promise<void> {
	document.documentElement.lang = "en";
	const root = document.querySelector<HTMLElement>("#app")!;
	const settings: ConnectedPapersSettings = { ...structuredClone(DEFAULT_SETTINGS), s2Reconcile: false };
	let disk = structuredClone(settings), failNote = false, libraryCalls = 0, failLibrary = true;
	let noteReading: ReadingStatus = "unread";
	let failRollback = false, failPersist = false;
	const persist = (): void => {
		if (failPersist) throw new Error("disk full");
		disk = structuredClone(settings); window.dispatchEvent(new Event("research-connected-project"));
	};
	const libraryService: PaperLibraryService = {
		read: () => ({ doi: null, local: { state: "absent", note: null, files: [] }, providers: {} }),
		check: async () => { throw new Error("Unexpected provider request"); }, open() {},
		textLibrary: async () => { libraryCalls++; if (failLibrary) throw new Error("temporary library failure"); return []; },
	};
	const deps: AppDeps = { getSettings: () => settings, getJson: fixtureGet, openExternal() {},
		persistSettings: persist, saveProject: project => { settings.researchProjects[project.seedId] = project; persist(); },
		lookupLiteratureNote: () => ({ path: "Fixture.md", reading: noteReading }),
		syncLiteratureReading: async (_paper, reading) => {
			if (failNote) { failPersist = failRollback; throw new Error("frontmatter write failed"); }
			noteReading = reading;
		},
		researchLibrary: () => libraryService,
	};
	let handle: GraphAppHandle = mountGraphApp(root, { ...deps, initialDoi: "10.1234/seed" });
	const button = (selector: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(selector)!;
	try {
		await until(() => Boolean(root.querySelector(".cpo-paper-reading-select")));
		await new Promise(resolve => setTimeout(resolve, 550));
		failNote = true;
		const reading = root.querySelector<HTMLSelectElement>(".cpo-paper-reading-select")!;
		reading.value = "read"; reading.dispatchEvent(new Event("change"));
		await until(() => !reading.disabled);
		check(reading.value === "unread" && disk.researchProjects.W1?.paperStates?.W1?.reading === "unread", "note-sync failure must roll back both the UI and persisted project");
		check(root.querySelector<HTMLElement>(".cpo-paper-action-error")?.getClientRects().length, "reading failures must be visible and announced");
		failRollback = true;
		reading.value = "read"; reading.dispatchEvent(new Event("change"));
		await until(() => !reading.disabled);
		check(reading.value === "read" && String(disk.researchProjects.W1?.paperStates?.W1?.reading) === "read", "failed compensation must retain the confirmed saved status in the UI");
		const retryNote = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === "Retry note sync")!;
		check(!retryNote.hidden, "a partial reading save must provide a synchronization retry");
		failNote = failRollback = failPersist = false; retryNote.click();
		await until(() => retryNote.hidden);
		check(String(noteReading) === "read" && settings.researchProjects.W1?.paperStates?.W1?.reading === "read", "project notifications must not re-import stale note state during a reading change");

		check(reading.getAttribute("aria-label") === "Reading status" && !reading.hasAttribute("title"), "reading state must have one concise tooltip after retries");

		button('[data-layout="temporal"]').click();
		const range = root.querySelector<HTMLInputElement>(".cpo-scrub-row input")!;
		const selectedYear = Number(range.min);
		range.value = String(selectedYear); range.dispatchEvent(new Event("input"));
		handle.destroy();
		check(disk.researchProjects.W1?.currentView?.layout === "temporal" && disk.researchProjects.W1.currentView.scrubYear === selectedYear, "closing immediately must flush the pending layout and filter");
		handle = mountGraphApp(root, deps);
		const restored = root.querySelector<HTMLInputElement>(".cpo-scrub-row input")!;
		check(Number(restored.value) === selectedYear && root.querySelector(".cpo-scrub-readout")?.textContent === `Through ${selectedYear}`, "restored year control must match the saved filter");

		button('[data-layout="radial"]').click();
		await until(() => root.querySelector(".cpo-status")?.textContent?.includes("temporary library failure") ?? false);
		const retry = Array.from(root.querySelectorAll<HTMLButtonElement>(".cpo-similarity-search button")).find(item => item.textContent === "Retry library search")!;
		check(!retry.hidden && libraryCalls === 1, "failed library retrieval must offer an inline retry");
		failLibrary = false; retry.click();
		await until(() => libraryCalls === 2 && !root.querySelector(".cpo-similarity-search")?.getAttribute("aria-busy")?.includes("true"));
		check(retry.hidden && root.querySelector(".cpo-status")?.textContent?.includes("No comparison papers"), "retry must recover and distinguish an empty result");
		button('[data-layout="force2d"]').click();

		for (const dark of [false, true]) {
			root.style.setProperty("--background-primary", dark ? "#1e1e1e" : "#fff");
			root.style.setProperty("--text-normal", dark ? "#ddd" : "#333");
			for (const width of [320, 480, 600, 768, 1024]) {
				root.style.width = `${width}px`;
				await until(() => root.classList.contains("is-narrow") === (width < 780));
				await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
				const stage = root.querySelector<HTMLElement>(".cpo-stage")!;
				const sidebar = root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!;
				if (width < 780) {
					check(stage.clientHeight >= 249, `graph must retain its minimum height at ${width}px in a wide window`);
					check(Math.abs(sidebar.getBoundingClientRect().width - width) < 2, `narrow sidebar must fill its surface at ${width}px`);
					check(getComputedStyle(root.querySelector(".cpo-sidebar-resizer")!).display === "none", `narrow pane must hide its vertical resizer at ${width}px (${root.className})`);
				}
				const actions = root.querySelector<HTMLElement>(".cpo-paper-actions")!;
				check(actions.scrollWidth <= actions.clientWidth + 2, `paper actions must fit at ${width}px`);
				if (width < 780) {
					button('[data-layout="radial"]').click();
					const rail = root.querySelector<HTMLElement>(".cpo-rail")!.getBoundingClientRect();
					for (const control of Array.from(root.querySelectorAll<HTMLElement>(".cpo-rail button"))) {
						if (!control.getClientRects().length) continue;
						const rect = control.getBoundingClientRect();
						check(rect.left >= rail.left - 2 && rect.right <= rail.right + 2 && rect.top >= rail.top - 2 && rect.bottom <= rail.bottom + 2, `narrow layout and comparison controls must fit their rail at ${width}px (${control.textContent}: ${JSON.stringify(rect)} within ${JSON.stringify(rail)})`);
					}
					const rightToggle = button(".cpo-evidence-sidebar > .cpo-panel-toggle");
					rightToggle.click();
					check(sidebar.clientHeight <= 33 && rightToggle.getBoundingClientRect().right <= sidebar.getBoundingClientRect().right + 1, "collapsed narrow sidebar must retain a reachable reopen control");
					rightToggle.click();
					button('[data-layout="force2d"]').click();
				}
			}
		}
		handle.destroy();
		root.style.width = "480px";
		const destroyEmbed = mountEmbed(root, { source: "doi: 10.1234/seed\nheight: 600\nwidth: 480", getSettings: () => settings, getJson: fixtureGet, openExternal() {} });
		try {
			await until(() => Boolean(root.querySelector(".cpo-paper-identity")));
			await until(() => root.querySelector(".cpo-embed")?.classList.contains("is-narrow") ?? false);
			check(root.querySelector<HTMLElement>(".cpo-stage")!.clientHeight >= 249, "narrow embed must retain graph space");
			check(Math.abs(root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!.getBoundingClientRect().width - root.querySelector<HTMLElement>(".cpo-body")!.clientWidth) < 2, "embed sidebar must follow its container width");
		} finally { destroyEmbed(); }
		const originalSeed = settings.researchProjects.W1!.snapshot!.nodes.find(paper => paper.isSeed)!;
		verifyCanvasLifecycle(root, originalSeed);
		await verifyCitationComparison(root, originalSeed);
		await verifyInfoBar(root);
		await verifyPaperLibrary(root);
	} finally { handle.destroy(); }
	document.body.textContent = "PASS: reading compensation, close-time saves, timeline restore, library retry, pane/embed widths, light/dark tokens, animation policy and document listener cleanup";
	document.body.dataset.result = "passed";
}

void verify().catch((error: unknown) => {
	const failure = document.createElement("pre");
	failure.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.prepend(failure);
	document.body.dataset.result = "failed";
});
