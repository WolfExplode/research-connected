import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";

export interface GraphSurface {
	announceSelection(label: string): void;
	apiStatus: { read: () => readonly string[]; refresh: () => void };
	stage: HTMLDivElement;
	canvas: HTMLCanvasElement;
	empty: HTMLDivElement;
	emptyTitle: HTMLHeadingElement;
	messageText: HTMLParagraphElement;
	tooltip: HTMLDivElement;
	nodeMenu: HTMLDivElement;
	deleteItem: HTMLButtonElement;
	expandItem: HTMLButtonElement;
	seedItem: HTMLButtonElement;
	zoom: HTMLDivElement;
	zoomIn: HTMLButtonElement;
	zoomOut: HTMLButtonElement;
	fit: HTMLButtonElement;
	reload: HTMLButtonElement;
	graphOptions: HTMLButtonElement;
	diversifyResults: HTMLInputElement;
	diversityHint: HTMLParagraphElement;
	distanceScale: HTMLSelectElement;
	showAllConnections: HTMLInputElement;
}

export function placeNodeMenu(stage: HTMLElement, menu: HTMLElement, x: number, y: number): void {
	const rect = stage.getBoundingClientRect();
	const pad = 8;
	menu.style.left = `${Math.min(Math.max(pad, x - rect.left), Math.max(pad, rect.width - menu.offsetWidth - pad))}px`;
	menu.style.top = `${Math.min(Math.max(pad, y - rect.top), Math.max(pad, rect.height - menu.offsetHeight - pad))}px`;
}

