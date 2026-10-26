import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import { evidenceBadges, paperStateBadges, type CitationEvidence, type CrossCheckLike, type EvidenceBadge, type PaperStateLike } from "./citation-evidence";
import { LAYOUT_HINT, LAYOUT_LABEL, type LayoutMode } from "./layout-modes";
import type { SimilarityKind } from "./paper-comparison";
export type ExportKind = "bibtex" | "yaml" | "table" | "note";
export type GraphTab = "graph" | "prior" | "derivative" | "research" | "bookmarks" | "excluded";

export function createChromeIcon(name: "grid" | "clock" | "radial" | "play" | "pause" | "edit" | "save" | "project" | "views" | "refresh" | "fit" | "diagnose" | "external" | "bookmark" | "bookmarkCheck" | "read" | "exclude" | "copy" | "table" | "note" | "export" | "chevronDown"): SVGSVGElement {
	const paths: Record<typeof name, string[]> = {
		grid: ["M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z"],
		clock: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "M10 5v5l3.2 2"],
		radial: ["M10 10 4 4M10 10l7-1M10 10l-3 7", "M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M2.5 2.5h3v3h-3zM15 7h3v3h-3zM5.5 15h3v3h-3z"],
		play: ["m7 4 9 6-9 6z"],
		pause: ["M6.5 4.5v11M13.5 4.5v11"],
		edit: ["m4 13.5-.8 3.3 3.3-.8L16 6.5 13.5 4z", "m11.8 5.7 2.5 2.5"],
		save: ["M4 3.5h10l2 2V16.5H4z", "M7 3.5v4h6v-4M7 16.5v-5h6v5"],
		project: ["M2.5 5.5h6l1.5 1.7h7.5v8.3h-15z", "M2.5 5.5V4h6l1.5 1.5"],
		views: ["m10 3 7 3.5-7 3.5-7-3.5z", "m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5"],
		refresh: ["M16 7V3.5l-2 2A6.5 6.5 0 1 0 16.5 12", "M16 3.5v4h-4"],
		fit: ["M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4"],
		diagnose: ["M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z", "m12.2 12.2 4.3 4.3"],
		external: ["M11 4h5v5", "m16 4-7 7", "M14 11v5H4V6h5"],
		bookmark: ["M5 3.5h10v13l-5-3-5 3z"],
		bookmarkCheck: ["M5 3.5h10v13l-5-3-5 3z", "m7.5 8.5 1.5 1.5 3-3"],
		read: ["M5 2.5h7l3 3v12H5z", "M12 2.5v3h3", "m7 11 2 2 4-4"],
		exclude: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "M6 10h8"],
		copy: ["M7 7h9v10H7z", "M4 13H3V3h9v1"],
		table: ["M3 4h14v12H3z", "M3 8h14M3 12h14M8 4v12"],
		note: ["M5 3h8l3 3v11H5z", "M12 3v4h4", "M8 11h5M8 14h5"],
		export: ["M10 3v9", "m6.5 8.5 3.5 3.5 3.5-3.5", "M4 13v4h12v-4"],
		chevronDown: ["m5 7.5 5 5 5-5"],
	};
	const svg = createSvg("svg");
	svg.setAttribute("viewBox", "0 0 20 20");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("cpo-icon-glyph");
	for (const d of paths[name]) {
		const path = createSvg("path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

/** Shared badge row; empty input paints nothing. */
export function paintBadges(host: HTMLElement, badges: readonly EvidenceBadge[]): void {
	if (badges.length === 0) return;
	const row = createSpan();
	row.className = "cpo-badges";
	for (const badge of badges) {
		const item = createSpan();
		item.className = `cpo-badge cpo-badge-${badge.tone}`;
		item.textContent = badge.label;
		row.append(item);
	}
	host.append(row);
}

/** Source-confidence badges for a citation record; 数据缺失 when there is none. */
export function paintEvidenceBadges(host: HTMLElement, evidence: CitationEvidence | null): void {
	paintBadges(host, evidenceBadges(evidence));
}

/** Node-level state badges (撤稿 / 非研究记录 / 数据源差异 / S2 回填); nothing painted when clean. */
export function paintPaperStateBadges(host: HTMLElement, paper: PaperStateLike, check: CrossCheckLike | null | undefined): void {
	paintBadges(host, paperStateBadges(paper, check));
}

export interface GraphChromeOptions {
	similarityKind?: SimilarityKind;
	onSimilarity?: (kind: SimilarityKind) => void;
	layouts: readonly LayoutMode[];
	layout: LayoutMode;
	noteButton: boolean;
	onExport: (kind: ExportKind) => void;
	onLayout: (mode: LayoutMode) => void;
	onScrub: (year: number | null) => void;
	onTab: (tab: GraphTab) => void;
	researchButton?: boolean;
	/** Tabs and export actions. When set, they leave the control host. */
	actionsHost?: HTMLElement;
	/** Layout buttons. When set, they leave the control host for the narrow rail. */
	layoutHost?: HTMLElement;
	/** Year scrubber / play. Hidden unless layout is temporal. */
	scrubHost?: HTMLElement;
}

export interface GraphChrome {
	setSimilarityKind(kind: SimilarityKind): void;
	setCitationSimilarityAvailable(available: boolean): void;
	setLayout(mode: LayoutMode): void;
	setSimilarityAvailable(available: boolean): void;
	setResearchVisible(visible: boolean): void;
	setYears(min: number, max: number): void;
	/** Restore controls without invoking user-action callbacks or scheduling saves. */
	restoreView(view: { layout: LayoutMode; similarityKind?: SimilarityKind; scrubYear: number | null }): void;
	/** 新图没有任何年份时收起滑块行，避免旧范围把节点全部过滤掉。 */
	clearYears(): void;
	/** 同步页签按钮高亮（不触发 onTab，由调用方自己渲染）。 */
	setTab(tab: GraphTab): void;
	setExportText(text: string, showPreview?: boolean): void;
	copyText(text: string, label: string): Promise<void>;
	clearExportText(): void;
	destroy(): void;
}

export interface BottomSheet {
	body: HTMLElement;
	setSummary(title: string, meta: string, tags?: { lang?: string | null }): void;
	setExpanded(open: boolean): void;
	destroy(): void;
}

/** Layout, color, year scrubber, list tabs, and export actions. Shared by the embed and the pane. */
export function mountGraphChrome(host: HTMLElement, options: GraphChromeOptions): GraphChrome {
	const actions = options.actionsHost && options.actionsHost !== host ? options.actionsHost : host;
	if (actions !== host) {
		actions.classList.add("cpo-tools", "cpo-actions");
		actions.replaceChildren();
	}
	const layoutHost = options.layoutHost && options.layoutHost !== host ? options.layoutHost : null;
	const scrubHost = options.scrubHost && options.scrubHost !== host ? options.scrubHost : null;
	if (layoutHost) layoutHost.classList.add("cpo-rail-layouts");
	if (!layoutHost && !scrubHost) {
		host.classList.add("cpo-tools");
		if (actions === host) host.replaceChildren();
	}

	const layoutRow = createDiv();
	layoutRow.className = "cpo-tool-row";
	const scrubRow = createDiv();
	scrubRow.className = "cpo-tool-row cpo-scrub-row";
	const tabRow = createDiv();
	tabRow.className = "cpo-tool-row cpo-tab-row";
	let layout = options.layout;
	let hasYears = false;
	const syncScrub = (): void => {
		const show = layout === "temporal" && hasYears;
		scrubRow.hidden = !show;
		if (show) return;
		stop();
		range.value = String(maxYear);
		readout.textContent = tr("全部年份", "All years");
		options.onScrub(null);
	};
	const readout = createSpan();
	readout.className = "cpo-scrub-readout";
	readout.textContent = tr("全部年份", "All years");
	const output = createDiv();
	output.className = "cpo-export-feedback";
	output.hidden = true;
	const outputMessage = createSpan();
	outputMessage.className = "cpo-export-message";
	outputMessage.setAttribute("role", "status");
	const outputPreview = createEl("pre");
	outputPreview.className = "cpo-export-text";
	outputPreview.hidden = true;
	const clearOutput = createEl("button");
	clearOutput.type = "button";
	clearOutput.className = "cpo-export-clear";
	clearOutput.textContent = tr("清除", "Clear");
	let outputTimer = 0;
	const clearOutputText = (): void => {
		if (outputTimer) window.clearTimeout(outputTimer);
		outputTimer = 0;
		output.hidden = true;
		outputMessage.textContent = "";
		outputPreview.textContent = "";
	};
	clearOutput.addEventListener("click", clearOutputText);
	output.append(outputMessage, clearOutput, outputPreview);
	let minYear = 1900;
	let maxYear = 2020;
	let timer = 0;

	const stop = (): void => {
		if (timer) window.clearInterval(timer);
		timer = 0;
		play.setAttribute("aria-label", tr("播放时间视图", "Play timeline"));
		setHoverHint(play, tr("播放时间视图", "Play timeline"));
		play.replaceChildren(createChromeIcon("play"));
		play.setAttribute("aria-pressed", "false");
	};

	const layoutButtons = new Map<LayoutMode, HTMLButtonElement>();
	let similarityKind = options.similarityKind ?? "text";
	const similarityButtons = new Map<SimilarityKind, HTMLButtonElement>();
	const similarityRow = createDiv();
	similarityRow.className = "cpo-similarity-subviews";
	similarityRow.setAttribute("role", "group");
	similarityRow.setAttribute("aria-label", tr("相似度比较方式", "Similarity comparison"));
	const syncSimilarity = (): void => {
		similarityRow.hidden = layout !== "radial";
		for (const [kind, button] of similarityButtons) setPressed(button, kind === similarityKind && layout === "radial");
	};
	const selectSimilarity = (kind: SimilarityKind): void => {
		if (similarityButtons.get(kind)?.disabled) return;
		similarityKind = kind;
		syncSimilarity();
		options.onSimilarity?.(kind);
	};
	for (const mode of options.layouts) {
		const button = pressButton(LAYOUT_LABEL[mode], mode === layout, () => {
			stop();
			layout = mode;
			for (const [key, item] of layoutButtons) setPressed(item, key === mode);
			syncSimilarity();
			syncScrub();
			options.onLayout(mode);
		});
		setHoverHint(button, LAYOUT_HINT[mode]);
		button.dataset.layout = mode;
		const label = createSpan();
		label.className = "cpo-layout-label";
		label.textContent = LAYOUT_LABEL[mode];
		const icon = createSpan();
		icon.className = "cpo-layout-icon";
		icon.setAttribute("aria-hidden", "true");
		icon.append(createChromeIcon(mode === "force2d" ? "grid" : mode === "temporal" ? "clock" : "radial"));
		button.replaceChildren(icon, label);
		layoutButtons.set(mode, button);
		layoutRow.append(button);
		if (mode === "radial") {
			for (const [kind, label] of [["text", tr("文本", "Text")], ["citations", tr("引用", "Citations")]] as const) {
				const child = pressButton(label, false, () => {
					selectSimilarity(kind);
					if (layout !== "radial") button.click();
				});
				child.dataset.similarity = kind;
				const fullLabel = createSpan(); fullLabel.className = "cpo-similarity-name"; fullLabel.textContent = label;
				const shortLabel = createSpan(); shortLabel.className = "cpo-similarity-short";
				shortLabel.textContent = kind === "text" ? tr("文", "Txt") : tr("引", "Cite");
				shortLabel.setAttribute("aria-hidden", "true");
				child.replaceChildren(fullLabel, shortLabel);
				child.setAttribute("aria-label", kind === "text" ? tr("文本相似度", "Text similarity") : tr("引用相似度", "Citation similarity"));
				similarityButtons.set(kind, child);
				similarityRow.append(child);
			}
			layoutRow.append(similarityRow);
		}
	}
	syncSimilarity();

	const range = createEl("input");
	range.type = "range";
	range.min = String(minYear);
	range.max = String(maxYear);
	range.step = "1";
	range.value = String(maxYear);
	range.setAttribute("aria-label", tr("年份播放", "Year playback"));
	const publish = (): void => {
		const year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) {
			readout.textContent = tr("全部年份", "All years");
			options.onScrub(null);
			return;
		}
		readout.textContent = tr(`截至 ${year}`, `Through ${year}`);
		options.onScrub(year);
	};
	range.addEventListener("input", () => {
		stop();
		publish();
	});

	const play = pressButton(tr("播放", "Play"), false, () => {
		if (timer) {
			stop();
			return;
		}
		let year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) year = minYear;
		range.value = String(year);
		publish();
		play.setAttribute("aria-label", tr("暂停时间视图", "Pause timeline"));
		setHoverHint(play, tr("暂停时间视图", "Pause timeline"));
		play.replaceChildren(createChromeIcon("pause"));
		play.setAttribute("aria-pressed", "true");
		timer = window.setInterval(() => {
			year += 1;
			if (year >= maxYear) {
				range.value = String(maxYear);
				stop();
				publish();
				return;
			}
			range.value = String(year);
			publish();
		}, 700);
	});

	const scrubMeta = createDiv();
	scrubMeta.className = "cpo-scrub-meta";
	scrubMeta.append(readout, play);
	scrubRow.append(range, scrubMeta);

	const tabs: Array<[GraphTab, string]> = [
		["graph", tr("图谱", "Graph")],
		["prior", tr("先验工作", "Prior work")],
		["derivative", tr("衍生工作", "Later work")],
	];
	if (options.researchButton !== undefined) tabs.push(["research", tr("研究脉络", "Research narrative")]);
	const tabButtons = new Map<GraphTab, HTMLButtonElement>();
	for (const [tab, label] of tabs) {
		const button = pressButton(label, tab === "graph", () => {
			for (const [key, item] of tabButtons) setPressed(item, key === tab);
			options.onTab(tab);
		});
		setHoverHint(button, label);
		tabButtons.set(tab, button);
		if (tab === "research") button.hidden = !options.researchButton;
		tabRow.append(button);
	}

	const exportMenu = createEl("details");
	exportMenu.className = "cpo-export-menu";
	const exportSummary = createEl("summary");
	exportSummary.className = "cpo-tool";
	exportSummary.append(createChromeIcon("export"), document.createTextNode(tr("导出", "Export")), createChromeIcon("chevronDown"));
	exportMenu.append(exportSummary);
	const exportItems = createDiv();
	exportItems.className = "cpo-export-items";
	for (const [label, kind] of [["BibTeX", "bibtex"], ["YAML", "yaml"], [tr("表格", "Table"), "table"], [options.noteButton ? tr("写入笔记", "Write to note") : tr("笔记骨架", "Note template"), "note"]] as const) {
		exportItems.append(actionButton(label, () => options.onExport(kind)));
	}
	exportMenu.append(exportItems);
	const releaseExportMenu = registerPopover(exportMenu);
	tabRow.append(exportMenu);

	const onExportKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape" && !output.hidden) clearOutputText();
	};
	if (typeof document !== "undefined") document.addEventListener("keydown", onExportKey);

	if (layoutHost) layoutHost.append(layoutRow);
	else host.append(layoutRow);
	(scrubHost ?? host).append(scrubRow);
	syncScrub();
	actions.append(tabRow, output);

	return {
		restoreView(view): void {
			stop();
			layout = view.layout;
			similarityKind = view.similarityKind ?? "text";
			for (const [key, button] of layoutButtons) setPressed(button, key === layout);
			syncSimilarity();
			scrubRow.hidden = layout !== "temporal" || !hasYears;
			range.value = String(view.scrubYear ?? maxYear);
			readout.textContent = view.scrubYear === null || view.scrubYear >= maxYear
				? tr("全部年份", "All years") : tr(`截至 ${view.scrubYear}`, `Through ${view.scrubYear}`);
		},
		setSimilarityKind: selectSimilarity,
		setCitationSimilarityAvailable(available): void {
			const button = similarityButtons.get("citations");
			if (button) { button.disabled = !available; setHoverHint(button, available ? "" : tr("此结果尚无引用数据", "Citation data is unavailable for these results")); }
			if (!available && similarityKind === "citations") selectSimilarity("text");
		},
		setSimilarityAvailable(available): void {
			const button = layoutButtons.get("radial");
			if (button) button.disabled = !available;
			const text = similarityButtons.get("text");
			if (text) text.disabled = !available;
			if (!available && layout === "radial") layoutButtons.get("force2d")?.click();
		},
		setLayout(mode: LayoutMode): void {
			layoutButtons.get(mode)?.click();
		},
		setResearchVisible(visible: boolean): void {
			const button = tabButtons.get("research");
			if (button) button.hidden = !visible;
			if (!visible && button?.getAttribute("aria-pressed") === "true") {
				for (const [key, item] of tabButtons) setPressed(item, key === "graph");
			}
		},
		setYears(min: number, max: number): void {
			stop();
			hasYears = true;
			minYear = min;
			maxYear = Math.max(min, max);
			range.min = String(minYear);
			range.max = String(maxYear);
			range.value = String(maxYear);
			readout.textContent = tr("全部年份", "All years");
			syncScrub();
		},
		clearYears(): void {
			stop();
			hasYears = false;
			readout.textContent = tr("全部年份", "All years");
			syncScrub();
		},
		setTab(next: GraphTab): void {
			for (const [key, item] of tabButtons) setPressed(item, key === next);
		},
		setExportText(text: string, showPreview = false): void {
			if (outputTimer) window.clearTimeout(outputTimer);
			outputTimer = 0;
			output.hidden = false;
			outputMessage.textContent = showPreview ? tr("剪贴板不可用，可手动复制以下内容。", "Clipboard unavailable. Copy the text below manually.") : text;
			outputPreview.hidden = !showPreview;
			outputPreview.textContent = showPreview ? text : "";
			if (!showPreview) outputTimer = window.setTimeout(clearOutputText, 3500);
		},
		async copyText(text: string, label: string): Promise<void> {
			try {
				await navigator.clipboard.writeText(text);
				this.setExportText(tr(`已复制${label}到剪贴板`, `Copied ${label} to clipboard`));
			} catch {
				this.setExportText(text, true);
			}
		},
		clearExportText(): void { clearOutputText(); },
		destroy(): void {
			stop();
			clearOutputText();
			releaseExportMenu();
			if (typeof document !== "undefined") document.removeEventListener("keydown", onExportKey);
			host.replaceChildren();
			host.classList.remove("cpo-tools");
			if (actions !== host) {
				actions.replaceChildren();
				actions.classList.remove("cpo-tools", "cpo-actions");
			}
			if (layoutHost) {
				layoutHost.replaceChildren();
				layoutHost.classList.remove("cpo-rail-layouts");
			}
			if (scrubHost) scrubHost.replaceChildren();
		},
	};
}

