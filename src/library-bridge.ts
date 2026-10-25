import { tr } from "./i18n";
import type { PaperNode } from "./types";
import type { DiscoveryPayload, DiscoveryRequest } from "./discovery-graph";

declare global {
	interface WindowEventMap {
		"research-connected-library-changed": Event;
		"research-connected-theme": Event;
		"research-connected-open-discovery": CustomEvent<{ payload?: DiscoveryPayload; paper?: string; question?: string; mode?: "rank" | "search"; handled?: boolean }>;
	}
}

export interface LibraryAvailability {
	doi: string | null;
	local: { state: "held" | "note-only" | "absent" | "ambiguous"; note: string | null; files: string[]; matchedBy?: "doi" | "openalex" | "title" | "file" };
	providers: Record<string, { state: string; url?: string; links?: Array<{ url: string; kind: string }>; detail?: string; checkedAt?: string; cached?: boolean; stale?: boolean; checking?: boolean; refreshError?: string }>;
	checking?: boolean;
}

/** Optional host integration. It owns holdings and provider access; graph state stays independent. */
export interface LibraryBridge {
	version: 1;
	read(paper: PaperNode): LibraryAvailability;
	check(paper: PaperNode, options: { provider?: string; local?: boolean; refresh?: boolean }): Promise<LibraryAvailability>;
	prefetch?(papers: readonly PaperNode[]): void;
	open(note: string): void;
	discovery?: {
		context(): { questions: Array<{ path: string; title: string }>; papers: Array<{ path: string; title: string }> };
		run(request: DiscoveryRequest): Promise<DiscoveryPayload>;
	};
}

export function requestLibraryBridge(): LibraryBridge | null {
	const detail: { bridge?: LibraryBridge } = {};
	window.dispatchEvent(new CustomEvent("research-connected-library-request", { detail }));
	return detail.bridge?.version === 1 ? detail.bridge : null;
}

export function paintLibraryAvailability(parent: HTMLElement, paper: PaperNode, bridge: LibraryBridge, openExternal: (url: string) => void): void {
	bridge.prefetch?.([paper]);
	const card = createEl("section", { cls: "cpo-card cpo-library-availability" });
	parent.append(card);
	card.append(createEl("h3", { cls: "cpo-card-title", text: tr("文库与全文获取", "Library and full text") }));
	const summary = createEl("p", { cls: "cpo-availability-local" });
	const providers = createDiv({ cls: "cpo-availability-providers" });
	const actions = createDiv({ cls: "cpo-paper-actions" });
	card.append(summary, providers, actions);
	const localText = { held: tr("本地已有全文", "Full text available locally"), "note-only": tr("仅有笔记，尚无本地全文", "Note exists; no local full text"), absent: tr("本地未找到匹配论文", "No matching paper found locally"), ambiguous: tr("存在多个本地匹配，请核对", "Multiple local matches; review needed") };
	const buttons: HTMLButtonElement[] = [];
	const feedback = createEl("p", { cls: "cpo-availability-feedback", attr: { role: "status", "aria-live": "polite" } });
	const paint = (data: LibraryAvailability): void => {
		summary.textContent = localText[data.local.state];
		if (data.local.matchedBy) summary.append(createEl("small", { cls: "cpo-availability-meta", text: tr(`匹配依据：${data.local.matchedBy}`, `Matched by ${data.local.matchedBy}`) }));
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
			if (value?.detail) line.title = value.detail;
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
						const link = createEl("button", { text: location.kind === "pdf" ? tr("打开 PDF", "Open PDF") : name === "oa" ? tr("打开来源页面", "Open source page") : tr("打开 Sci-Hub 链接", "Open Sci-Hub link") });
						link.type = "button";
						link.title = url.hostname;
						link.setAttribute("aria-label", `${link.textContent} · ${url.hostname}`);
						link.addEventListener("click", () => openExternal(url.href));
						linkActions.append(link);
					}
				} catch { /* Invalid provider link is never opened. */ }
			}
			// Only offer a check while there is no usable result; a fresh check removes the button.
			if (state === "not-checked" || state === "error" || value?.stale) {
				const check = createEl("button", { text: state === "not-checked" ? (name === "oa" ? tr("查询开放获取", "Check open access") : tr("查询 Sci-Hub", "Check Sci-Hub")) : "↻" });
				check.type = "button";
				if (state !== "not-checked") {
					check.title = tr("重新查询", "Check again");
					check.setAttribute("aria-label", check.title);
				}
				check.disabled = !data.doi || !!data.checking;
				if (!data.doi) check.title = tr("需要 DOI 才能查询", "A DOI is needed to check availability");
				buttons.push(check); linkActions.append(check);
				check.addEventListener("click", () => {
					for (const item of buttons) item.disabled = true;
					feedback.textContent = "";
					const idleLabel = check.textContent;
					check.textContent = tr("正在查询…", "Checking…");
					void bridge.check(paper, { provider: name, refresh: true }).then(next => {
						if (card.isConnected) { paint(next); feedback.textContent = ""; }
					}).catch(() => {
						if (card.isConnected) {
							feedback.textContent = tr("查询失败，请检查文库插件配置", "Check failed; inspect Research Vault configuration");
							check.textContent = idleLabel;
							for (const item of buttons) item.disabled = !data.doi;
						}
					});
				});
			}
		}
	};
	const initial = bridge.read(paper);
	paint(initial);
	for (const file of initial.local.files) {
		const open = createEl("button", { text: initial.local.files.length === 1 ? tr("打开本地全文", "Open local full text") : file.split("/").pop() });
		open.type = "button"; open.title = file;
		open.addEventListener("click", () => bridge.open(file)); actions.append(open);
	}
	if (initial.local.note) {
		const note = initial.local.note;
		const open = createEl("button", { text: tr("打开文库笔记", "Open library note") });
		open.type = "button"; open.addEventListener("click", () => bridge.open(note)); actions.append(open);
		if (bridge.discovery && note.startsWith("Research/Papers/")) {
			const related = createEl("button", { text: tr("查找本地相关论文", "Find related local papers") });
			related.type = "button";
			related.addEventListener("click", () => window.dispatchEvent(new CustomEvent("research-connected-open-discovery", { detail: { paper: note } })));
			actions.append(related);
		}
	}
	card.append(feedback);
	if (!initial.doi) feedback.textContent = tr("此论文没有 DOI，无法查询在线来源。", "Add a DOI to check online sources.");
}
