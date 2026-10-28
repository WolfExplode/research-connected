import type { PaperLibrary } from "./paper-library";
import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";
import { allowedExternalUrl } from "./safe-url";
import type { PaperNode } from "./types";

/** Paper-scoped actions are shared by graph pane and note embed. Save and Bookmark need the library. */
export function paintPaperActions(
	parent: HTMLElement,
	paper: PaperNode,
	options: { library?: PaperLibrary; openExternal: (url: string) => void },
): void {
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const row = card.querySelector<HTMLElement>(":scope > .cpo-paper-actions") ?? createDiv();
	row.classList.add("cpo-paper-actions");
	if (!row.parentElement) card.append(row);
	const sources = createDiv();
	sources.className = "cpo-paper-sources";
	if (options.library) paintLibraryActions(card, row, paper, options.library);
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


function acquisitionMessage(reason: string): string {
	const reasons: Record<string, string> = {
		"no-oa-copy": tr("未找到可下载的开放获取全文。", "No downloadable open-access copy was found."),
		paywall: tr("全文需要访问权限。", "Full text requires access."),
		network: tr("下载请求失败，请重试。", "The download request failed. Try again."),
		"not-found": tr("未找到论文的下载元数据。", "Download metadata could not be found."),
		mismatch: tr("获取的文件与论文不匹配。", "The retrieved file did not match this paper."),
		"not-a-pdf": tr("获取的文件未通过全文验证。", "The retrieved file failed full-text validation."),
		"download-unavailable": tr("启用 Research Vault 后可重试下载。", "Enable Research Vault to retry the download."),
		"unsupported-location": tr("请将文献笔记归档到 Research/Papers 后重试下载。", "File this note in Research/Papers before retrying the download."),
	};
	return tr("已加入文库。", "Added to library. ") + (reasons[reason] || tr("全文暂未获取，请重试或稍后导入。", "Full text could not be obtained. Retry or import a copy later."));
}

/** Consistent, vault-owned actions shared by graph, similarity results, lists, and embeds. */
function paintLibraryActions(card: HTMLElement, row: HTMLElement, paper: PaperNode, library: PaperLibrary): void {
	const save = createEl("button", { cls: "cpo-paper-action cpo-paper-save" }); save.type = "button";
	const bookmark = createEl("button", { cls: "cpo-paper-action cpo-paper-stage cpo-paper-bookmark" }); bookmark.type = "button";
	const feedback = createSpan({ cls: "cpo-paper-action-error cpo-paper-library-feedback" }); feedback.setAttribute("role", "status"); feedback.hidden = true;
	let running = false;
	const paint = (): void => {
		const state = library.read(paper), busy = running || library.busy?.(paper);
		if (state.ambiguous) { feedback.textContent = tr("匹配到多份文献笔记，请先核对。", "Multiple library notes match. Review them before saving."); feedback.hidden = false; }
		else if (state.error) { feedback.textContent = state.error; feedback.hidden = false; }
		else if (state.reason && !state.held && !busy) {
			feedback.textContent = acquisitionMessage(state.reason); feedback.hidden = false;
		}
		save.replaceChildren(createChromeIcon("save"), document.createTextNode(state.held ? tr("已在文库", "In library") : state.reason ? tr("重试下载", "Retry download") : tr("保存", "Save")));
		save.disabled = !!busy || state.held || !!state.ambiguous;
		setHoverHint(save, state.held ? tr("全文已在文库中。", "Full text is already in your library.") : tr("创建或复用文献笔记，并尝试下载全文。下载失败会记录在笔记中。", "Create or reuse a library note and try to download the paper. Failed attempts are recorded in the note."));
		bookmark.replaceChildren(createChromeIcon(state.bookmark ? "bookmarkCheck" : "bookmark"), document.createTextNode(state.bookmark ? tr("已收藏", "Bookmarked") : tr("收藏", "Bookmark")));
		bookmark.setAttribute("aria-pressed", String(state.bookmark)); bookmark.disabled = !!busy || !!state.ambiguous;
		setHoverHint(bookmark, state.bookmark ? tr("移除收藏，保留文献笔记和文件。", "Remove this bookmark. Keep the library note and files.")
			: tr("收藏到全库清单。需要时创建文献笔记，不下载全文。", "Bookmark across your vault. Creates a metadata-only note when needed. Does not download a PDF."));
	};
	const run = async (action: () => Promise<void>): Promise<void> => {
		if (running) return; running = true; feedback.hidden = true; paint();
		try { await action(); }
		catch (error) { feedback.textContent = error instanceof Error ? error.message : tr("操作失败，请重试。", "Could not complete the action. Try again."); feedback.hidden = false; }
		finally { running = false; paint(); }
	};
	save.onclick = () => run(async () => {
		const state = await library.save(paper);
		if (!state.held) { feedback.textContent = acquisitionMessage(state.reason || ""); feedback.hidden = false; }
	});
	bookmark.onclick = () => run(() => library.setBookmark(paper, !library.read(paper).bookmark));
	paint(); row.append(save, bookmark);
	const localAction = row.querySelector(".cpo-local-paper");
	if (localAction) row.append(localAction);
	else {
		const note = library.read(paper).note;
		if (note) { const open = createEl("button", { cls: "cpo-paper-action cpo-local-paper" }); open.type = "button"; open.append(createChromeIcon("note")); setHoverHint(open, tr("打开文献笔记", "Open library note")); open.onclick = () => library.open(note); row.append(open); }
	}
	card.append(feedback);
}