/** One-line paper strip. Starts collapsed; the body is about 160px when open.
   With `collapsible: false` the toggle strip is not rendered and the body is always visible. */
export function mountBottomSheet(host: HTMLElement, options?: { collapsible?: boolean }): BottomSheet {
	host.classList.add("cpo-sheet", "is-collapsed");
	host.replaceChildren();
	const body = createDiv();
	body.className = "cpo-sheet-body";
	if (options?.collapsible === false) {
		host.classList.remove("is-collapsed");
		host.append(body);
		return {
			body,
			setSummary(): void {},
			setExpanded(): void {},
			destroy(): void {
				host.replaceChildren();
				host.classList.remove("cpo-sheet", "is-collapsed");
			},
		};
	}
	const toggle = createEl("button");
	toggle.type = "button";
	toggle.className = "cpo-sheet-toggle";
	toggle.setAttribute("aria-expanded", "false");
	const title = createSpan();
	title.className = "cpo-sheet-title";
	title.textContent = tr("点选节点查看论文", "Select a node to view its paper");
	const langTag = createSpan();
	langTag.className = "cpo-tag cpo-sheet-tag";
	langTag.hidden = true;
	const meta = createSpan();
	meta.className = "cpo-sheet-meta";
	const chevron = createSpan();
	chevron.className = "cpo-sheet-chevron";
	chevron.textContent = tr("展开", "Expand");
	toggle.append(title, langTag, meta, chevron);
	host.append(toggle, body);

	const setExpanded = (open: boolean): void => {
		host.classList.toggle("is-collapsed", !open);
		toggle.setAttribute("aria-expanded", open ? "true" : "false");
		chevron.textContent = open ? tr("收起", "Collapse") : tr("展开", "Expand");
	};
	toggle.addEventListener("click", () => setExpanded(host.classList.contains("is-collapsed")));

	return {
		body,
		setSummary(nextTitle: string, nextMeta: string, tags?: { lang?: string | null }): void {
			title.textContent = nextTitle;
			meta.textContent = nextMeta;
			const lang = tags?.lang ?? null;
			langTag.hidden = !lang;
			if (lang) langTag.textContent = lang.toUpperCase();
		},
		setExpanded,
		destroy(): void {
			host.replaceChildren();
			host.classList.remove("cpo-sheet", "is-collapsed");
		},
	};
}

