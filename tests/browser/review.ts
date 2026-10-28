import { verifyLiterature } from "./literature";
import { mountGraphApp } from "../../src/app";
import { DEFAULT_SETTINGS } from "../../src/settings-model";
import { fixtureGet } from "../../preview/fixture";
import { verifyIntegratedWorkflow } from "./integrated-workflow";
import type { PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function verify(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app")!;
	const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: {} };
	let failSave = false;
	let libraryReads = 0;
	const local: PaperNode = { id: "local:Research/Papers/Unseen.md", title: "Unseen local paper", abstract: "Local study summary", isSeed: false,
		year: 2021, citedByCount: 0, authors: "", authorList: [], doiUrl: null, openAlexUrl: "", origin: "related", language: null, workType: null, venue: null, concepts: [], retracted: false };
	const handle = mountGraphApp(root, {
		getSettings: () => settings,
		getJson: fixtureGet,
		openExternal() {},
		initialDoi: "10.1234/seed",
		persistSettings: async () => { if (failSave) throw new Error("disk full"); },
		researchLibrary: () => ({ read: () => ({ doi: null, local: { state: "absent", note: null, files: [] }, providers: {} }),
			check: async () => { throw new Error("Unexpected availability check"); }, open() {},
			textLibrary: async () => { libraryReads++; return [{ paper: local, note: "Research/Papers/Unseen.md" }]; } }),
	});
	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("graph did not load")); }, 5000);
		const observer = new MutationObserver(() => {
			if (root.querySelector(".cpo-paper-reading-select")) {
				observer.disconnect(); window.clearTimeout(timer); resolve();
			}
		});
		observer.observe(root, { childList: true, subtree: true });
	});
	for (const hidden of Array.from(root.querySelectorAll<HTMLElement>("[hidden]"))) {
		check(getComputedStyle(hidden).display === "none", `hidden controls must stay hidden without important overrides: ${hidden.outerHTML.slice(0, 200)}`);
	}
	const optionsButton = root.querySelector<HTMLButtonElement>(".cpo-graph-options-button")!;
	const optionsPanel = root.querySelector<HTMLElement>(".cpo-graph-options")!;
	const diversity = root.querySelector<HTMLInputElement>(".cpo-diversify-results")!;
	check(optionsPanel.hidden && diversity.checked, "graph options start collapsed with existing diversity behavior");
	optionsButton.click();
	check(!optionsPanel.hidden && optionsButton.getAttribute("aria-expanded") === "true", "graph options expand from the canvas toolbar");
	const distanceScale = root.querySelector<HTMLSelectElement>('.cpo-distance-scale')!;
	check(distanceScale.value === "relative", "distance defaults to relative for exploration");
	distanceScale.value = "absolute"; distanceScale.dispatchEvent(new Event("change"));
	check(distanceScale.value === "absolute", "absolute distance is selectable in graph options");
	distanceScale.value = "relative"; distanceScale.dispatchEvent(new Event("change"));
	failSave = true;
	diversity.click();
	await new Promise(resolve => window.setTimeout(resolve, 0));
	check(diversity.checked && settings.diversifyResults && !diversity.disabled, "failed diversity preference save rolls back");
	failSave = false;
	diversity.click();
	await new Promise<void>((resolve, reject) => {
		const started = Date.now();
		const poll = (): void => {
			if (!diversity.disabled) { resolve(); return; }
			if (Date.now() - started > 5000) { reject(new Error("diversity rebuild did not finish")); return; }
			window.setTimeout(poll, 10);
		};
		poll();
	});
	check(!diversity.checked && !settings.diversifyResults, "diversity can be disabled and graph rebuilt");
	optionsPanel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	check(optionsPanel.hidden && document.activeElement === optionsButton, "Escape closes options and restores focus");
	const similarity = root.querySelector<HTMLButtonElement>('[data-layout="radial"]')!;
	check(similarity.textContent?.includes("相似度"), "radial is presented as Similarity");
	similarity.click();
	check(Number(libraryReads) === 1, "Similarity map retrieves the shared comparison pool");
	await new Promise(resolve => window.setTimeout(resolve, 0));
	const scope = root.querySelector<HTMLSelectElement>('[aria-label="Similarity search scope"]')!;
	check(scope.value === "library" && Number(libraryReads) === 1, "Text similarity defaults to a whole-library read");
	check(root.querySelector(".cpo-status")?.textContent?.includes("1"), "library retrieval includes a paper absent from the citation graph");
	scope.value = "both"; scope.dispatchEvent(new Event("change"));
	await new Promise(resolve => window.setTimeout(resolve, 20));
	const scopeStatus = root.querySelector(".cpo-status")?.textContent;
	check(similarity.getAttribute("aria-pressed") === "true", "Similarity activates on the shared canvas");
	const textView = root.querySelector<HTMLButtonElement>('[data-similarity="text"]')!;
	const citationView = root.querySelector<HTMLButtonElement>('[data-similarity="citations"]')!;
	check(textView.getAttribute("aria-pressed") === "true", "Text is the default similarity view");
	citationView.click();
	check(Number(libraryReads) === 1, "comparison changes preserve the candidate pool without rereading the library");
	check(citationView.getAttribute("aria-pressed") === "true" && textView.getAttribute("aria-pressed") === "false", "Citations is a separate comparison view");
	textView.click();
	check(textView.getAttribute("aria-pressed") === "true", "Text comparison can be restored without rebuilding the graph");
	check(root.querySelector(".cpo-status")?.textContent === scopeStatus, "returning to Text restores the same current-scope summary");
	check(!root.querySelector(".cpo-similarity-search [role=status]"), "similarity controls must not duplicate the top info bar");
	root.querySelector<HTMLButtonElement>('[data-layout="force2d"]')!.click();
	check(root.querySelector<HTMLElement>(".cpo-similarity-toolbar")?.hidden, "Planar shows citation neighbors without search controls");
	similarity.click();
	check(!root.querySelector(".cpo-similarity-list"), "Similarity has no competing permanent ranked list");
	root.querySelector<HTMLButtonElement>('[data-layout="force2d"]')!.click();
	const reading = root.querySelector<HTMLSelectElement>(".cpo-paper-reading-select")!;
	reading.value = "read";
	reading.dispatchEvent(new Event("change"));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(reading.value === "read" && !reading.disabled, "reading state must save and re-enable");
	failSave = true;
	reading.value = "unread";
	reading.dispatchEvent(new Event("change"));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(reading.value === "read" && !reading.disabled, "failed reading save must roll back");
	failSave = false;
	const sidebar = root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!;
	sidebar.querySelector<HTMLButtonElement>(".cpo-panel-toggle")!.click();
	handle.openDoiPathSearch();
	check(!sidebar.parentElement!.classList.contains("is-sidebar-collapsed"), "path search must reopen the sidebar");
	const form = root.querySelector<HTMLFormElement>(".cpo-path-search")!;
	check(form.getBoundingClientRect().height > 0, "path form must be visible");
	const input = form.querySelector("input")!;
	input.value = "W1";
	form.requestSubmit();
	check(root.querySelector(".cpo-banner")?.textContent?.includes("两个端点"), "invalid endpoints must show a useful error");
	input.value = "W1 → W2";
	form.requestSubmit();
	check(root.querySelector(".cpo-agg-list")?.textContent?.includes("W2"), "valid endpoints must render a citation path");
	handle.destroy();
	document.documentElement.lang = "en";
	await verifyIntegratedWorkflow(root);
	await verifyLiterature(root);
	document.body.textContent = "PASS: reading persistence and rollback, visible path search, invalid and valid endpoints, hidden controls, cleanup";
	document.body.dataset.result = "passed";
}

void verify().catch((error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.dataset.result = "failed";
});
