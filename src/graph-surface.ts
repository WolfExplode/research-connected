import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";

export interface GraphSurface {
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
	fit.title = tr("适应窗口", "Fit to view");
	fit.append(createChromeIcon("fit"));
	const reload = iconButton("", tr("重新加载", "Reload"));
	reload.title = tr("重新加载", "Reload");
	reload.disabled = true;
	reload.append(createChromeIcon("refresh"));
	const info = iconButton("ⓘ", tr("图谱说明", "About this graph"));
	info.title = tr("图谱说明", "About this graph");
	info.setAttribute("aria-expanded", "false");
	const guide = createDiv();
	guide.className = "cpo-graph-guide";
	guide.id = `cpo-graph-guide-${Math.random().toString(36).slice(2)}`;
	guide.hidden = true;
	guide.setAttribute("role", "region");
	guide.setAttribute("aria-label", tr("图谱说明", "About this graph"));
	info.setAttribute("aria-controls", guide.id);
	const heading = createEl("strong");
	heading.textContent = tr("如何阅读图谱", "How to read this graph");
	guide.append(heading);
	const explanations = [
		tr("绿色 O / 蓝色 S：来源报告有开放获取或 Sci-Hub 链接，并不表示已下载或验证全文。", "Green O / blue S: an open-access or Sci-Hub link is reported by the provider; the full text has not necessarily been downloaded or verified."),
		tr("本地馆藏：H 表示本地已有副本，N 表示仅有笔记，? 表示匹配不明确。未记录本地副本时不显示徽标；这不代表没有全文。", "Local library: H means a local copy, N means a note only, and ? means an ambiguous match. No badge is shown when no local copy is recorded; this does not mean full text is unavailable."),
		tr("圆圈大小：按论文年龄归一化的引用次数，较大表示每年被引更多；种子论文有最小突出尺寸。大小不代表研究质量。", "Circle size: citations normalized by paper age; larger circles have more citations per year. The seed has a minimum prominent size. Size does not measure study quality."),
		tr("颜色：取决于所选模式。引用团模式中相同颜色表示同一组；年份模式表示发表年份；主题模式表示与种子的主题相似度；图谱模式使用主题配色。", "Color depends on the selected mode: Community groups papers by their citation network; Year shows publication year; Topic shows topic similarity to the seed; Graph uses theme colors."),
		tr("距离：平面布局中，同组和联系较强的论文通常更近，但距离不是精确分数。相似度视图中，越靠近比较中心表示越相似；拖动仅改变角度，不改变距离或分数。分数不是概率。时间布局中，横轴为年份，纵轴为对数引用次数。", "Distance: in Planar view, papers in the same group or with stronger links tend to be closer, but spacing is not an exact score. In Similarity view, closer to the comparison paper means more similar. Dragging changes only the angle, never the distance or score. Scores are not probabilities. Timeline uses publication year horizontally and logarithmic citation counts vertically."),
	];
	for (const text of explanations) {
		const paragraph = createEl("p");
		paragraph.textContent = text;
		guide.append(paragraph);
	}
	const close = iconButton(tr("关闭", "Close"), tr("关闭图谱说明", "Close graph guide"));
	guide.append(close);
	const setGuideOpen = (open: boolean) => {
		guide.hidden = !open;
		info.setAttribute("aria-expanded", String(open));
		if (open) close.focus();
		else info.focus();
	};
	info.addEventListener("click", () => setGuideOpen(guide.hidden));
	close.addEventListener("click", () => setGuideOpen(false));
	guide.addEventListener("keydown", event => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		setGuideOpen(false);
	});
	zoom.append(zoomIn, zoomOut, fit, reload, info);
	stage.append(canvasDescription, canvas, empty, tooltip, nodeMenu, zoom, guide);
	parent.append(stage);
	return { stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, zoom, zoomIn, zoomOut, fit, reload };
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
	button.setAttribute("aria-label", aria);
	return button;
}
