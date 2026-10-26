import { tr } from "./i18n";
import { ReadingSaveError } from "./workflow/reading-state";
import { textMethodLabel, type SimilarityKind, type TextComparison } from "./paper-comparison";

export function paintComparisonCard(parent: HTMLElement, kind: SimilarityKind, value: number | undefined, comparison?: TextComparison): void {
	const card = el(parent, "section", "cpo-card cpo-comparison-card");
	const hint = kind === "text" ? textMethodLabel(comparison?.method ?? "unavailable")
		: tr("55% 共享参考文献 + 35% 共被引 + 10% 直接引用", "55% shared references + 35% co-citation + 10% direct citation");
	paintMeter(card, kind === "text" ? tr("文本相似度", "Text similarity") : tr("引用相似度", "Citation similarity"), value ?? null, hint);
	if (comparison && kind === "text") {
		el(card, "p", "cpo-fact-note", `SPECTER2: ${comparison.embedding?.toFixed(2) ?? tr("不可用", "Unavailable")} · ${tr("词语重合度", "Word overlap")}: ${comparison.lexical?.toFixed(2) ?? tr("不可用", "Unavailable")}`);
	}
}
import { edgeCitationPairs, evidenceLabel, SOURCE_TEXT, type CitationEvidence, type CrossCheckLike } from "./citation-evidence";
import type { RankedWork } from "./aggregates";
import { relationFacts } from "./graph-filter";
import { createChromeIcon, paintEvidenceBadges, paintPaperStateBadges } from "./graph-chrome";
import type { SelectionRank } from "./neighborhood";
import type { ProjectPaperState, ReadingStatus } from "./project-state";
import { nonResearchLabel } from "./paper";
import type { GraphEdge, Origin, PaperNode } from "./types";
import { formatCount } from "./visual";

/** Sidebar detail cards shared by the main pane and the note embed. */

export const ORIGIN_TEXT: Record<Origin, string> = {
	seed: tr("种子论文", "Seed paper"),
	reference: tr("种子的参考文献", "Seed references"),
	citation: tr("引用了种子", "Cites the seed"),
	related: tr("OpenAlex 相关作品", "OpenAlex related works"),
};

/** Cross-check fields the metadata card reads; both graphs carry this shape. */
export type DetailCrossCheck = CrossCheckLike & { s2Citations?: number | null };

export interface RelationSectionOptions {
	sources: string;
	getEvidence(citingId: string, citedId: string): CitationEvidence | null;
	seedScore?: number;
	/** 本地语义分（BM25+主题）；null 显示「不可用」，undefined 不渲染该 meter。 */
	semanticScore?: number | null;
	/** 语义 meter 的 hint；缺省为本地通道文案。 */
	semanticHint?: string;
}

/** Shown when a vault note already matches this paper's DOI or OpenAlex id. */
export function paintLiteratureLink(parent: HTMLElement, path: string, open: (path: string) => void, alternatives?: string[]): void {
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const actionRow = card.querySelector<HTMLElement>(":scope > .cpo-paper-actions");
	const note = el(card, "p", "cpo-fact-note");
	if (alternatives?.length) {
		note.textContent = tr("匹配到多份笔记，请选择：", "Multiple matching notes. Choose one: ");
		for (const file of alternatives) { const pick = el(note, "button", "cpo-text-btn", file); pick.type = "button"; pick.onclick = () => open(file); }
		if (actionRow) card.insertBefore(note, actionRow);
		return;
	}
	const button = el(note, "button", "cpo-text-btn", tr("打开笔记", "Open note"));
	button.type = "button";
	button.title = path;
	button.onclick = () => open(path);
	note.prepend(document.createTextNode(tr("已有笔记 · ", "In your notes · ")));
	if (actionRow) card.insertBefore(note, actionRow);
}

