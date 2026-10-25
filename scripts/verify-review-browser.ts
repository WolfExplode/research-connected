import { mountGraphApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet } from "../preview/fixture";
import { verifyIntegratedWorkflow } from "./verify-integrated-workflow";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function verify(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app")!;
	const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: {} };
	let failSave = false;
	const handle = mountGraphApp(root, {
		getSettings: () => settings,
		getJson: fixtureGet,
		openExternal() {},
		initialDoi: "10.1234/seed",
		persistSettings: async () => { if (failSave) throw new Error("disk full"); },
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
		check(getComputedStyle(hidden).display === "none", "hidden controls must stay hidden without important overrides");
	}
	const similarity = root.querySelector<HTMLButtonElement>('[data-layout="radial"]')!;
	check(similarity.textContent?.includes("相似度"), "radial is presented as Similarity");
	similarity.click();
	check(similarity.getAttribute("aria-pressed") === "true", "Similarity activates on the shared canvas");
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
	document.body.textContent = "PASS: reading persistence and rollback, visible path search, invalid and valid endpoints, hidden controls, cleanup";
	document.body.dataset.result = "passed";
}

void verify().catch((error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.dataset.result = "failed";
});
