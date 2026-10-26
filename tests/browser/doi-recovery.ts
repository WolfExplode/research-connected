import { mountGraphApp } from "../../src/app";
import { normalizeDoi } from "../../src/paper";
import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../../src/settings-model";
import { fixtureGet } from "../../preview/fixture";
import type { PaperLibraryService } from "../../src/library-panel";
import type { GetJson } from "../../src/openalex";

export async function verifyDoiRecoveryBrowser(root: HTMLElement): Promise<void> {
	const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
	const until = async (test: () => boolean): Promise<void> => {
		const deadline = Date.now() + 5000;
		while (!test()) { if (Date.now() > deadline) throw new Error("DOI UI timed out"); await new Promise(resolve => window.setTimeout(resolve, 20)); }
	};
	const title = "Ventricular function during exercise in healthy adults";
	let settings: ConnectedPapersSettings = { ...structuredClone(DEFAULT_SETTINGS), s2Reconcile: false };
	let failSave = true, queries = 0, checks = 0;
	const getJson: GetJson = async (url, init) => {
		if (url.startsWith("https://api.crossref.org/works?")) {
			queries++;
			return { message: { items: [{ DOI: "10.1234/exercise", title: [title], type: "journal-article", published: { "date-parts": [[2015]] }, author: [{ family: "Author" }] }] } };
		}
		const response = await fixtureGet(url, init) as Record<string, unknown>;
		return response.id === "https://openalex.org/W1" ? { ...response, doi: null, display_name: title } : response;
	};
	const libraryService: PaperLibraryService = {
		read: paper => ({ doi: normalizeDoi(paper.doiUrl), local: { state: "absent", note: null, files: [] }, providers: {} }),
		check: async paper => { checks++; return { ...libraryService.read(paper), providers: { oa: { state: "not-found" } } }; }, open() {},
	};
	const mount = () => mountGraphApp(root, { getSettings: () => settings, getJson, openExternal() {}, initialTarget: { kind: "openalex", value: "W1" },
		researchLibrary: () => libraryService, persistSettings: async () => { if (failSave) throw new Error("disk full"); } });
	const find = () => Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Find DOI");
	let app = mount();
	await until(() => Boolean(find()));
	check(queries === 0, "opening a paper must not trigger DOI searches");
	check(Array.from(root.querySelectorAll<HTMLButtonElement>(".cpo-availability-links button")).every(button => button.disabled), "provider checks require DOI");
	find()!.click();
	await until(() => Boolean(root.textContent?.includes("DOI lookup or save failed")));
	check(!settings.doiRecoveries, "failed persistence must roll back recovered metadata");
	check(!find()!.disabled, "failed DOI lookup must be retryable");
	failSave = false;
	find()!.click();
	await until(() => Boolean(root.textContent?.includes("DOI verified through Crossref")));
	const oa = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Check open access");
	check(oa && !oa.disabled, "verified DOI enables availability checks immediately");
	oa!.click(); await until(() => checks === 1);
	const saved = JSON.stringify(settings);
	app.destroy();
	settings = JSON.parse(saved) as ConnectedPapersSettings;
	app = mount();
	await until(() => Boolean(root.textContent?.includes("DOI verified through Crossref")));
	check(queries === 2 && !find(), "reopened paper restores DOI without another metadata request");
	app.destroy();
}

document.documentElement.lang = "en";
void verifyDoiRecoveryBrowser(document.querySelector<HTMLElement>("#app")!).then(() => {
	document.body.textContent = "PASS: DOI recovery, save rollback, availability checks, and reload persistence";
	document.body.dataset.result = "passed";
}).catch((error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.dataset.result = "failed";
});
