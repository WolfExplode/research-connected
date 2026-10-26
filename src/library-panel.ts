import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import type { PaperNode } from "./types";
import type { DiscoveryPayload, DiscoveryRequest } from "./discovery-graph";
import type { StoredTextEvidence } from "./paper-comparison";
import type { DoiRecovery } from "./doi-recovery";

declare global {
	interface WindowEventMap {
		/** Private to this plugin: the paper library changed in a way open graphs can show. */
		"research-connected-library-changed": Event;
		"research-connected-label-paper": CustomEvent<{ note: string }>;
		"research-connected-theme": Event;
		"research-connected-open-discovery": CustomEvent<{ paper?: string; question?: string; mode?: "rank" | "search" }>;
	}
}

export interface LibraryAvailability {
	doi: string | null;
	local: { state: "held" | "note-only" | "absent" | "ambiguous"; note: string | null; files: string[]; bookmark?: boolean; reading?: string; reason?: string; attemptedAt?: string; matchedBy?: "doi" | "openalex" | "title" | "file" };
	providers: Record<string, { state: string; url?: string; links?: Array<{ url: string; kind: string }>; detail?: string; checkedAt?: string; cached?: boolean; stale?: boolean; checking?: boolean; refreshError?: string }>;
	checking?: boolean;
}

/**
 * The paper library as graphs see it. ResearchLibrary implements it over the research tools; checks
 * supply only the parts they exercise, so the capabilities beyond read, check and open are optional.
 * Graph state stays independent of it.
 */
export interface PaperLibraryService {
	read(paper: PaperNode): LibraryAvailability;
	save?(paper: PaperNode): Promise<LibraryAvailability>;
	bookmark?(paper: PaperNode, value: boolean): Promise<LibraryAvailability>;
	check(paper: PaperNode, options: { provider?: string; local?: boolean; refresh?: boolean }): Promise<LibraryAvailability>;
	prefetch?(papers: readonly PaperNode[]): void;
	/** Returns cached evidence; the host may schedule background downloads and notify on completion. */
	textEvidence?(papers: readonly PaperNode[]): Promise<StoredTextEvidence[]>;
	/** All eligible source notes, including papers without a PDF, DOI, or vector. May schedule background embedding retrieval. */
	textLibrary?(): Promise<Array<{ paper: PaperNode; note: string; vector?: number[] }>>;
	embeddingStatus?(): { pending: number; state: string };
	open(note: string): void;
	discovery?: {
		context(): { questions: Array<{ path: string; title: string }>; papers: Array<{ path: string; title: string }> };
		run(request: DiscoveryRequest): Promise<DiscoveryPayload>;
	};
}

export interface DoiRecoveryAction {
	cached: DoiRecovery | null;
	find(): Promise<DoiRecovery>;
	changed(): void;
}

/** A single local action shared by the identity card and graph context menu. */
export function paintLocalPaperAction(parent: HTMLElement, paper: PaperNode, libraryService: PaperLibraryService | null | undefined, menu = false): void {
	parent.querySelector(menu ? ".cpo-local-paper-menu" : ".cpo-local-paper")?.remove();
	if (!libraryService) return;
	const local = libraryService.read(paper).local;
	if (local.state === "absent" || local.state === "ambiguous") return;
	const target = local.note ?? local.files[0];
	if (!target) return;
	const label = tr("打开本地论文", "Open local paper");
	const button = createEl("button", { cls: menu ? "cpo-local-paper-menu" : "cpo-paper-action cpo-local-paper", text: menu ? `📄 ${label}` : "📄" });
	button.type = "button";
	setHoverHint(button, `${label} · ${target}`);
	if (menu) button.setAttribute("role", "menuitem");
	button.addEventListener("click", () => { libraryService.open(target); if (menu) parent.hidden = true; });
	if (menu) parent.append(button);
	else {
		let actions = parent.querySelector<HTMLElement>(":scope > .cpo-paper-actions");
		if (!actions) {
			actions = createDiv({ cls: "cpo-paper-actions" });
			parent.append(actions);
		}
		actions.insertBefore(button, actions.querySelector(":scope > .cpo-paper-sources"));
	}
}

