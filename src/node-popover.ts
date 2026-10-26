import { tr } from "./i18n";
import { paintMetadataCard, paintComparisonCard } from "./detail-cards";
import { paintLocalPaperAction, type PaperLibraryService } from "./library-panel";
import type { SimilarityMap } from "./map-canvas";
import type { SimilarityKind, TextComparison } from "./paper-comparison";
import type { PaperNode } from "./types";

/** Compact paper summary that follows its node through pan, zoom and layout changes. */
export function mountNodePopover(stage: HTMLElement, canvas: HTMLCanvasElement, map: SimilarityMap, isSidePanelOpen: () => boolean) {
	const popup = createDiv();
	popup.className = "cpo-node-popover";
	popup.hidden = true;
	popup.setAttribute("role", "dialog");
	popup.setAttribute("aria-label", tr("论文详情", "Paper details"));
	const close = createEl("button", { cls: "cpo-node-popover-close", text: "×" });
	close.type = "button";
	close.setAttribute("aria-label", tr("关闭论文详情", "Close paper details"));
	const body = createDiv();
	body.className = "cpo-node-popover-body";
	popup.append(close, body); stage.append(popup);
	let paperId: string | null = null;
	const hide = (): void => { paperId = null; popup.hidden = true; };
	close.addEventListener("click", () => { hide(); canvas.focus({ preventScroll: true }); });
	stage.addEventListener("keydown", event => { if (event.key === "Escape" && !popup.hidden) { hide(); canvas.focus({ preventScroll: true }); } });
	const position = (): void => {
		if (!paperId) return;
		if (isSidePanelOpen()) { popup.hidden = true; return; }
		const anchor = map.nodeAnchor(paperId);
		const bounds = stage.getBoundingClientRect();
		const canvasBounds = canvas.getBoundingClientRect();
		if (!anchor || anchor.x < 0 || anchor.y < 0 || anchor.x > canvasBounds.width || anchor.y > canvasBounds.height) { popup.hidden = true; return; }
		popup.hidden = false;
		const x = anchor.x + canvasBounds.left - bounds.left;
		const y = anchor.y + canvasBounds.top - bounds.top;
		const gap = anchor.radius + 14;
		const width = popup.offsetWidth, height = popup.offsetHeight;
		const right = x + gap + width <= bounds.width - 8;
		popup.dataset.side = right ? "right" : "left";
		popup.style.left = `${Math.max(8, Math.min(bounds.width - width - 8, right ? x + gap : x - gap - width))}px`;
		const top = Math.max(8, Math.min(bounds.height - height - 8, y - height / 2));
		popup.style.top = `${top}px`;
		popup.style.setProperty("--node-pointer-y", `${Math.max(12, Math.min(height - 12, y - top))}px`);
	};
	map.onDraw = position;
	return {
		hide,
		show(paper: PaperNode | null, kind: SimilarityKind, score: number | undefined, comparison: TextComparison | undefined, libraryService: PaperLibraryService | null | undefined): void {
			if (!paper) { hide(); return; }
			paperId = paper.id;
			body.replaceChildren();
			paintMetadataCard(body, paper, null);
			const identity = body.querySelector<HTMLElement>(".cpo-paper-identity");
			if (identity) paintLocalPaperAction(identity, paper, libraryService);
			if (!paper.isSeed) paintComparisonCard(body, kind, score, comparison);
			position();
		},
	};
}