/** Shared graph canvas shell; graph pane and note embeds supply only their host-specific content/actions. */
export function mountGraphSurface(parent: HTMLElement, options: { canvasLabel: string; title: string; hint: string; mutations?: boolean }): GraphSurface {
	const stage = createDiv();
	stage.className = "cpo-stage";
	const canvas = createEl("canvas");
	// Obsidian turns aria-label into a hover tooltip; name the canvas without it.
	const canvasDescription = createSpan();
	canvasDescription.id = `cpo-canvas-label-${Math.random().toString(36).slice(2)}`;
	canvasDescription.hidden = true;
	canvasDescription.textContent = options.canvasLabel;
	canvas.setAttribute("aria-labelledby", canvasDescription.id);
	const canvasHelp = createSpan(); canvasHelp.id = `${canvasDescription.id}-help`; canvasHelp.hidden = true;
	canvasHelp.textContent = tr("方向键平移；Shift 加方向键选择论文；Enter 打开详情；加减号缩放；F 适配；Escape 清除选择。", "Arrow keys pan; Shift+Arrow selects a paper; Enter opens details; +/- zoom; F fits; Escape clears selection.");
	canvas.setAttribute("aria-describedby", canvasHelp.id);
	const selectionStatus = createSpan(); selectionStatus.className = "cpo-sr-only";
	selectionStatus.setAttribute("role", "status");
	const empty = createDiv();
	empty.className = "cpo-empty";
	const emptyTitle = createEl("h2");
	emptyTitle.className = "cpo-empty-title";
	emptyTitle.textContent = options.title;
	if (!options.title) emptyTitle.hidden = true;
	const messageText = createEl("p");
	messageText.textContent = options.hint;
	empty.append(emptyTitle, messageText);
	const tooltip = createDiv();
	tooltip.className = "cpo-tooltip";
	tooltip.hidden = true;
	const nodeMenu = createDiv();
	nodeMenu.className = "cpo-node-menu";
	nodeMenu.hidden = true;
	nodeMenu.setAttribute("role", "menu");
	const deleteItem = menuButton(tr("排除", "Exclude"));
	deleteItem.classList.add("is-danger");
	const expandItem = menuButton(tr("深挖", "Deep dive"));
	const seedItem = menuButton(tr("设为种子", "Set as seed"));
	if (options.mutations === false) nodeMenu.append(seedItem);
	else {
		const dangerSep = createSpan();
		dangerSep.className = "cpo-node-menu-sep";
		dangerSep.setAttribute("role", "separator");
		nodeMenu.append(expandItem, seedItem, dangerSep, deleteItem);
	}
	const zoom = createDiv();
	zoom.className = "cpo-zoom";
	const zoomIn = iconButton("+", tr("放大", "Zoom in"));
	const zoomOut = iconButton("−", tr("缩小", "Zoom out"));
	const fit = iconButton("", tr("适应窗口", "Fit to view"));
	fit.append(createChromeIcon("fit"));
	const reload = iconButton("", tr("重新加载", "Reload"));
	reload.disabled = true;
	reload.append(createChromeIcon("refresh"));
	const info = iconButton("ⓘ", tr("图谱说明", "About this graph"));
	info.setAttribute("aria-expanded", "false");
	const guide = createDiv();
	guide.className = "cpo-graph-guide";
	guide.id = `cpo-graph-guide-${Math.random().toString(36).slice(2)}`;
	guide.hidden = true;
	guide.setAttribute("role", "region");
	info.setAttribute("aria-controls", guide.id);
	const heading = createEl("strong");
	heading.textContent = tr("如何阅读图谱", "How to read this graph");
	heading.id = `${guide.id}-heading`;
	guide.setAttribute("aria-labelledby", heading.id);
	guide.append(heading);
	const legend = createEl("dl"); legend.className = "cpo-guide-legend";
	for (const [symbol, description] of [
		["H", tr("本地副本", "Local copy")],
		["N", tr("仅有笔记", "Note only")],
		["?", tr("匹配不明确", "Ambiguous match")],
		["O", tr("开放获取链接", "Open-access link")],
		["S", tr("Sci-Hub 链接", "Sci-Hub link")],
	]) {
		const term = createEl("dt"); term.textContent = symbol!;
		const detail = createEl("dd"); detail.textContent = description!;
		legend.append(term, detail);
	}
	guide.append(legend);
	const explanations = [
		tr("链接不代表已下载；无徽标表示本地状态未知。", "Links do not mean downloaded; no badge means local status unknown."),
		tr("大小：每年被引次数，不代表质量。颜色：引用团、年份或主题。", "Size: citations per year, not quality. Color: community, year or topic."),
		tr("平面：邻近表示关联。相似度：越近越相似。时间：横轴年份，纵轴引用次数（对数）。", "Planar: nearby papers are related. Similarity: closer means more similar. Timeline: year × log citations."),
	];
	for (const text of explanations) {
		const paragraph = createEl("p");
		paragraph.textContent = text;
		guide.append(paragraph);
	}
	const statusArea = createDiv();
	statusArea.className = "cpo-api-status";
	statusArea.setAttribute("role", "status");
	const apiStatus = {
		read: (): readonly string[] => [],
		refresh: (): void => {
			statusArea.replaceChildren();
			const messages = [...new Set(apiStatus.read())];
			const title = createEl("strong"); title.textContent = tr("API 状态", "API status"); statusArea.append(title);
			for (const message of messages.length ? messages : [tr("当前没有报告请求受限或未完成。", "No rate limits or incomplete calls currently reported.")]) {
				const line = createEl("p"); line.textContent = message; statusArea.append(line);
			}
		},
	};
	guide.append(statusArea);
	guide.tabIndex = -1;
	const setGuideOpen = (open: boolean) => {
		guide.hidden = !open;
		info.setAttribute("aria-expanded", String(open));
		if (open) { apiStatus.refresh(); guide.focus(); }
		else info.focus();
	};
	info.addEventListener("click", () => setGuideOpen(guide.hidden));
	guide.addEventListener("keydown", event => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		setGuideOpen(false);
	});
	const graphOptions = iconButton("☷", tr("图谱选项", "Graph options"));
	const optionsLabel = createSpan();
	optionsLabel.id = `cpo-options-label-${Math.random().toString(36).slice(2)}`;
	optionsLabel.hidden = true;
	optionsLabel.textContent = tr("图谱选项", "Graph options");
	graphOptions.removeAttribute("aria-label");
	graphOptions.setAttribute("aria-labelledby", optionsLabel.id);
	graphOptions.classList.add("cpo-graph-options-button");
	graphOptions.setAttribute("aria-expanded", "false");
	const optionsPanel = createDiv();
	optionsPanel.className = "cpo-graph-options";
	optionsPanel.id = `cpo-graph-options-${Math.random().toString(36).slice(2)}`;
	optionsPanel.hidden = true;
	optionsPanel.setAttribute("role", "region");
	optionsPanel.setAttribute("aria-labelledby", optionsLabel.id);
	graphOptions.setAttribute("aria-controls", optionsPanel.id);
	const optionsHeading = createEl("strong");
	optionsHeading.textContent = tr("图谱选项", "Graph options");
	const diversityRow = createEl("label");
	diversityRow.className = "cpo-graph-option cpo-diversity-option";
	const diversifyResults = createEl("input");
	diversifyResults.type = "checkbox";
	diversifyResults.className = "cpo-diversify-results";
	diversifyResults.checked = true;
	const diversityLabel = createSpan();
	diversityLabel.textContent = tr("结果多样化", "Diversify results");
	diversityRow.append(diversifyResults, diversityLabel);
	const diversityHint = createEl("p");
	diversityHint.id = `${optionsPanel.id}-hint`;
	diversityHint.hidden = true;
	diversityHint.textContent = tr("减少重复候选，为不同论文留出空间。关闭后移除多样性惩罚。更改后重新构建引用图谱。", "Make room for different papers by reducing redundant candidates. Turn off to remove the diversity penalty. Changes rebuild the citation graph.");
	diversifyResults.setAttribute("aria-describedby", diversityHint.id);
	diversityRow.title = diversityHint.textContent;
	const distanceRow = createEl("label"); distanceRow.className = "cpo-graph-option cpo-distance-option";
	distanceRow.textContent = tr("距离刻度", "Distance scale");
	const distanceScale = createEl("select"); distanceScale.setAttribute("aria-label", "Distance scale");
	for (const [value, text] of [["relative", tr("相对", "Relative")], ["absolute", tr("绝对", "Absolute")]]) {
		const option = createEl("option"); option.value = value!; option.textContent = text!; distanceScale.append(option);
	}
	distanceRow.append(distanceScale);
	distanceScale.value = "relative";
	const distanceHint = createEl("p");
	distanceHint.id = `${optionsPanel.id}-distance-hint`;
	distanceHint.hidden = true;
	distanceHint.textContent = tr("相对：展开当前论文之间的分数差异。绝对：使用固定的 0–1 刻度。仅改变相似度视图的间距，实际分数不变。", "Relative spreads the current papers across the rings. Absolute uses a fixed 0–1 scale. Only Similarity spacing changes; actual scores stay unchanged.");
	distanceRow.title = distanceHint.textContent;
	distanceScale.title = distanceHint.textContent;
	distanceScale.setAttribute("aria-describedby", distanceHint.id);
	const setOptionsOpen = (open: boolean): void => {
		optionsPanel.hidden = !open;
		graphOptions.setAttribute("aria-expanded", String(open));
		if (open) {
			guide.hidden = true; info.setAttribute("aria-expanded", "false");
			if (distanceRow.getClientRects().length) distanceScale.focus();
			else diversifyResults.focus();
		} else graphOptions.focus();
	};
	graphOptions.addEventListener("click", () => setOptionsOpen(optionsPanel.hidden));
	info.addEventListener("click", () => { optionsPanel.hidden = true; graphOptions.setAttribute("aria-expanded", "false"); });
	optionsPanel.addEventListener("keydown", event => {
		if (event.key !== "Escape") return;
		event.preventDefault(); event.stopPropagation(); setOptionsOpen(false);
	});
	const connectionsRow = createEl("label"); connectionsRow.className = "cpo-graph-option cpo-citation-connections-option";
	const showAllConnections = createEl("input"); showAllConnections.type = "checkbox";
	const connectionsLabel = createSpan(); connectionsLabel.textContent = tr("显示所有连接", "Show all connections");
	connectionsRow.append(showAllConnections, connectionsLabel);
	optionsPanel.append(optionsHeading, diversityRow, diversityHint, distanceRow, distanceHint, connectionsRow);
	zoom.append(zoomIn, zoomOut, fit, reload, graphOptions, info);
	stage.append(canvasDescription, canvasHelp, selectionStatus, optionsLabel, canvas, empty, tooltip, nodeMenu, zoom, guide, optionsPanel);
	parent.append(stage);
	return { announceSelection: label => { selectionStatus.textContent = label; }, apiStatus, stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, zoom, zoomIn, zoomOut, fit, reload, graphOptions, diversifyResults, diversityHint, distanceScale, showAllConnections };
}

function menuButton(label: string): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.setAttribute("role", "menuitem");
	button.textContent = label;
	return button;
}

function iconButton(label: string, aria: string): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.className = "cpo-icon";
	button.textContent = label;
	// Obsidian renders aria-label as a hover popup. A referenced hidden label
	// preserves the accessible name without creating a second visual label.
	const accessibleLabel = createSpan();
	accessibleLabel.id = `cpo-control-label-${Math.random().toString(36).slice(2)}`;
	accessibleLabel.hidden = true;
	accessibleLabel.textContent = aria;
	button.append(accessibleLabel);
	button.setAttribute("aria-labelledby", accessibleLabel.id);
	return button;
}