export function paintIdentitySources(parent: HTMLElement, paper: PaperNode, open: (url: string) => void, separate: () => void, conflict = false, acknowledge?: () => void): void {
	if (!paper.records?.length) return;
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const details = el(card, "details", "cpo-work-sources");
	el(details, "summary", "cpo-fact-note", tr(`已合并 ${paper.records.length} 条同作品记录 · 查看来源`, `${paper.records.length} records merged for this work · Sources`));
	el(details, "p", "cpo-fact-note", tr("依据：相同 DOI，或题名、作者、年份与完整期刊题录一致。被引数分别保留。", "Matched by DOI or identical title, authors, year, and journal details. Citation counts remain separate."));
	for (const record of paper.records) {
		const row = el(details, "p", "cpo-fact-note", `${record.id} · ${record.citedByCount} ${tr("次被引", "citations")} · `);
		if (record.doiUrl) { const link = el(row, "button", "cpo-text-btn", record.doiUrl.replace(/^https?:\/\/doi.org\//, "")); link.type = "button"; link.onclick = () => open(record.doiUrl!); }
	}
	if (conflict) {
		el(details, "p", "cpo-fact-note", tr("旧记录的阅读、暂存或排除状态不一致；已按各字段时间恢复，原值已保留。请核对当前状态。", "Legacy records have conflicting workflow states. The latest field values were restored and originals retained. Review the current state."));
		if (acknowledge) { const done = el(details, "button", "cpo-paper-action", tr("已核对状态", "States reviewed")); done.type = "button"; done.onclick = acknowledge; }
	}
	const button = el(details, "button", "cpo-paper-action", tr("保持这些记录分开", "Keep these records separate"));
	button.type = "button"; button.onclick = separate;
}

export function paintPaperWorkflowState(
	parent: HTMLElement, paper: PaperNode, state: ProjectPaperState,
	onReading: (reading: ReadingStatus, previous: ReadingStatus) => Promise<void> | void, onExclude?: () => Promise<void> | void,
): void {
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const row = el(card, "div", "cpo-paper-actions");
	const readingSelect = el(row, "select", "cpo-paper-reading-select");
	readingSelect.setAttribute("aria-label", tr(`阅读状态：${paper.title || paper.id}`, `Reading status: ${paper.title || paper.id}`));
	let currentReading = state.reading;
	const labels: Record<ReadingStatus, string> = { unread: tr("未读", "Unread"), "to-read": tr("待读", "To read"), read: tr("已读", "Read") };
	for (const reading of ["unread", "to-read", "read"] as const) {
		const option = createEl("option");
		option.value = reading;
		option.textContent = labels[reading];
		readingSelect.append(option);
	}
	readingSelect.value = currentReading;
	readingSelect.title = tr("阅读状态", "Reading status");
	const feedback = el(card, "p", "cpo-paper-action-error");
	feedback.setAttribute("role", "status");
	feedback.hidden = true;
	const retry = el(card, "button", "cpo-text-btn", tr("重试笔记同步", "Retry note sync"));
	retry.type = "button"; retry.hidden = true;
	retry.onclick = async () => {
		retry.disabled = readingSelect.disabled = true;
		try {
			await onReading(currentReading, currentReading);
			feedback.hidden = retry.hidden = true;
			readingSelect.title = tr("阅读状态", "Reading status");
		} catch (error) {
			if (error instanceof ReadingSaveError) currentReading = error.reading;
			readingSelect.value = currentReading;
			feedback.textContent = error instanceof Error ? error.message : tr("笔记同步失败，请重试", "Note sync failed. Try again.");
		} finally { retry.disabled = readingSelect.disabled = false; }
	};
	readingSelect.onchange = async () => {
		const next = readingSelect.value as ReadingStatus;
		if (next === currentReading) return;
		const previous = currentReading;
		readingSelect.disabled = true;
		feedback.hidden = true;
		retry.hidden = true;
		try {
			await onReading(next, previous);
			currentReading = next;
			readingSelect.title = tr("阅读状态", "Reading status");
		} catch (error) {
			if (error instanceof ReadingSaveError) currentReading = error.reading;
			retry.hidden = !(error instanceof ReadingSaveError && error.retrySync);
			readingSelect.value = currentReading;
			feedback.textContent = error instanceof Error ? error.message : tr("保存失败，请重试", "Could not save. Try again.");
			feedback.hidden = false;
			readingSelect.title = feedback.textContent;
		} finally {
			readingSelect.disabled = false;
		}
	};
	if (onExclude || paper.isSeed) {
		const exclude = el(row, "button", "cpo-paper-action cpo-paper-exclude", tr("排除", "Exclude"));
		exclude.type = "button";
		exclude.prepend(createChromeIcon("exclude"));
		exclude.disabled = paper.isSeed;
		exclude.title = paper.isSeed ? tr("种子论文不能排除", "The seed paper cannot be excluded") : tr("从当前项目排除", "Exclude from this project");
		if (onExclude) exclude.onclick = onExclude;
	}
}

/** 语义 meter 的 hint 文案：向量通道与本地通道分开标注。 */
export function semanticHintFor(mode?: "embedding" | "local"): string {
	return mode === "embedding" ? tr("SPECTER2 语义向量 + 主题", "SPECTER2 embeddings and topics") : tr("标题 / 摘要 / 主题，本地计算", "Title, abstract, and topics; computed locally");
}

/** Author line from the structured list; falls back to the joined string. */
export function paintAuthorChips(parent: HTMLElement, paper: PaperNode): void {
	const names = paper.authorList?.length ? paper.authorList : paper.authors ? [paper.authors] : [];
	if (names.length === 0) return;
	const row = el(parent, "div", "cpo-badge-row cpo-author-chips");
	const text = el(row, "span", "cpo-paper-authors", names.slice(0, 1).join(" · "));
	if (names.length > 1) {
		const more = el(row, "button", "cpo-chip cpo-chip-author cpo-author-more", `+${names.length - 1}`);
		more.type = "button";
		more.setAttribute("aria-expanded", "false");
		more.setAttribute("aria-label", tr(`显示其余 ${names.length - 1} 位作者`, `Show ${names.length - 1} more authors`));
		more.onclick = () => {
			const expanded = more.getAttribute("aria-expanded") !== "true";
			more.setAttribute("aria-expanded", String(expanded));
			text.textContent = (expanded ? names : names.slice(0, 1)).join(" · ");
			more.textContent = expanded ? tr("收起", "Collapse") : `+${names.length - 1}`;
			more.setAttribute("aria-label", expanded ? tr("收起其余作者", "Collapse other authors") : tr(`显示其余 ${names.length - 1} 位作者`, `Show ${names.length - 1} more authors`));
		};
	}
}

/** 出处行：期刊名/书名题录行，悬停显示全文。元数据卡与聚合卡共用。 */
export function paintVenueRow(parent: HTMLElement, paper: PaperNode): void {
	if (!paper.venue) return;
	const row = el(parent, "div", "cpo-badge-row cpo-venue-row");
	const venue = el(row, "span", "cpo-paper-venue", paper.venue);
	venue.title = paper.venue;
}

/** 聚合列表（先验/衍生）单条：与元数据卡同一体系的迷你卡，整条可点击。 */
export function paintAggregateCard(parent: HTMLElement, row: RankedWork, noun: string, onPick: (paper: PaperNode) => void, onActions?: (card: HTMLElement, paper: PaperNode) => void): void {
	const item = el(parent, "li", "cpo-agg-entry");
	const card = el(item, "div", "cpo-card cpo-agg-card");
	const badges = el(card, "div", "cpo-badge-row");
	el(badges, "span", "cpo-chip cpo-chip-accent", tr(`${noun} ${row.count} 次`, `${noun} ${row.count} times`));
	el(badges, "span", "cpo-chip", row.paper.year === null ? tr("年份不详", "Year unknown") : tr(`${row.paper.year} 年`, `${row.paper.year}`));
	el(badges, "span", "cpo-chip cpo-chip-muted", tr(`被引 ${formatCount(row.paper.citedByCount)}`, `Cited ${formatCount(row.paper.citedByCount)} times`));
	const heading = el(card, "h3", "cpo-card-title");
	const open = el(heading, "button", "cpo-agg-open", row.paper.title || row.paper.id);
	open.type = "button";
	open.setAttribute("aria-label", tr(`查看论文：${row.paper.title || row.paper.id}`, `View paper: ${row.paper.title || row.paper.id}`));
	paintAuthorChips(card, row.paper);
	paintVenueRow(card, row.paper);
	const run = () => onPick(row.paper);
	open.addEventListener("click", run);
	card.addEventListener("click", (event) => {
		if (!(event.target as HTMLElement).closest("button, select")) run();
	});
	onActions?.(card, row.paper);
}

/** 元数据卡：origin/年份/类型/被引徽章行 + 标题 + 作者 chips + 状态徽章与警告 + 主题 chips。 */
export function paintMetadataCard(parent: HTMLElement, paper: PaperNode, check: DetailCrossCheck | null | undefined): void {
	const card = el(parent, "section", "cpo-card cpo-paper-identity");
	el(card, "h3", "cpo-card-title", paper.title || paper.id);
	el(card, "p", "cpo-library-meta", [
		ORIGIN_TEXT[paper.origin],
		paper.year === null ? tr("年份不详", "Year unknown") : tr(`${paper.year} 年`, `${paper.year}`),
		tr(`被引 ${formatCount(paper.citedByCount)}`, `Cited ${formatCount(paper.citedByCount)} times`),
	].join(" · "));
	paintAuthorChips(card, paper);
	paintVenueRow(card, paper);
	paintPaperStateBadges(card, paper, check);
	if (paper.concepts.length > 0) {
		const topics = el(card, "div", "cpo-paper-topics");
		topics.setAttribute("aria-label", tr("论文主题", "Paper topics"));
		const count = paper.concepts.length;
		const idleLabel = tr(`+${count} 个标签`, `+${count} ${count === 1 ? "tag" : "tags"}`);
		const more = el(topics, "button", "cpo-paper-topic-more", idleLabel);
		more.type = "button";
		more.setAttribute("aria-expanded", "false");
		more.setAttribute("aria-label", tr(`显示 ${count} 个主题`, `Show ${count} ${count === 1 ? "topic" : "topics"}`));
		more.onclick = () => {
			const expanded = more.getAttribute("aria-expanded") !== "true";
			more.setAttribute("aria-expanded", String(expanded));
			if (expanded) {
				for (const name of paper.concepts) {
					const chip = createSpan();
					chip.className = "cpo-paper-topic cpo-paper-topic-extra";
					chip.textContent = name;
					more.before(chip);
				}
				more.textContent = tr("收起", "Collapse");
			} else {
				topics.querySelectorAll(".cpo-paper-topic-extra").forEach((chip) => chip.remove());
				more.textContent = idleLabel;
			}
		};
	}
	if (paper.retracted) {
		el(card, "p", "cpo-side-tip", tr("⚠ OpenAlex 将这篇作品标记为已撤稿（is_retracted）。引用它之前请先核实撤稿原因。", "⚠ OpenAlex marks this work as retracted (is_retracted). Check the reason before citing it."));
	}
	const flagged = nonResearchLabel(paper);
	if (flagged) {
		el(card, "p", "cpo-side-tip", tr(`OpenAlex 将这条记录标记为「${flagged}」。书评的题名里嵌着原书信息，指向它的引用往往属于原书，作者字段以实际书评作者为准——这是 OpenAlex 的数据特点，不是本插件的映射。`, `OpenAlex marks this record as “${flagged}”. Book review titles may include the original book; citations to the review may belong to the book. The author field reflects the review author. This is a property of the OpenAlex data, not the plugin mapping.`));
	}
	if (check?.mismatched) {
		const s2 = check.s2Citations === null || check.s2Citations === undefined ? tr("无记录", "No record") : formatCount(check.s2Citations);
		el(card, "p", "cpo-side-tip", tr(`⚠ 数据源差异悬殊：OpenAlex 被引 ${formatCount(paper.citedByCount)}，Semantic Scholar 被引 ${s2}。差异这么大通常是记录错配（例如书评继承了原书的引用），引用前请经 DOI 链接核实。`, `⚠ Large source discrepancy: OpenAlex reports ${formatCount(paper.citedByCount)} citations; Semantic Scholar reports ${s2}. This often indicates a record mismatch, such as a review inheriting the book’s citations. Verify through the DOI before citing.`));
	}
}

/** One labeled similarity meter; null renders the unavailable empty state. */
export function paintMeter(parent: HTMLElement, label: string, value: number | null, hint: string, alt = false): void {
	const meter = el(parent, "div", "cpo-meter");
	meter.title = hint;
	const head = el(meter, "div", "cpo-meter-head");
	el(head, "span", "cpo-meter-label", label);
	if (value === null) {
		el(head, "span", "cpo-meter-na", tr("不可用", "Unavailable"));
		el(meter, "p", "cpo-meter-hint", tr("当前缺少可比较数据", "No comparable data is available"));
		return;
	}
	meter.classList.add("cpo-meter-valued");
	el(head, "span", "cpo-meter-value", value.toFixed(2));
	const track = el(meter, "div", "cpo-meter-track");
	const fill = el(track, "div", alt ? "cpo-meter-fill cpo-meter-fill-alt" : "cpo-meter-fill");
	fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
	el(meter, "p", "cpo-meter-hint", hint);
}

function paintStat(parent: HTMLElement, label: string, value: string): void {
	const cell = el(parent, "div", "cpo-stat");
	el(cell, "span", "cpo-stat-label", label);
	el(cell, "span", "cpo-stat-value", value);
}

/** 关系证据卡：导语 + 相似度条 + 统计格 + 证据徽章/上下文 + 注意事项。节点与边视图共用。 */
export function paintRelationSection(parent: HTMLElement, edge: GraphEdge, a: PaperNode, b: PaperNode, options: RelationSectionOptions): void {
	const card = el(parent, "section", "cpo-card");
	const info = relationFacts(edge, a, b, options.sources);
	el(card, "p", "cpo-fact-lead", info.lead);
	if (options.seedScore !== undefined) paintMeter(card, tr("图谱候选选择分", "Graph selection score"), options.seedScore, tr("用于候选选择的结构和文本/主题信号", "Structure and text/topic signals used for candidate selection"));
	if (edge.structuralSimilarity !== undefined) {
		paintMeter(card, tr("文献结构相似度", "Structural similarity"), edge.structuralSimilarity, tr("共享参考文献 / 共被引", "Shared references / co-citations"), true);
	}
	if (options.semanticScore !== undefined) {
		paintMeter(card, tr("文本/主题信号", "Text/topic signal"), options.semanticScore, options.semanticHint ?? tr("标题 / 摘要 / 主题，本地计算", "Title, abstract, and topics; computed locally"), true);
	}
	const grid = el(card, "div", "cpo-stat-grid");
	paintStat(grid, tr("共享参考文献", "Shared references"), tr(`${edge.sharedRefs} 篇`, `${edge.sharedRefs} papers`));
	paintStat(grid, tr("共被引", "Co-citations"), tr(`${edge.coCitedBy} 次`, `${edge.coCitedBy} times`));
	paintStat(grid, tr("来源", "Source"), options.sources);
	for (const pair of edgeCitationPairs(edge)) {
		const evidence = options.getEvidence(pair.citingId, pair.citedId);
		paintEvidenceBadges(card, evidence);
		if (evidence) {
			el(card, "p", "cpo-evidence", tr(`证据：${evidenceLabel(evidence)}`, `Evidence: ${evidenceLabel(evidence)}`));
			for (const context of evidence.contexts.slice(0, 5)) el(card, "blockquote", "cpo-side-tip", context);
		}
	}
	for (const caveat of info.caveats) el(card, "p", "cpo-fact-note", caveat);
}

/** 摘要卡：标题行 + 复制 + 四行折叠/展开；加载/缺失/来源标注文案来自 abstractText。 */
export function paintAbstractCard(parent: HTMLElement, paper: PaperNode, abstractText: (paper: PaperNode) => string): void {
	const card = el(parent, "section", "cpo-card");
	const head = el(card, "div", "cpo-card-head");
	el(head, "h3", "cpo-kicker", tr("摘要", "Abstract"));
	const wrap = el(card, "div", "cpo-abstract-wrap");
	const para = el(wrap, "p", "cpo-abstract", abstractText(paper));
	if (!paper.abstract) return;
	para.classList.add("cpo-abstract-clamp");
	const fade = el(wrap, "div", "cpo-abstract-fade");
	const copy = el(head, "button", "cpo-text-btn", tr("复制", "Copy"));
	copy.type = "button";
	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(paper.abstract).then(() => {
			copy.textContent = tr("已复制", "Copied");
			window.setTimeout(() => { copy.textContent = tr("复制", "Copy"); }, 1600);
		}, () => undefined);
	});
	const toggle = el(card, "button", "cpo-text-btn cpo-abstract-toggle", tr("展开全文", "Show full abstract"));
	toggle.type = "button";
	toggle.addEventListener("click", () => {
		const collapsed = para.classList.toggle("cpo-abstract-clamp");
		fade.hidden = !collapsed;
		toggle.textContent = collapsed ? tr("展开全文", "Show full abstract") : tr("收起摘要", "Collapse abstract");
	});
}

/** 对方论文跳转条：compact 信息 + 「查看」。 */
export function paintJumpStrip(parent: HTMLElement, paper: PaperNode, onJump: (paper: PaperNode) => void): void {
	const strip = el(parent, "section", "cpo-jump-strip");
	const info = el(strip, "div", "cpo-jump-info");
	const head = el(info, "div", "cpo-badge-row");
	el(head, "span", "cpo-chip cpo-chip-accent", ORIGIN_TEXT[paper.origin]);
	el(head, "span", "cpo-chip cpo-chip-muted", tr(`${paper.year ?? tr("年份不详", "Year unknown")} · 被引 ${formatCount(paper.citedByCount)}`, `${paper.year ?? tr("年份不详", "Year unknown")} · cited ${formatCount(paper.citedByCount)} times`));
	el(info, "p", "cpo-jump-title", paper.title || paper.id);
	el(info, "p", "cpo-jump-meta", paper.authors);
	const go = el(strip, "button", "cpo-text-btn", tr("查看 →", "View →"));
	go.type = "button";
	go.addEventListener("click", () => onJump(paper));
}

/** Distinct evidence sources behind an edge's directed citation pairs. */
export function edgeSourcesText(edge: GraphEdge, getEvidence: (citingId: string, citedId: string) => CitationEvidence | null): string {
	const sources = new Set(edgeCitationPairs(edge).flatMap((pair) => getEvidence(pair.citingId, pair.citedId)?.sources ?? []));
	return sources.size ? [...sources].map((source) => SOURCE_TEXT[source]).join(" + ") : tr("OpenAlex 采样", "OpenAlex sample");
}

/** 「入选原因」折叠区：候选选择时的真实分数快照（仅 picked 节点有）。 */
export function paintSelectionReasons(parent: HTMLElement, rank: SelectionRank, currentScore?: number): void {
	const details = createEl("details");
	details.className = "cpo-card cpo-why";
	const summary = createEl("summary");
	summary.textContent = tr("入选原因", "Why selected");
	details.append(summary);
	paintMeter(details, tr("权威分", "Authority score"), rank.authority, tr("log 被引 × 新近度，候选池内归一", "Log citations × recency, normalized within the candidate pool"), true);
	paintMeter(details, tr("选择时语义分", "Semantic score at selection"), rank.semantic, tr("标题 / 主题，本地计算（选择时摘要尚未补取）", "Title and topics, computed locally (abstract not yet fetched at selection)"), true);
	paintMeter(details, tr("选择时相关性", "Relevance at selection"), rank.relevance, tr("0.5×权威 + 0.5×选择时语义；语义缺失时等于权威分；撤稿作品进一步降权", "0.5 × authority + 0.5 × selection-time semantics; uses authority if semantics are unavailable; retracted works are penalized further"), true);
	if (currentScore !== undefined) {
		paintMeter(details, tr("建图后当前综合分", "Current overall score"), currentScore, tr("结构 + 语义信号；未参与候选入选", "Structure and semantic signals; not used for candidate selection"));
	}
	el(details, "p", "cpo-fact-note", tr("入选还受来源配额与多样性（MMR）影响。", "Selection also depends on source quotas and diversity (MMR)."));
	parent.append(details);
}

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = createEl(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
