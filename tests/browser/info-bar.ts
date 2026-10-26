import { createInfoBar } from "../../src/info-bar";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function verifyInfoBar(root: HTMLElement): Promise<void> {
	const status = document.createElement("p"); root.append(status);
	const bar = createInfoBar(status);
	try {
		bar.context("text", { kind: "summary", text: "Compared 100 · showing 50", detail: "12 papers use word overlap." });
		bar.notify("Opened a project");
		check(status.textContent === "Compared 100 · showing 50", "current results must take priority over incidental completion notices");
		check(status.getAttribute("aria-label")?.includes("12 papers use word overlap") && !status.hasAttribute("title"), "secondary result information belongs in the shared hover hint");
		bar.notify("Saving failed. Retry.", "error");
		check(status.dataset.state === "error" && status.textContent.includes("Retry"), "actionable errors must take priority over result counts");
		bar.context("text", { kind: "summary", text: "Compared 101 · showing 50" });
		check(status.dataset.state === "error", "background result updates must not erase an actionable task error");
		bar.context("timeline", { text: "Timeline · 50 papers" });
		check(String(status.textContent) === "Timeline · 50 papers", "changing modes must discard errors and summaries from the previous mode");
		bar.notify("Loading references", "busy");
		check(status.getAttribute("aria-busy") === "true", "active task progress must be announced");
		bar.clearProgress();
		check(String(status.textContent) === "Timeline · 50 papers", "completed progress must return to the active view summary");
		bar.notify("Saved view");
		await new Promise(resolve => setTimeout(resolve, 4100));
		check(String(status.textContent) === "Timeline · 50 papers", "success notices must expire instead of becoming stale header text");
	} finally { bar.destroy(); status.remove(); }
}