export function paintLibraryAvailability(parent: HTMLElement, paper: PaperNode, libraryService: PaperLibraryService, openExternal: (url: string) => void, recovery?: DoiRecoveryAction): void {
	libraryService.prefetch?.([paper]);
	const card = createEl("section", { cls: "cpo-card cpo-library-availability" });
	parent.append(card);

	const providers = createDiv({ cls: "cpo-availability-providers" });
	const actions = createDiv({ cls: "cpo-paper-actions" });
	card.append(providers, actions);

	const buttons: HTMLButtonElement[] = [];
	const feedback = createEl("p", { cls: "cpo-availability-feedback", attr: { role: "status", "aria-live": "polite" } });
	const paint = (data: LibraryAvailability): void => {
		const identity = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity");
		if (identity) paintLocalPaperAction(identity, paper, libraryService);
		providers.replaceChildren();
		buttons.length = 0;
		for (const [name, label] of [["oa", tr("开放获取", "Open access")], ["scihub", "Sci-Hub"]]) {
			const value = data.providers[name!];
			const state = value?.state ?? "not-checked";
			const text: Record<string, string> = { available: tr("报告有链接", "Link reported"), "not-found": tr("未报告链接", "No link reported"), error: tr("查询失败", "Check failed"), checking: tr("正在查询…", "Checking…"), "not-checked": tr("尚未查询", "Not checked"), "not-configured": tr("尚未配置", "Not configured") };
			const cached = value?.stale ? tr("（旧缓存）", " (stale cache)") : value?.cached ? tr("（缓存）", " (cached)") : "";
			const row = createDiv({ cls: "cpo-availability-provider" });
			const heading = createDiv({ cls: "cpo-availability-heading" });
			heading.append(createEl("strong", { text: label }));
			const line = createSpan({ cls: "cpo-availability-status", text: `${text[state] ?? state}${value?.checking && state !== "checking" ? tr(" · 正在刷新…", " · refreshing…") : ""}` });
			line.dataset.state = state;
			if (value?.detail) setHoverHint(line, value.detail);
			heading.append(line); row.append(heading); providers.append(row);
			if (value?.checkedAt) row.append(createEl("small", { cls: "cpo-availability-meta", text: tr("查询于 ", "Checked ") + new Date(value.checkedAt).toLocaleString() + cached }));
			else if (cached) row.append(createEl("small", { cls: "cpo-availability-meta", text: cached.trim() }));
			if (value?.refreshError) row.append(createEl("small", { cls: "cpo-availability-meta", text: tr("刷新失败，仍显示已有缓存链接。", "Refresh failed; showing the cached link.") }));
			const linkActions = createDiv({ cls: "cpo-availability-links" });
			row.append(linkActions);
			const links = value?.links?.length ? value.links : value?.url ? [{ url: value.url, kind: "page" }] : [];
			const seen = new Set<string>();
			for (const location of links.slice(0, 20)) {
				try {
					const url = new URL(location.url);
					if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !seen.has(url.href)) {
						seen.add(url.href);
						const link = createEl("a", { cls: "cpo-availability-link", text: url.href });
						link.href = url.href;
						link.target = "_blank";
						link.rel = "noopener noreferrer";
						setHoverHint(link, url.href);
						link.addEventListener("click", event => {
							// Keep modified clicks and the context menu available as normal link actions.
							if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
							event.preventDefault();
							openExternal(url.href);
						});
						linkActions.append(link);
					}
				} catch { /* Invalid provider link is never opened. */ }
			}
			// Only offer a check while there is no usable result; a fresh check removes the button.
			if (state === "not-checked" || state === "error" || value?.stale) {
				const check = createEl("button", { text: state === "not-checked" ? (name === "oa" ? tr("查询开放获取", "Check open access") : tr("查询 Sci-Hub", "Check Sci-Hub")) : "↻" });
				check.type = "button";
				if (state !== "not-checked") {
					setHoverHint(check, tr("重新查询", "Check again"));
				}
				check.disabled = !data.doi || !!data.checking;
				if (!data.doi) setHoverHint(check, tr("需要 DOI 才能查询", "A DOI is needed to check availability"));
				buttons.push(check); linkActions.append(check);
				check.addEventListener("click", () => {
					for (const item of buttons) item.disabled = true;
					feedback.textContent = "";
					const idleLabel = check.textContent;
					check.textContent = tr("正在查询…", "Checking…");
					void libraryService.check(paper, { provider: name, refresh: true }).then(next => {
						if (card.isConnected) { paint(next); feedback.textContent = ""; }
					}).catch(() => {
						if (card.isConnected) {
							feedback.textContent = tr("查询失败，请检查研究工具设置", "Check failed; check the research tools settings");
							check.textContent = idleLabel;
							for (const item of buttons) item.disabled = !data.doi;
						}
					});
				});
			}
		}
	};
	const initial = libraryService.read(paper);
	paint(initial);
	if (initial.local.note) {
		const note = initial.local.note;
		if (note.startsWith("Research/Papers/")) {
			const label = createEl("button", { text: tr("标注论文", "Label paper") });
			label.type = "button";
			setHoverHint(label, tr("质量、阅读状态、收藏和问题相关性，写入论文笔记", "Quality, reading status, bookmark and question relevance, written to the paper note"));
			label.addEventListener("click", () => window.dispatchEvent(new CustomEvent("research-connected-label-paper", { detail: { note } })));
			actions.append(label);
		}
		if (libraryService.discovery && note.startsWith("Research/Papers/")) {
			const related = createEl("button", { text: tr("查找本地相关论文", "Find related local papers") });
			related.type = "button";
			related.addEventListener("click", () => window.dispatchEvent(new CustomEvent("research-connected-open-discovery", { detail: { paper: note } })));
			actions.append(related);
		}
	}
	card.append(feedback);
	const recoveryText = (result: DoiRecovery): string => result.state === "found"
		? tr(`DOI 已由 ${result.candidates[0]!.source} 验证：${result.candidates[0]!.doi}`, `DOI verified through ${result.candidates[0]!.source}: ${result.candidates[0]!.doi}`)
		: result.state === "ambiguous" ? tr("找到多个匹配 DOI，请核对来源。未自动添加。", "Multiple matching DOIs; review the sources. No DOI was assigned.")
			: tr("未找到可验证的 DOI。可补充作者、年份或期刊信息后重试。", "No verified DOI found. Add author, year, or journal details and try again.");
	if (recovery?.cached) {
		feedback.textContent = recoveryText(recovery.cached);
		if (recovery.cached.state === "ambiguous") for (const candidate of recovery.cached.candidates) {
			const link = createEl("button", { text: `${candidate.source}: ${candidate.doi}` });
			link.type = "button"; link.addEventListener("click", () => openExternal(`https://doi.org/${candidate.doi}`)); actions.append(link);
		}
	}
	if (!initial.doi) {
		if (!recovery?.cached) feedback.textContent = tr("查找 DOI 后即可查询在线来源。", "Find a DOI to check online sources.");
		if (recovery) {
			const find = createEl("button", { text: recovery.cached ? tr("重试查找 DOI", "Retry DOI search") : tr("查找 DOI", "Find DOI") });
			find.type = "button"; actions.prepend(find);
			find.addEventListener("click", () => {
				find.disabled = true; feedback.textContent = tr("正在查找并核对 DOI…", "Searching and verifying DOI…");
				void recovery.find().then(() => { if (card.isConnected) recovery.changed(); }).catch(() => {
					if (card.isConnected) { feedback.textContent = tr("DOI 查询或保存失败，请重试。", "DOI lookup or save failed. Try again."); find.disabled = false; }
				});
			});
		}
	}
}
