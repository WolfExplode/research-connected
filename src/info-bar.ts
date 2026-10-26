import { tr } from "./i18n";
import { LAYOUT_LABEL, type LayoutMode } from "./layout-modes";
import type { SimilarityGraph } from "./neighborhood";
import { setHoverHint } from "./hover-hint";

export interface InfoMessage {
	text: string;
	kind?: "summary" | "success" | "busy" | "error";
	detail?: string;
}

export function graphInfo(graph: SimilarityGraph | null, layout: LayoutMode): InfoMessage {
	if (!graph) return { text: tr("从一篇种子论文开始。", "Start with a seed paper.") };
	const partial = graph.warnings.length > 0 || graph.pagingLimited;
	return { text: `${LAYOUT_LABEL[layout]} · ${graph.nodes.length} ${tr("篇论文", "papers")} · ${graph.edges.length} ${tr("条关系", "links")}${partial ? tr(" · 结果不完整", " · Partial results") : ""}` };
}

/** One status owner per surface. Mode changes invalidate old task messages. */
export function createInfoBar(element: HTMLElement) {
	let context: InfoMessage = { text: "" }, contextKey = "";
	let notice: InfoMessage | null = null, timer: number | undefined;
	let alive = true;
	const priority = (info: InfoMessage): number => info.kind === "error" ? 4 : info.kind === "busy" ? 3 : info.kind === "success" ? 2 : info.kind === "summary" ? 1 : 0;
	function paint(): void {
		if (!alive) return;
		const current = notice && priority(notice) >= priority(context) ? notice : context;
		element.textContent = current.text;
		element.dataset.state = current.kind ?? "ready";
		element.setAttribute("aria-busy", String(current.kind === "busy"));
		setHoverHint(element, current.detail ? `${current.text} ${current.detail}` : current.text);
	}
	function clear(): void { window.clearTimeout(timer); notice = null; }
	return {
		context(key: string, info: InfoMessage): void {
			if (!alive) return;
			if (key !== contextKey) { clear(); contextKey = key; }
			context = info; paint();
		},
		notify(text: string, kind?: "success" | "busy" | "error"): void {
			if (!alive) return;
			clear(); notice = text ? { text, kind } : null; paint();
			if (notice && (!kind || kind === "success")) timer = window.setTimeout(() => { notice = null; paint(); }, 4000);
		},
		clearProgress(): void { if (notice?.kind === "busy") { clear(); paint(); } },
		destroy(): void { alive = false; clear(); },
	};
}
