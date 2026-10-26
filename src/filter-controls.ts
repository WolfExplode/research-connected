import { setHoverHint } from "./hover-hint";
import { tr } from "./i18n";
import { classicNodeIds } from "./aggregates";
import { communityColor, detectCommunities } from "./communities";
import type { GraphFilter } from "./graph-filter";
import type { LayoutMode } from "./layout-modes";
import { RELATION_LABEL, relationKind } from "./relation";
import type { GraphEdge } from "./types";

const KIND_ORDER = ["direct", "cocitation", "coupling"] as const;

export function graphKeyStats(
	nodes: readonly { id: string; year: number | null; isSeed?: boolean }[],
	edges: readonly GraphEdge[],
): { kinds: Record<(typeof KIND_ORDER)[number], number>; classics: number; seeds: number; groups: number } {
	const kinds = { direct: 0, cocitation: 0, coupling: 0 };
	for (const edge of edges) {
		const kind = relationKind(edge);
		if (kind === "direct" || kind === "cocitation" || kind === "coupling") kinds[kind] += 1;
	}
	return {
		kinds,
		classics: classicNodeIds(nodes, edges).size,
		seeds: nodes.reduce((n, node) => n + (node.isSeed ? 1 : 0), 0),
		groups: new Set(detectCommunities(nodes.map((node) => node.id), edges).values()).size,
	};
}

export function buildLegend(
	legend: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): Map<(typeof KIND_ORDER)[number], HTMLElement> {
	const counts = new Map<(typeof KIND_ORDER)[number], HTMLElement>();
	for (const kind of KIND_ORDER) {
		const button = createEl("button");
		button.type = "button";
		const on = read().kinds[kind];
		button.className = on ? "cpo-legend-kind is-on" : "cpo-legend-kind";
		button.setAttribute("aria-pressed", on ? "true" : "false");
		setHoverHint(button, RELATION_LABEL[kind]);
		const swatch = createEl("i");
		swatch.dataset.kind = kind;
		const n = createSpan();
		n.className = "cpo-graph-key-n";
		n.textContent = "0";
		button.append(swatch, document.createTextNode(RELATION_LABEL[kind]), n);
		button.addEventListener("click", () => {
			const current = read();
			const on = !current.kinds[kind];
			button.classList.toggle("is-on", on);
			button.setAttribute("aria-pressed", on ? "true" : "false");
			write({ ...current, kinds: { ...current.kinds, [kind]: on } });
		});
		legend.append(button);
		counts.set(kind, n);
	}
	return counts;
}

function markRow(className: string, label: string, interactive = false): { row: HTMLElement; n: HTMLSpanElement } {
	const row = interactive ? createEl("button") : createSpan();
	if (row.instanceOf(HTMLButtonElement)) row.type = "button";
	row.className = className;
	const swatch = createEl("i");
	swatch.setAttribute("aria-hidden", "true");
	const n = createSpan();
	n.className = "cpo-graph-key-n";
	n.textContent = "0";
	row.append(swatch, document.createTextNode(label), n);
	return { row, n };
}

/** Edge-type chips, seed/classic marks, grouping color — in the left rail. */
export function mountGraphKey(
	host: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
	onSeedSelect?: () => void,
): {
	paintColor: (mode: LayoutMode) => void;
	setStats: (nodes: readonly { id: string; year: number | null; isSeed?: boolean }[], edges: readonly GraphEdge[]) => void;
	setKinds: (selected: GraphFilter["kinds"]) => void;
	setVisibleConnections: (edges: readonly GraphEdge[] | null) => void;
} {
	const key = createDiv();
	key.className = "cpo-graph-key";
	const kinds = createDiv();
	kinds.className = "cpo-graph-key-kinds";
	const kindCounts = buildLegend(kinds, read, write);
	let visibleConnections: readonly GraphEdge[] | null = null;
	let graphEdges: readonly GraphEdge[] = [];
	const paintConnectionCounts = (): void => {
		const counts = { direct: 0, cocitation: 0, coupling: 0 };
		for (const edge of visibleConnections ?? graphEdges) {
			const kind = relationKind(edge);
			if (kind === "direct" || kind === "cocitation" || kind === "coupling") counts[kind]++;
		}
		for (const kind of KIND_ORDER) {
			const el = kindCounts.get(kind), text = String(counts[kind]);
			if (el && el.textContent !== text) el.textContent = text;
		}
	};
	const marks = createDiv();
	marks.className = "cpo-graph-key-marks";
	const seed = markRow("cpo-graph-key-seed", tr("种子文献", "Seed paper"), Boolean(onSeedSelect));
	if (seed.row.instanceOf(HTMLButtonElement) && onSeedSelect) {
		seed.row.disabled = true;
		seed.row.setAttribute("aria-label", tr("选择种子文献", "Select seed paper"));
		setHoverHint(seed.row, tr("选择种子文献", "Select seed paper"));
		seed.row.addEventListener("click", onSeedSelect);
	}
	const classic = markRow("cpo-graph-key-classic", tr("经典文献", "Seminal papers"));
	marks.append(seed.row, classic.row);
	const color = createSpan();
	color.className = "cpo-graph-key-color";
	const dots = createSpan();
	dots.className = "cpo-graph-key-dots";
	dots.setAttribute("aria-hidden", "true");
	for (let i = 0; i < 3; i++) {
		const dot = createEl("i");
		dot.style.background = communityColor(i);
		dots.append(dot);
	}
	const label = createSpan();
	label.textContent = tr("引用团", "Citation clusters");
	const groupN = createSpan();
	groupN.className = "cpo-graph-key-n";
	groupN.textContent = "0";
	color.append(dots, label, groupN);
	key.append(kinds, marks, color);
	host.append(key);
	const paintColor = (mode: LayoutMode): void => {
		color.hidden = mode !== "force2d";
	};
	const setStats = (
		nodes: readonly { id: string; year: number | null; isSeed?: boolean }[],
		edges: readonly GraphEdge[],
	): void => {
		const stats = graphKeyStats(nodes, edges);
		graphEdges = edges;
		paintConnectionCounts();
		seed.n.textContent = String(stats.seeds);
		if (seed.row.instanceOf(HTMLButtonElement)) seed.row.disabled = stats.seeds === 0;
		classic.n.textContent = String(stats.classics);
		groupN.textContent = String(stats.groups);
	};
	const setKinds = (selected: GraphFilter["kinds"]): void => {
		for (const kind of KIND_ORDER) {
			const button = Array.from(kinds.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === RELATION_LABEL[kind]);
			if (!button) continue;
			button.classList.toggle("is-on", selected[kind]);
			button.setAttribute("aria-pressed", String(selected[kind]));
		}
	};
	return { paintColor, setStats, setKinds, setVisibleConnections: edges => {
		visibleConnections = edges;
		paintConnectionCounts();
	} };
}
