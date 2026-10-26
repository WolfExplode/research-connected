import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";
import type { CitationEvidence } from "./citation-evidence";
import { stageSourceLabel } from "./staging";
import type { ProjectPaperState } from "./project-state";
import { allowedExternalUrl } from "./safe-url";
import type { GraphEdge, PaperNode } from "./types";

/** Paper-scoped actions are shared by graph pane and note embed. */
export function paintPaperActions(
	parent: HTMLElement,
	paper: PaperNode,
	seedId: string | null,
	edge: GraphEdge | null,
	evidence: CitationEvidence | null,
	options: {
		getPaperState: (seedId: string, paperId: string) => ProjectPaperState | undefined;
		setStaged: (paper: PaperNode, seedId: string, staged: boolean, source: string) => void;
		persist?: (source: string) => Promise<void> | void;
		openExternal: (url: string) => void;
	},
): void {
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const row = card.querySelector<HTMLElement>(":scope > .cpo-paper-actions") ?? createDiv();
	row.classList.add("cpo-paper-actions");
	if (!row.parentElement) card.append(row);
	const sources = createDiv();
	sources.className = "cpo-paper-sources";
	if (seedId && options.persist) {
		const button = createEl("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-stage";
		const paintStage = (): void => {
			const staged = Boolean(options.getPaperState(seedId, paper.id)?.staged);
			button.replaceChildren(createChromeIcon(staged ? "bookmarkCheck" : "bookmark"), document.createTextNode(staged ? tr("已暂存", "Saved") : tr("暂存", "Save")));
			button.setAttribute("aria-pressed", String(staged));
			setHoverHint(button, staged
				? tr("从此项目的已保存论文中移除书签。", "Remove this bookmark from Saved papers for this project.")
				: tr("将论文信息和发现来源加入此项目的已保存论文。不下载 PDF、不创建笔记，也不更改阅读状态。", "Bookmark this paper’s metadata and discovery source in Saved papers for this project. Does not download a PDF, create a note, or change reading status."));
		};
		paintStage();
		button.onclick = async () => {
			const before = Boolean(options.getPaperState(seedId, paper.id)?.staged);
			const source = stageSourceLabel(paper, seedId, edge, evidence);
			options.setStaged(paper, seedId, !before, source);
			button.disabled = true;
			card.querySelector(".cpo-paper-stage-error")?.remove();
			try {
				await options.persist?.(source);
				paintStage();
			} catch {
				options.setStaged(paper, seedId, before, source);
				paintStage();
				let error = card.querySelector<HTMLElement>(".cpo-paper-stage-error");
				if (!error) {
					error = createSpan();
					error.className = "cpo-paper-action-error cpo-paper-stage-error";
					error.setAttribute("role", "status");
					card.append(error);
				}
				error.textContent = tr("保存失败，请重试", "Could not save. Try again.");
			} finally {
				button.disabled = false;
			}
		};
		row.append(button);
	}
	for (const [label, candidate] of [["OpenAlex", paper.openAlexUrl], ["DOI", paper.doiUrl]] as const) {
		const url = candidate ? allowedExternalUrl(candidate) : null;
		if (!url) continue;
		const button = createEl("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-source";
		button.append(document.createTextNode(label), createChromeIcon("external"));
		button.onclick = () => options.openExternal(url);
		sources.append(button);
	}
	if (sources.childElementCount) row.append(sources);
}
