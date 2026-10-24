import { tr } from "./i18n";
import type { PaperNode } from "./types";
import type { DiscoveryPayload, DiscoveryRequest } from "./discovery-graph";

declare global {
	interface WindowEventMap {
		"research-connected-library-changed": Event;
		"research-connected-theme": Event;
		"research-connected-open-discovery": CustomEvent<{ payload?: DiscoveryPayload; paper?: string; handled?: boolean }>;
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
	card.append(createEl("h3", { text: tr("文库与全文获取", "Library and full text") }));
	const summary = createEl("p");
	const providers = createDiv();
	const actions = createDiv({ cls: "cpo-paper-actions" });
	card.append(summary, providers, actions);
	const localText = { held: tr("本地已有全文", "Full text available locally"), "note-only": tr("仅有笔记，尚无本地全文", "Note exists; no local full text"), absent: tr("本地未找到匹配论文", "No matching paper found locally"), ambiguous: tr("存在多个本地匹配，请核对", "Multiple local matches; review needed") };
	const paint = (data: LibraryAvailability): void => {
		summary.textContent = localText[data.local.state];
		providers.replaceChildren();
		for (const [name, label] of [["oa", tr("开放获取", "Open access")], ["scihub", "Sci-Hub"]]) {
			const value = data.providers[name!];
			const state = value?.state ?? "not-checked";
			const text: Record<string, string> = { available: tr("报告有链接", "Link reported"), "not-found": tr("未报告链接", "No link reported"), error: tr("查询失败", "Check failed"), checking: tr("正在查询…", "Checking…"), "not-checked": tr("尚未查询", "Not checked"), "not-configured": tr("尚未配置", "Not configured") };
			const cached = value?.stale ? tr("（旧缓存）", " (stale cache)") : value?.cached ? tr("（缓存）", " (cached)") : "";
			const line = createEl("p", { text: `${label}: ${text[state] ?? state}${cached}${value?.checking && state !== "checking" ? tr(" · 正在刷新…", " · refreshing…") : ""}` });
			if (value?.detail) line.title = value.detail;
			providers.append(line);
			if (value?.checkedAt) providers.append(createEl("small", { text: new Date(value.checkedAt).toLocaleString() }));
			if (value?.refreshError) providers.append(createEl("small", { text: tr("刷新失败，仍显示已有缓存链接。", "Refresh failed; showing the cached link.") }));
			const links = value?.links?.length ? value.links : value?.url ? [{ url: value.url, kind: "page" }] : [];
			for (const location of links.slice(0, 20)) {
				try {
					const url = new URL(location.url);
					if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
						const link = createEl("button", { text: name === "oa" && location.kind === "pdf" ? tr("打开开放获取 PDF", "Open OA PDF") : tr("打开报告的链接", "Open reported link") });
						link.type = "button";
						link.addEventListener("click", () => openExternal(url.href));
						providers.append(link);
					}
				} catch { /* Invalid provider link is never opened. */ }
			}
		}
	};
	const initial = bridge.read(paper);
	paint(initial);
	if (initial.local.matchedBy) card.append(createEl("small", { text: tr(`匹配依据：${initial.local.matchedBy}`, `Matched by ${initial.local.matchedBy}`) }));
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
	const buttons: HTMLButtonElement[] = [];
	for (const [provider, label] of [["oa", tr("查询开放获取", "Check open access")], ["scihub", tr("查询 Sci-Hub", "Check Sci-Hub")]]) {
		const button = createEl("button", { text: label });
		button.type = "button";
		button.disabled = !initial.doi || !!initial.checking;
		buttons.push(button); actions.append(button);
		button.addEventListener("click", () => {
			for (const item of buttons) item.disabled = true;
			summary.textContent = tr("正在查询…", "Checking…");
			void bridge.check(paper, { provider, refresh: true }).then(data => {
				if (card.isConnected) paint(data);
			}).catch(() => {
				if (card.isConnected) summary.textContent = tr("查询失败，请检查文库插件配置", "Check failed; inspect Research Vault configuration");
			}).finally(() => { for (const item of buttons) item.disabled = !initial.doi; });
		});
	}
	card.append(createEl("small", { text: tr("H：已获得 · N：仅笔记 · −：未获得 · O/S：报告有 OA/Sci-Hub 链接。链接未下载或验证。", "H: held · N: note only · −: absent · O/S: OA/Sci-Hub link reported. Links are not downloaded or verified.") }));
}
