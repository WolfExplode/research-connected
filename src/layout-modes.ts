import { tr } from "./i18n";
import { detectCommunities } from "./communities";
import { runForceLayout, type ForceNode } from "./layout";
import type { GraphEdge, PaperNode } from "./types";
import { citationRadius, yearNormalizedCitations } from "./visual";

/** `temporal` is the note-embed default: year on X, log citations on Y. */
export type LayoutMode = "force2d" | "temporal" | "radial";

export type ColorMode = "year" | "community" | "graph" | "topic";
export type DistanceScale = "relative" | "absolute";

/** Display-only normalization. Raw scores and candidate ranking never change. */
export function radialDistanceScores(nodes: readonly PaperNode[], scores: ReadonlyMap<string, number>, scale: DistanceScale): Map<string, number> {
	const result = new Map(scores);
	if (scale === "absolute") return result;
	const values = nodes.filter(node => !node.isSeed).map(node => scores.get(node.id))
		.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (!values.length) return result;
	const min = Math.min(...values), max = Math.max(...values);
	for (const node of nodes) {
		const value = scores.get(node.id);
		if (node.isSeed || value === undefined || !Number.isFinite(value)) continue;
		// Equal scores stay on one orbit; zero-only results stay at the outer boundary.
		result.set(node.id, max - min < 1e-12 ? max <= 0 ? 0 : 0.5 : (value - min) / (max - min));
	}
	return result;
}

/** 平面按引用团着色；时间/放射仍用相对种子的主题相似度。 */
export function defaultColorMode(layout: LayoutMode): ColorMode {
	return layout === "force2d" ? "community" : "topic";
}

export const LAYOUT_LABEL: Record<LayoutMode, string> = {
	temporal: tr("时间", "Timeline"),
	radial: tr("相似度图", "Similarity map"),
	force2d: tr("网络", "Network"),
};

export const LAYOUT_HINT: Record<LayoutMode, string> = {
	temporal: tr("横轴年份，纵轴被引。", "Year on the horizontal axis; citations on the vertical axis."),
	radial: tr("越靠近中心越相似。拖动仅改变角度，不改变分数或距离。", "Closer to the center means more similar. Drag around an orbit without changing the score or distance."),
	force2d: tr("同组相近，边强则近。", "Papers in the same group and with stronger links are closer."),
};

export interface PlacedNode {
	id: string;
	x: number;
	y: number;
	z: number;
	radius: number;
}

export function placeLayout(
	mode: LayoutMode,
	nodes: readonly PaperNode[],
	edges: readonly GraphEdge[],
	seedScore: ReadonlyMap<string, number>,
	nowYear = new Date().getFullYear(),
): PlacedNode[] {
	const norms = nodes.map((node) => yearNormalizedCitations(node.citedByCount, node.year, nowYear));
	const minCited = norms.length ? Math.min(...norms) : 0;
	const maxCited = norms.length ? Math.max(...norms) : 0;
	const placed: PlacedNode[] = nodes.map((node, i) => ({
		id: node.id,
		x: 0,
		y: 0,
		z: 0,
		radius: citationRadius(norms[i] ?? 0, minCited, maxCited, node.isSeed),
	}));
	const seed = nodes.find((node) => node.isSeed);
	if (!seed) return placed;
	if (mode === "force2d") return placeForce2d(placed, edges, seed.id, seedScore);
	if (mode === "radial") return placeRadial(placed, nodes, seed.id, seedScore);
	return placeTemporal(placed, nodes);
}

function placeForce2d(
	placed: PlacedNode[],
	edges: readonly GraphEdge[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const nodes: ForceNode[] = placed.map((node) => ({ id: node.id, x: 0, y: 0, radius: node.radius }));
	runForceLayout(
		nodes,
		edges as GraphEdge[],
		seedId,
		new Map(seedScore),
		320,
		detectCommunities(placed.map((node) => node.id), edges),
	);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return placed.map((node) => {
		const at = byId.get(node.id);
		return { ...node, x: at?.x ?? 0, y: at?.y ?? 0, z: 0 };
	});
}

/** X is publication year. Y is log10(citations + 1). Undated papers sit just left of the span. */
function placeTemporal(placed: PlacedNode[], nodes: readonly PaperNode[]): PlacedNode[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	const minYear = years.length ? Math.min(...years) : 2000;
	const maxYear = years.length ? Math.max(...years) : minYear;
	const yearSpan = maxYear - minYear;
	const span = Math.max(1, yearSpan);
	const width = 460;
	const height = 300;
	const maxLog = Math.log10(nodes.reduce((max, node) => Math.max(max, node.citedByCount), 1) + 1) || 1;
	const buckets = new Map<string, number>();
	return placed.map((node) => {
		const paper = byId.get(node.id);
		const year = paper?.year ?? null;
		const cited = paper?.citedByCount ?? 0;
		const bucket = year === null ? "none" : String(year);
		const slot = buckets.get(bucket) ?? 0;
		buckets.set(bucket, slot + 1);
		// Keep chronological distances exact: unknown years occupy a separate gutter,
		// while known publication years map linearly onto the horizontal axis.
		const x = year === null ? -width / 2 - 48 : yearSpan === 0 ? 0 : ((year - minYear) / span - 0.5) * width;
		const y = (Math.log10(cited + 1) / maxLog - 0.5) * height;
		const verticalJitter = year === null ? (slot % 7) * 11 - 33 : (slot % 5) * 8 - 16;
		return { ...node, x, y: y + verticalJitter, z: 0 };
	});
}

/** Missing scores have no place on the similarity scale; zero is a valid score. */
export function similarityRadius(score: number | undefined): number | null {
	return score === undefined || !Number.isFinite(score) ? null : 78 + (1 - Math.min(1, Math.max(0, score))) * 200;
}

/** Project a drag onto its orbit, retaining the previous angle at the exact center. */
export function orbitPosition(radius: number, x: number, y: number, previous: { x: number; y: number }): { x: number; y: number } {
	const angle = Math.hypot(x, y) > 0.001 ? Math.atan2(y, x) : Math.atan2(previous.y, previous.x);
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Seed at the origin. Angle is initially distributed by year, then freely rotatable. */
function placeRadial(
	placed: PlacedNode[],
	nodes: readonly PaperNode[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const others = nodes
		.filter((node) => node.id !== seedId)
		.slice()
		.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.id.localeCompare(b.id));
	const angleOf = new Map(others.map((node, index) => [node.id, (index / Math.max(1, others.length)) * Math.PI * 2]));
	let unknown = 0;
	return placed.map((node) => {
		if (node.id === seedId) return { ...node, x: 0, y: 0, z: 0 };
		const radius = similarityRadius(seedScore.get(node.id));
		if (radius === null) {
			const index = unknown++;
			return { ...node, x: 360 + Math.floor(index / 8) * 60, y: -160 + (index % 8) * 45, z: 0 };
		}
		const angle = angleOf.get(node.id) ?? 0;
		return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 };
	});
}