/** Menus own their document listeners, including in Obsidian popout windows. */
export function registerPopover(menu: HTMLDetailsElement): () => void {
	const doc = menu.ownerDocument;
	const outside = (event: PointerEvent): void => {
		if (menu.open && event.target && !menu.contains(event.target as Node)) menu.open = false;
	};
	const escape = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !menu.open) return;
		menu.open = false;
		menu.querySelector("summary")?.focus();
		event.preventDefault(); event.stopPropagation();
	};
	const onClick = (event: Event): void => {
		if ((event.target as Element | null)?.closest?.("button")) menu.open = false;
	};
	doc.addEventListener("pointerdown", outside);
	doc.addEventListener("keydown", escape, true);
	menu.addEventListener("click", onClick);
	return () => {
		doc.removeEventListener("pointerdown", outside);
		doc.removeEventListener("keydown", escape, true);
		menu.removeEventListener("click", onClick);
	};
}

function pressButton(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.className = "cpo-tool";
	button.textContent = label;
	setPressed(button, on);
	button.addEventListener("click", onClick);
	return button;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.className = "cpo-tool";
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function setPressed(button: HTMLButtonElement, on: boolean): void {
	button.classList.toggle("is-on", on);
	button.setAttribute("aria-pressed", on ? "true" : "false");
}
