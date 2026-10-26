import { tr } from "./i18n";
import { visibleConnections } from "./connection-visibility";
import { classicInfluence } from "./aggregates";
import { communityColor, detectCommunities } from "./communities";
import { focusNodes } from "./graph-filter";
import { authorYear, citationLabelAlpha } from "./labels";
import { orbitPosition, placeLayout, radialDistanceScores, similarityRadius, type ColorMode, type DistanceScale, type LayoutMode } from "./layout-modes";
import { RELATION_COLOR, relationKind, type RelationKind } from "./relation";
import { topicSimilarity, topicSimilarityColor } from "./topic-similarity";
import type { GraphEdge, PaperNode } from "./types";
import type { LibraryAvailability } from "./library-panel";
import { citationRadius, clamp, classicBreath, fitViewScale, yearColor, yearNormalizedCitations } from "./visual";

interface DrawNode extends PaperNode {
	x: number;
	y: number;
	homeX: number;
	homeY: number;
	radius: number;
	color: string;
	shown: boolean;
}

type Drag =
	| { kind: "pan"; px: number; py: number; tx: number; ty: number }
	| { kind: "node"; id: string; dx: number; dy: number };

/**
 * Canvas similarity map: pan, zoom, drag with a simmer that keeps the layout's
 * edge lengths and homes, hover title, click to select.
 * Wheel zoom eases toward its target; pan and pinch stay immediate.
 */
export class SimilarityMap {
	libraryStatus: ((paper: PaperNode) => LibraryAvailability | null) | null = null;

	refreshLibraryStatus(): void { this.draw(); }
	onSelect: ((paper: PaperNode | null) => void) | null = null;
	onDraw: (() => void) | null = null;
	/** Canvas-local CSS coordinates for a visible node and its rendered radius. */
	nodeAnchor(id: string): { x: number; y: number; radius: number } | null {
		const node = this.nodes.find(item => item.id === id);
		if (!node || !this.isShown(node)) return null;
		return { x: node.x * this.k + this.tx, y: node.y * this.k + this.ty, radius: node.radius * this.k };
	}

	onEdgeSelect: ((edge: GraphEdge) => void) | null = null;
	onVisibleConnections: ((edges: readonly GraphEdge[] | null) => void) | null = null;
	private showAllCitationConnections = false;
	setShowAllCitationConnections(show: boolean): void {
		this.showAllCitationConnections = show;
		this.draw();
	}
	private visibleConnections(): GraphEdge[] {
		return visibleConnections(this.edges, new Set(this.nodes.filter(node => node.shown).map(node => node.id)),
			this.kindVisible, this.layoutMode, this.similarityKind, this.showAllCitationConnections, this.hoverId ?? this.selectedId);
	}
	onNodeMenu: ((paper: PaperNode | null, x: number, y: number) => void) | null = null;
	onDeleteRequest: (() => void) | null = null;

	private ctx: CanvasRenderingContext2D | null = null;
	private nodes: DrawNode[] = [];
	private edges: GraphEdge[] = [];
	private maxWeight = 1;
	private tx = 0;
	private ty = 0;
	private k = 1;
	private cssWidth = 1;
	private cssHeight = 1;
	private selectedId: string | null = null;
	private hoverId: string | null = null;
	private focus: Set<string> | null = null;
	private kindVisible: Record<RelationKind, boolean> = { direct: true, cocitation: true, coupling: true, weak: false };
	private dragging: Drag | null = null;
	private moved = false;
	private downX = 0;
	private downY = 0;
	private fontFamily = "sans-serif";
	private alive = true;
	private adjusted = false;
	private pointers = new Map<number, { x: number; y: number }>();
	private pinch: { startDist: number; k: number; wx: number; wy: number } | null = null;
	private coarse: boolean | null = null;
	private bgStart = "#ffffff";
	private bgEnd = "#f7f6f3";
	private graphNode = "#8a7fd8";
	private graphNodeFocused = "#4a90d9";
	private graphText = "#4b5563";
	private layoutMode: LayoutMode = "temporal";
	private colorMode: ColorMode = "community";
	private scrubYear: number | null = null;
	private seedScore = new Map<string, number>();
	private distanceScores = new Map<string, number>();
	private distanceScale: DistanceScale = "absolute";
	/** Orbital angles survive a temporary move to the missing-evidence grid. */
	private orbitAngles = new Map<string, number>();
	setDistanceScale(scale: DistanceScale): void {
		if (this.distanceScale === scale) return;
		this.distanceScale = scale;
		if (this.layoutMode === "radial") this.adoptGraph(this.nodes, this.edges, this.seedScore);
	}
	private communities = new Map<string, number>();
	private classicGlow = new Map<string, number>();
	private minYear = 0;
	private maxYear = 0;
	private simAlpha = 0;
	private simFrame: number | null = null;
	private edgeRest = new Map<string, number>();
	/** Wheel zoom eases toward this target (pan and pinch stay immediate). */
	private zoomAnim: { k: number; tx: number; ty: number } | null = null;
	private zoomFrame: number | null = null;
	private pulseFrame: number | null = null;
	private wheelNeedsModifier = false;
	private readonly animationDocument: Document | undefined;
	private readonly motionQuery: MediaQueryList | null;
	private animationsAllowed(): boolean {
		return this.alive && !this.animationDocument?.hidden && !this.motionQuery?.matches;
	}
	private onAnimationPolicy = (): void => {
		if (this.animationsAllowed()) { this.ensurePulse(); return; }
		for (const frame of [this.simFrame, this.zoomFrame, this.pulseFrame]) if (frame !== null) this.caf(frame);
		this.simFrame = this.zoomFrame = this.pulseFrame = null;
		this.simAlpha = 0;
		if (this.zoomAnim) {
			this.k = this.zoomAnim.k; this.tx = this.zoomAnim.tx; this.ty = this.zoomAnim.ty;
			this.zoomAnim = null;
		}
		this.draw();
	};

	private setCursor(cursor: "grab" | "grabbing" | "pointer"): void {
		this.canvas.classList.toggle("is-pointer", cursor === "pointer");
		this.canvas.classList.toggle("is-grabbing", cursor === "grabbing");
	}

	getViewState(): { zoom: number; centerX: number; centerY: number; selectedId: string | null; similarityKind: "text" | "citations"; distanceScale: DistanceScale } {
		return {
			zoom: this.k,
			centerX: (this.cssWidth / 2 - this.tx) / this.k,
			centerY: (this.cssHeight / 2 - this.ty) / this.k,
			selectedId: this.selectedId,
			similarityKind: this.similarityKind,
			distanceScale: this.distanceScale,
		};
	}

	setViewState(state: { zoom: number; centerX: number; centerY: number; selectedId: string | null; distanceScale?: DistanceScale }): void {
		if (state.distanceScale) this.setDistanceScale(state.distanceScale);
		this.k = clamp(state.zoom, 0.025, 4);
		this.tx = this.cssWidth / 2 - state.centerX * this.k;
		this.ty = this.cssHeight / 2 - state.centerY * this.k;
		this.selectedId = this.nodes.some((node) => node.id === state.selectedId) ? state.selectedId : null;
		this.refreshFocus();
		this.draw();
	}

	/** Headless verify stubs have no rAF; a timeout keeps the loops converging. */
	private raf(callback: () => void): number {
		return typeof window.requestAnimationFrame === "function"
			? window.requestAnimationFrame(callback)
			: window.setTimeout(callback, 16);
	}

	private caf(id: number): void {
		if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(id);
		else window.clearTimeout(id);
	}

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly tooltip: HTMLElement,
		private readonly stage: HTMLElement,
		options?: { wheel?: "always" | "modifier" },
	) {
		this.animationDocument = canvas.ownerDocument ?? (typeof document === "undefined" ? undefined : document);
		this.motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
		this.animationDocument?.addEventListener("visibilitychange", this.onAnimationPolicy);
		this.motionQuery?.addEventListener("change", this.onAnimationPolicy);
		this.wheelNeedsModifier = options?.wheel === "modifier";
		canvas.tabIndex = 0;
		// Optional-call: the headless verify script stubs a bare canvas object.
		canvas.setAttribute?.("role", "application");
		if (!canvas.getAttribute?.("aria-label") && !canvas.getAttribute?.("aria-labelledby")) {
			canvas.setAttribute?.("aria-label", tr("论文相似度图谱：方向键平移，+/- 缩放，0 或 F 适配", "Paper similarity graph: arrow keys to pan, +/- to zoom, 0 or F to fit"));
		}
		canvas.addEventListener("pointerdown", this.onPointerDown);
		canvas.addEventListener("pointermove", this.onPointerMove);
		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		canvas.addEventListener("pointerleave", this.onPointerLeave);
		canvas.addEventListener("keydown", this.onKeyDown);
		canvas.addEventListener("contextmenu", this.onContextMenu);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("pointercancel", this.onPointerUp);
	}

	setGraph(nodes: PaperNode[], edges: GraphEdge[], seedScore: Map<string, number>): void {
		this.orbitAngles.clear();
		this.simAlpha = 0;
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(nodes, edges);
		this.ensurePulse();
		// 不重置 layoutMode：布局由应用层（chrome 按钮）持有，建图后回灌。
		this.scrubYear = null;
		this.rebuild(nodes, true);
	}

	/** Change the comparison metric without moving the viewport or losing orbital angles. */
	setComparisonScores(scores: Map<string, number>, kind: "text" | "citations"): void {
		this.similarityKind = kind;
		this.comparisonLabel = kind === "text" ? tr("文本相似度", "Text similarity") : tr("引用相似度", "Citation similarity");
		this.seedScore = scores;
		if (this.layoutMode === "radial") this.adoptGraph(this.nodes, this.edges, scores);
		else this.draw();
	}
	private comparisonLabel = tr("相似度", "Similarity");
	private similarityKind: "text" | "citations" = "text";

	/** Keep existing coordinates by default; reflow and fit after removals/restores when requested. */
	adoptGraph(nodes: PaperNode[], edges: GraphEdge[], seedScore: Map<string, number>, nearId?: string, reflow = false): void {
		this.distanceScores = radialDistanceScores(nodes, seedScore, this.distanceScale);
		const prev = new Map(this.nodes.map((node) => [node.id, node]));
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(nodes, edges);
		this.ensurePulse();
		const host = nearId ? prev.get(nearId) : null;
		const placed = reflow || this.layoutMode === "radial" || (!host && nodes.some(node => !prev.has(node.id)))
			? new Map(placeLayout(this.layoutMode, nodes, edges, this.layoutMode === "radial" ? this.distanceScores : seedScore).map((node) => [node.id, node]))
			: null;
		const norms = nodes.map((node) => yearNormalizedCitations(node.citedByCount, node.year));
		const minCited = Math.min(...norms);
		const maxCited = Math.max(...norms);
		this.nodes = nodes.map((node, index) => {
			const old = prev.get(node.id);
			const at = placed?.get(node.id);
			const parked = host && !old ? parkNear(host.x, host.y, node.id) : null;
			let x = reflow ? at?.x ?? 0 : old?.x ?? parked?.x ?? at?.x ?? 0;
			let y = reflow ? at?.y ?? 0 : old?.y ?? parked?.y ?? at?.y ?? 0;
			if (this.layoutMode === "radial") {
				const radius = similarityRadius(this.distanceScores.get(node.id));
				const angle = this.orbitAngles.get(node.id) ?? Math.atan2(at?.y ?? y, at?.x ?? x);
				const point = node.isSeed ? { x: 0, y: 0 } : radius === null ? at ?? { x: 360, y: 0 }
					: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
				if (!node.isSeed && radius !== null) this.orbitAngles.set(node.id, angle);
				x = point.x; y = point.y;
			}
			return {
				...node,
				x,
				y,
				homeX: x,
				homeY: y,
				radius: at?.radius ?? citationRadius(norms[index] ?? 0, minCited, maxCited, node.isSeed),
				color: this.colorOf(node),
				shown: this.isShown(node),
			};
		});
		this.maxWeight = edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.captureStructure();
		if (this.selectedId && !this.nodes.some((node) => node.id === this.selectedId)) {
			this.selectedId = this.nodes.find((node) => node.isSeed)?.id ?? null;
			this.onSelect?.(this.nodes.find((node) => node.id === this.selectedId) ?? null);
		}
		this.refreshFocus();
		if (reflow) this.fit(true);
		else {
			this.reheat(0.28);
			this.draw();
		}
	}

	/**
	 * Swap in enriched edges (e.g. OpenCitations gap-filling) without touching
	 * layout mode, color mode, scrub year, node positions, or the view transform.
	 */
	updateGraphData(edges: GraphEdge[]): void {
		this.edges = edges;
		this.communities = detectCommunities(this.nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(this.nodes, edges);
		this.ensurePulse();
		this.maxWeight = edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.recolor();
		this.refreshFocus();
		this.draw();
	}

	/** Edge-type visibility for the 2D panel. Weak links start hidden. */
	setKinds(kinds: Record<RelationKind, boolean>): void {
		this.kindVisible = { ...kinds };
		this.refreshFocus();
		this.draw();
	}

	setLayout(mode: LayoutMode): void {
		if (this.layoutMode === mode) return;
		if (this.simFrame !== null) this.caf(this.simFrame);
		this.simFrame = null;
		this.simAlpha = 0;
		this.dragging = null;
		this.layoutMode = mode;
		const canvasStyles = typeof getComputedStyle === "function" ? getComputedStyle(this.canvas) : null;
		this.bgStart = themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-start") ?? "", "#ffffff");
		this.bgEnd = themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-end") ?? "", "#f7f6f3");
		this.rebuild(this.nodes, false);
		this.fit(true);
	}

	setColorMode(mode: ColorMode): void {
		this.colorMode = mode;
		this.recolor();
		this.draw();
	}

	setScrubYear(year: number | null): void {
		this.scrubYear = year;
		for (const node of this.nodes) node.shown = this.isShown(node);
		if (this.selectedId && !this.nodes.some((node) => node.id === this.selectedId && node.shown)) {
			this.selectedId = null;
			this.onSelect?.(null);
		}
		this.refreshFocus();
		this.draw();
	}

	/** True after the user pans, zooms, or drags. Automatic resizes only refit before that. */
	hasAdjusted(): boolean {
		return this.adjusted;
	}

	/** Community assignment behind node colors; recomputed by setGraph and updateGraphData. */
	getCommunities(): ReadonlyMap<string, number> {
		return this.communities;
	}

	setSelected(id: string | null): void {
		this.selectedId = id;
		this.refreshFocus();
		this.draw();
	}

	private refreshFocus(): void {
		const id = this.hoverId ?? this.selectedId;
		if (this.layoutMode === "radial" && this.similarityKind === "text") {
			const seed = this.nodes.find(node => node.isSeed);
			this.focus = id && id !== seed?.id ? new Set([id, ...(seed ? [seed.id] : [])]) : null;
			return;
		}
		this.focus = id
			? focusNodes(id, this.edges, (edge) => this.kindVisible[relationKind(edge)])
			: null;
	}

	resize(): void {
		const stageRect = this.stage.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(stageRect.width));
		const height = Math.max(1, Math.round(stageRect.height));
		// Keep world point at the old center; do not refit — panel collapse must not rezoom.
		const cx = (this.cssWidth / 2 - this.tx) / this.k;
		const cy = (this.cssHeight / 2 - this.ty) / this.k;
		this.cssWidth = width;
		this.cssHeight = height;
		this.tx = width / 2 - cx * this.k;
		this.ty = height / 2 - cy * this.k;
		const bw = Math.round(width * dpr);
		const bh = Math.round(height * dpr);
		if (this.canvas.width !== bw || this.canvas.height !== bh) {
			this.canvas.width = bw;
			this.canvas.height = bh;
		}
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		this.ctx = ctx;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.fontFamily = getComputedStyle(this.stage).fontFamily || "sans-serif";
		const canvasStyles = getComputedStyle(this.canvas);
		this.bgStart = themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-start"), "#ffffff");
		this.bgEnd = themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-end"), "#f7f6f3");
		this.graphNode = themeColor(canvasStyles.getPropertyValue("--graph-node"), "#8a7fd8");
		this.graphNodeFocused = themeColor(canvasStyles.getPropertyValue("--graph-node-focused"), "#4a90d9");
		this.graphText = themeColor(canvasStyles.getPropertyValue("--graph-text"), "#4b5563");
		this.recolor();
		this.draw();
	}

	zoomBy(factor: number): void {
		this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, factor);
	}

	fit(fromUser = false): void {
		if (fromUser) this.adjusted = false;
		if (this.nodes.length === 0 || this.cssWidth < 2 || this.cssHeight < 2) return;
		this.zoomAnim = null;
		const bounds = this.contentBounds();
		this.k = fitViewScale(this.cssWidth, this.cssHeight, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
		this.tx = this.cssWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * this.k;
		this.ty = this.cssHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * this.k;
		this.draw();
	}

	private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
		const guides = this.layoutMode === "radial" && this.nodes.some(node => node.isSeed);
		let minX = guides ? -300 : Infinity;
		let minY = guides ? -310 : Infinity;
		let maxX = guides ? 300 : -Infinity;
		let maxY = guides ? 300 : -Infinity;
		for (const node of this.nodes) {
			if (!node.shown) continue;
			minX = Math.min(minX, node.x - node.radius);
			minY = Math.min(minY, node.y - node.radius);
			maxX = Math.max(maxX, node.x + node.radius);
			maxY = Math.max(maxY, node.y + node.radius);
		}
		if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
		return { minX, minY, maxX, maxY };
	}

	private physicsOn(): boolean {
		return this.layoutMode === "force2d";
	}

	private reheat(alpha: number): void {
		if (!this.animationsAllowed() || !this.physicsOn() || this.nodes.length > 350) return;
		this.simAlpha = Math.max(this.simAlpha, alpha);
		if (this.simFrame !== null) return;
		const step = (): void => {
			if (!this.animationsAllowed() || this.simAlpha < 0.02) {
				this.simFrame = null;
				this.simAlpha = 0;
				this.captureStructure();
				return;
			}
			this.tick(this.simAlpha);
			this.simAlpha *= this.dragging?.kind === "node" ? 0.985 : 0.94;
			this.draw();
			this.simFrame = this.raf(step);
		};
		this.simFrame = this.raf(step);
	}

	private captureStructure(): void {
		const byId = new Map(this.nodes.map(node => [node.id, node]));
		for (const node of this.nodes) {
			node.homeX = node.x;
			node.homeY = node.y;
		}
		this.edgeRest.clear();
		for (const edge of this.edges) {
			const a = byId.get(edge.source);
			const b = byId.get(edge.target);
			if (!a || !b) continue;
			this.edgeRest.set(pairKey(a.id, b.id), Math.max(8, Math.hypot(b.x - a.x, b.y - a.y)));
		}
	}

	private tick(alpha: number): void {
		const nodes = this.nodes.filter((node) => node.shown);
		if (nodes.length < 2) return;
		const index = new Map(nodes.map((node, i) => [node.id, i] as const));
		const vx = new Array<number>(nodes.length).fill(0);
		const vy = new Array<number>(nodes.length).fill(0);
		const pinnedId = this.dragging?.kind === "node" ? this.dragging.id : null;
		const seed = this.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seed?.id ?? "";
		const seedCommunity = seed ? this.communities.get(seed.id) : undefined;
		const mobile = (id: string): boolean => id !== pinnedId && id !== seedId;
		const pulled = new Set<string>();
		if (pinnedId) {
			for (const edge of this.edges) {
				if (edge.source === pinnedId) pulled.add(edge.target);
				if (edge.target === pinnedId) pulled.add(edge.source);
			}
		}
		const centers = new Map<number, { x: number; y: number }>();
		const sums = new Map<number, { x: number; y: number; n: number }>();
		for (const node of nodes) {
			const cid = this.communities.get(node.id);
			if (cid === undefined) continue;
			const acc = sums.get(cid) ?? { x: 0, y: 0, n: 0 };
			acc.x += node.x;
			acc.y += node.y;
			acc.n += 1;
			sums.set(cid, acc);
		}
		for (const [cid, acc] of sums) centers.set(cid, { x: acc.x / acc.n, y: acc.y / acc.n });
		if (seed && seedCommunity !== undefined) centers.set(seedCommunity, { x: seed.x, y: seed.y });

		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				const min = a.radius + b.radius + 10;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 0.01;
				if (dist >= min) continue;
				dx /= dist;
				dy /= dist;
				const push = ((min - dist) / 2) * alpha;
				if (mobile(a.id)) {
					vx[i]! -= dx * push;
					vy[i]! -= dy * push;
				}
				if (mobile(b.id)) {
					vx[j]! += dx * push;
					vy[j]! += dy * push;
				}
			}
		}
		for (const edge of this.edges) {
			if (!this.kindVisible[relationKind(edge)]) continue;
			const ai = index.get(edge.source);
			const bi = index.get(edge.target);
			if (ai === undefined || bi === undefined) continue;
			const a = nodes[ai]!;
			const b = nodes[bi]!;
			const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
			const rest = this.edgeRest.get(pairKey(a.id, b.id)) ?? dist;
			const weight = clamp(edge.weight, 0, 1);
			const spring = 0.04 + weight * 0.08;
			const disp = (dist - rest) * spring * alpha;
			const dx = ((b.x - a.x) / dist) * disp;
			const dy = ((b.y - a.y) / dist) * disp;
			if (mobile(a.id)) {
				vx[ai]! += dx;
				vy[ai]! += dy;
			}
			if (mobile(b.id)) {
				vx[bi]! -= dx;
				vy[bi]! -= dy;
			}
		}
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]!;
			if (!mobile(node.id)) continue;
			const cid = this.communities.get(node.id);
			const center = cid === undefined ? undefined : centers.get(cid);
			const homeK = pulled.has(node.id) ? 0.04 : 0.12;
			let mx = vx[i]! - node.x * 0.02 * alpha + (node.homeX - node.x) * homeK * alpha;
			let my = vy[i]! - node.y * 0.02 * alpha + (node.homeY - node.y) * homeK * alpha;
			if (center) {
				mx -= (node.x - center.x) * 0.1 * alpha;
				my -= (node.y - center.y) * 0.1 * alpha;
			}
			mx *= 0.62;
			my *= 0.62;
			const speed = Math.hypot(mx, my);
			const cap = 16 * alpha;
			if (speed > cap && speed > 0) {
				mx = (mx / speed) * cap;
				my = (my / speed) * cap;
			}
			node.x = clamp(node.x + mx, -2400, 2400);
			node.y = clamp(node.y + my, -2400, 2400);
		}
	}

	private ensurePulse(): void {
		if (!this.animationsAllowed() || this.pulseFrame !== null || this.classicGlow.size === 0) return;
		const step = (): void => {
			if (!this.animationsAllowed() || this.classicGlow.size === 0) {
				this.pulseFrame = null;
				return;
			}
			this.draw();
			this.pulseFrame = this.raf(step);
		};
		this.pulseFrame = this.raf(step);
	}

	destroy(): void {
		this.alive = false;
		this.animationDocument?.removeEventListener("visibilitychange", this.onAnimationPolicy);
		this.motionQuery?.removeEventListener("change", this.onAnimationPolicy);
		if (this.simFrame !== null) this.caf(this.simFrame);
		if (this.zoomFrame !== null) this.caf(this.zoomFrame);
		if (this.pulseFrame !== null) this.caf(this.pulseFrame);
		this.simFrame = null;
		this.zoomFrame = null;
		this.pulseFrame = null;
		this.pointers.clear();
		this.pinch = null;
		this.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.canvas.removeEventListener("pointermove", this.onPointerMove);
		this.canvas.removeEventListener("wheel", this.onWheel);
		this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
		this.canvas.removeEventListener("keydown", this.onKeyDown);
		this.canvas.removeEventListener("contextmenu", this.onContextMenu);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("pointercancel", this.onPointerUp);
		this.hideTooltip();
	}

	private zoomAt(sx: number, sy: number, factor: number): void {
		this.adjusted = true;
		const next = clamp(this.k * factor, 0.02, 8);
		const world = this.screenToWorld(sx, sy);
		// Ease toward the target like the Obsidian graph; rapid wheel ticks just
		// move the target, and one rAF loop converges on it.
		this.zoomAnim = { k: next, tx: sx - world.x * next, ty: sy - world.y * next };
		if (!this.animationsAllowed()) { this.onAnimationPolicy(); return; }
		if (this.zoomFrame !== null) return;
		const step = (): void => {
			const target = this.zoomAnim;
			if (!this.animationsAllowed() || !target) {
				this.zoomFrame = null;
				return;
			}
			const dk = target.k - this.k;
			const dtx = target.tx - this.tx;
			const dty = target.ty - this.ty;
			if (Math.abs(dk) < 0.002 && Math.abs(dtx) < 0.5 && Math.abs(dty) < 0.5) {
				this.k = target.k;
				this.tx = target.tx;
				this.ty = target.ty;
				this.zoomAnim = null;
				this.zoomFrame = null;
				this.draw();
				return;
			}
			this.k += dk * 0.3;
			this.tx += dtx * 0.3;
			this.ty += dty * 0.3;
			this.draw();
			this.zoomFrame = this.raf(step);
		};
		this.zoomFrame = this.raf(step);
	}

	private onWheel = (event: WheelEvent): void => {
		if (!this.alive) return;
		if (this.wheelNeedsModifier && !event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		const local = this.localPoint(event.clientX, event.clientY);
		const factor = Math.exp(-event.deltaY * 0.0012);
		this.zoomAt(local.x, local.y, factor);
	};

	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		if (!this.alive) return;
		const local = this.localPoint(event.clientX, event.clientY);
		const hit = this.hit(local.x, local.y);
		this.onNodeMenu?.(hit, event.clientX, event.clientY);
	};

	private onPointerDown = (event: PointerEvent): void => {
		if (!this.alive) return;
		this.canvas.focus({ preventScroll: true });
		if (event.button !== 0) return;
		// Direct manipulation cancels any eased zoom still in flight.
		this.zoomAnim = null;
		this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		try {
			this.canvas.setPointerCapture(event.pointerId);
		} catch {
			// The pointer can vanish before capture; dragging still tracks window pointerup.
		}
		if (this.pointers.size >= 2) {
			// Second finger down: pinch zoom takes over, single-pointer drag is cancelled.
			this.startPinch();
			this.dragging = null;
			this.moved = true;
			this.hideTooltip();
			return;
		}
		const local = this.localPoint(event.clientX, event.clientY);
		const hit = this.hit(local.x, local.y);
		this.moved = false;
		this.downX = event.clientX;
		this.downY = event.clientY;
		if (hit && !hit.isSeed && (this.layoutMode !== "radial" || similarityRadius(this.distanceScores.get(hit.id)) !== null)) {
			const world = this.screenToWorld(local.x, local.y);
			this.dragging = { kind: "node", id: hit.id, dx: hit.x - world.x, dy: hit.y - world.y };
		} else {
			this.dragging = { kind: "pan", px: local.x, py: local.y, tx: this.tx, ty: this.ty };
		}
	};

	private startPinch(): void {
		const points = [...this.pointers.values()];
		const a = points[0];
		const b = points[1];
		if (!a || !b) return;
		const mid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
		const world = this.screenToWorld(mid.x, mid.y);
		this.pinch = {
			startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
			k: this.k,
			wx: world.x,
			wy: world.y,
		};
	}

	private movePinch(): void {
		const pinch = this.pinch;
		if (!pinch) return;
		const points = [...this.pointers.values()];
		const a = points[0];
		const b = points[1];
		if (!a || !b) return;
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		if (dist <= 0) return;
		const mid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
		this.k = clamp(pinch.k * (dist / pinch.startDist), 0.02, 8);
		this.tx = mid.x - pinch.wx * this.k;
		this.ty = mid.y - pinch.wy * this.k;
		this.moved = true;
		this.adjusted = true;
		this.hideTooltip();
		this.draw();
	}

	private onPointerMove = (event: PointerEvent): void => {
		if (!this.alive) return;
		if (this.pointers.has(event.pointerId)) {
			this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (this.pinch) {
			this.movePinch();
			return;
		}
		const local = this.localPoint(event.clientX, event.clientY);
		const dragging = this.dragging;
		if (!dragging) {
			const hit = this.hit(local.x, local.y);
			const nextHover = hit?.id ?? null;
			if (nextHover !== this.hoverId) {
				this.hoverId = nextHover;
				this.refreshFocus();
				this.draw();
			}
			this.setCursor(hit ? "pointer" : "grab");
			this.placeTooltip(hit, local.x, local.y);
			return;
		}
		if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 4) {
			this.moved = true;
			this.adjusted = true;
		}
		if (dragging.kind === "pan") {
			this.tx = dragging.tx + (local.x - dragging.px);
			this.ty = dragging.ty + (local.y - dragging.py);
			this.setCursor("grabbing");
		} else {
			const node = this.nodes.find((item) => item.id === dragging.id);
			if (node) {
				const world = this.screenToWorld(local.x, local.y);
				const x = world.x + dragging.dx, y = world.y + dragging.dy;
				const radius = this.layoutMode === "radial" ? similarityRadius(this.distanceScores.get(node.id)) : null;
				const point = radius === null ? { x, y } : orbitPosition(radius, x, y, node);
				if (radius !== null) this.orbitAngles.set(node.id, Math.atan2(point.y, point.x));
				node.x = point.x;
				node.y = point.y;
				this.reheat(0.55);
			}
			this.setCursor("grabbing");
		}
		this.hideTooltip();
		this.draw();
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (!this.alive) return;
		this.pointers.delete(event.pointerId);
		if (this.pinch) {
			if (this.pointers.size >= 2) return;
			this.pinch = null;
			this.setCursor("grab");
			// One finger still down: resume panning from its current spot, no click fires.
			const remaining = this.pointers.values().next().value;
			if (remaining) {
				const local = this.localPoint(remaining.x, remaining.y);
				this.dragging = { kind: "pan", px: local.x, py: local.y, tx: this.tx, ty: this.ty };
				this.downX = remaining.x;
				this.downY = remaining.y;
				this.moved = true;
			}
			return;
		}
		const dragging = this.dragging;
		const wasDrag = this.moved;
		this.dragging = null;
		if (!dragging || wasDrag) {
			this.setCursor("grab");
			if (wasDrag && dragging?.kind === "node") this.reheat(0.32);
			this.draw();
			return;
		}
		if (dragging.kind === "node") {
			const node = this.nodes.find((item) => item.id === dragging.id) ?? null;
			this.selectedId = node?.id ?? null;
			this.onSelect?.(node);
		} else {
			const local = this.localPoint(this.downX, this.downY);
			const node = this.hit(local.x, local.y);
			if (node) {
				this.selectedId = node.id;
				this.onSelect?.(node);
				this.draw();
				return;
			}
			const p = this.screenToWorld(local.x, local.y);
			let closest: GraphEdge | null = null, distance = 7 / this.k;
			for (const edge of this.visibleConnections()) {
				if (!this.kindVisible[relationKind(edge)]) continue;
				const a = this.nodes.find(n => n.id === edge.source), b = this.nodes.find(n => n.id === edge.target);
				if (!a || !b || !this.isShown(a) || !this.isShown(b)) continue;
				const dx = b.x-a.x, dy = b.y-a.y;
				const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
				const d = Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
				if (d < distance) { distance = d; closest = edge; }
			}
			if (closest && this.onEdgeSelect) { this.onEdgeSelect(closest); return; }
			this.selectedId = null;
			this.onSelect?.(null);
		}
		this.draw();
	};

	private onPointerLeave = (): void => {
		if (this.dragging) return;
		this.hoverId = null;
		this.refreshFocus();
		this.hideTooltip();
		this.draw();
	};

	private onKeyDown = (event: KeyboardEvent): void => {
		if (!this.alive) return;
		const panStep = 48;
		const key = event.key;
		if (key === "Delete") {
			event.preventDefault();
			this.onDeleteRequest?.();
			return;
		}
		if (key === "Escape") {
			event.preventDefault();
			// 阻止冒泡：app 层 root 上还有一个 Escape 监听，避免 showDetail(null) 跑两次。
			event.stopPropagation();
			this.selectedId = null;
			this.hoverId = null;
			this.refreshFocus();
			this.onSelect?.(null);
			this.draw();
			return;
		}
		if ((key === "Enter" || key === " ") && this.selectedId) {
			event.preventDefault();
			this.onSelect?.(this.nodes.find((node) => node.id === this.selectedId) ?? null);
			return;
		}
		if (event.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
			event.preventDefault();
			const current = this.nodes.find((node) => node.id === this.selectedId) ?? this.nodes.find((node) => node.isSeed);
			if (current) {
				const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
				const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
				const next = this.nodes
					.filter((node) => node.shown && node.id !== current.id)
					.map((node) => {
						const vx = node.x - current.x;
						const vy = node.y - current.y;
						const distance = Math.hypot(vx, vy);
						const forward = (vx * dx + vy * dy) / Math.max(1, distance);
						return { node, score: forward > 0 ? distance / forward : Number.POSITIVE_INFINITY };
					})
					.filter((item) => Number.isFinite(item.score))
					.sort((a, b) => a.score - b.score)[0]?.node;
				if (next) {
					this.selectedId = next.id;
					this.refreshFocus();
					this.onSelect?.(next);
					this.draw();
				}
			}
			return;
		}
		if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
			event.preventDefault();
			this.tx += key === "ArrowLeft" ? panStep : key === "ArrowRight" ? -panStep : 0;
			this.ty += key === "ArrowUp" ? panStep : key === "ArrowDown" ? -panStep : 0;
			this.adjusted = true;
			this.draw();
			return;
		}
		if (key === "+" || key === "=") {
			event.preventDefault();
			this.zoomBy(1.2);
			return;
		}
		if (key === "-" || key === "_") {
			event.preventDefault();
			this.zoomBy(1 / 1.2);
			return;
		}
		if (key === "0" || key === "f" || key === "F") {
			event.preventDefault();
			this.fit(true);
		}
	};

	private placeTooltip(node: DrawNode | null, x: number, y: number): void {
		if (!node) {
			this.hideTooltip();
			return;
		}
		this.tooltip.hidden = false;
		const radius = similarityRadius(this.distanceScores.get(node.id));
		this.tooltip.textContent = this.layoutMode === "radial"
			? `${node.title}\n${node.isSeed ? tr("比较中心", "Comparison paper") : radius === null ? tr("数据不足", "Insufficient data") : `${this.comparisonLabel} ${this.seedScore.get(node.id)!.toFixed(2)}`}`
			: node.title;
		const width = this.tooltip.offsetWidth || 180;
		const height = this.tooltip.offsetHeight || 32;
		const left = x + width + 16 > this.cssWidth ? Math.max(8, x - width - 12) : x + 14;
		const top = y + height + 16 > this.cssHeight ? Math.max(8, y - height - 10) : y + 14;
		this.tooltip.style.left = `${left}px`;
		this.tooltip.style.top = `${top}px`;
	}

	private hideTooltip(): void {
		this.tooltip.hidden = true;
		this.tooltip.textContent = "";
	}

	private hit(sx: number, sy: number): DrawNode | null {
		const world = this.screenToWorld(sx, sy);
		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const node = this.nodes[i];
			if (!node || !node.shown) continue;
			const dx = world.x - node.x;
			const dy = world.y - node.y;
			const reach = node.radius + (this.isCoarsePointer() ? 12 : 4);
			if (dx * dx + dy * dy <= reach * reach) return node;
		}
		return null;
	}

	private isCoarsePointer(): boolean {
		if (this.coarse !== null) return this.coarse;
		try {
			this.coarse =
				typeof window !== "undefined" && typeof window.matchMedia === "function"
					? window.matchMedia("(pointer: coarse)").matches
					: false;
		} catch {
			this.coarse = false;
		}
		return this.coarse;
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return { x: (sx - this.tx) / this.k, y: (sy - this.ty) / this.k };
	}

	private localPoint(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	private draw(): void {
		this.onDraw?.();
		const ctx = this.ctx;
		if (!ctx || !this.alive) return;
		const width = this.cssWidth;
		const height = this.cssHeight;
		const background = ctx.createRadialGradient(
			width / 2,
			height / 2,
			40,
			width / 2,
			height / 2,
			Math.max(width, height) * 0.72,
		);
		background.addColorStop(0, this.bgStart);
		background.addColorStop(1, this.bgEnd);
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, width, height);
		if (this.layoutMode === "temporal") this.drawYearAxis(ctx);
		if (this.layoutMode === "radial") this.drawSimilarityGuides(ctx);
		const byId = new Map(this.nodes.map((node) => [node.id, node]));
		const focus = this.focus;
		ctx.lineCap = "round";
		const visibleEdges = this.visibleConnections();
		this.onVisibleConnections?.(this.layoutMode === "radial" ? visibleEdges : null);
		for (const edge of visibleEdges) {
			const a = byId.get(edge.source);
			const b = byId.get(edge.target);
			if (!a || !b || !a.shown || !b.shown) continue;
			const kind = relationKind(edge);
			if (!this.kindVisible[kind]) continue;
			const dimmed = focus !== null && !(focus.has(edge.source) && focus.has(edge.target));
			const focused = focus !== null && !dimmed;
			const ax = a.x * this.k + this.tx;
			const ay = a.y * this.k + this.ty;
			const bx = b.x * this.k + this.tx;
			const by = b.y * this.k + this.ty;
			// 默认对齐 Obsidian 图谱：细、浅、中性灰；聚焦时才按关系类型着色。
			const sameCommunity = this.communities.get(edge.source) === this.communities.get(edge.target);
			const strokeStyle = this.layoutMode === "radial"
				? hexRgba(RELATION_COLOR[kind], dimmed ? 0.25 : 0.85)
				: dimmed
				? "rgba(90, 96, 106, 0.06)"
				: focused
					? hexRgba(RELATION_COLOR[kind], 0.85)
					: sameCommunity
						? "rgba(90, 96, 106, 0.14)"
						: "rgba(90, 96, 106, 0.07)";
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.strokeStyle = strokeStyle;
			const relatedness = clamp(edge.structuralSimilarity === null ? 0 : edge.structuralSimilarity ?? edge.weight, 0, 1);
			ctx.lineWidth = clamp(0.55 + Math.sqrt(relatedness) * 1.4 + (focused ? 0.35 : 0), 0.55, 2.2);
			ctx.stroke();
			if (kind !== "direct") continue;
			ctx.fillStyle = strokeStyle;
			if (edge.direct === "source-cites-target" || edge.direct === "mutual") strokeArrow(ctx, ax, ay, bx, by, b.radius * this.k);
			if (edge.direct === "target-cites-source" || edge.direct === "mutual") strokeArrow(ctx, bx, by, ax, ay, a.radius * this.k);
		}

		const ordered = [...this.nodes].sort((a, b) => a.radius - b.radius || (a.isSeed ? 1 : 0) - (b.isSeed ? 1 : 0));
		for (const node of ordered) {
			if (node.shown) this.drawNode(ctx, node);
		}
		this.drawLabels(ctx);
	}

	private drawSimilarityGuides(ctx: CanvasRenderingContext2D): void {
		if (!this.nodes.some(node => node.isSeed)) return;
		ctx.save();
		ctx.font = `11px ${this.fontFamily}`;
		ctx.textAlign = "center";
		ctx.strokeStyle = this.graphText;
		ctx.fillStyle = this.graphText;
		ctx.lineWidth = 1;
		for (const score of [1, 0.5, 0]) {
			const radius = similarityRadius(score)! * this.k;
			ctx.globalAlpha = 0.12;
			ctx.beginPath(); ctx.arc(this.tx, this.ty, radius, 0, Math.PI * 2); ctx.stroke();
		}
		const active = this.nodes.find(node => node.id === (this.dragging?.kind === "node" ? this.dragging.id : this.hoverId ?? this.selectedId));
		if (active && !active.isSeed && active.shown && similarityRadius(this.distanceScores.get(active.id)) !== null) {
			ctx.globalAlpha = 0.4;
			ctx.beginPath(); ctx.moveTo(this.tx, this.ty); ctx.lineTo(active.x * this.k + this.tx, active.y * this.k + this.ty); ctx.stroke();
			if (this.dragging?.kind === "node") {
				ctx.setLineDash([4, 5]);
				ctx.beginPath(); ctx.arc(this.tx, this.ty, similarityRadius(this.distanceScores.get(active.id))! * this.k, 0, Math.PI * 2); ctx.stroke();
			}
		}
		ctx.globalAlpha = 0.75;
		if (this.nodes.some(node => !node.isSeed && similarityRadius(this.distanceScores.get(node.id)) === null)) {
			ctx.textAlign = "left";
			ctx.fillText(tr("数据不足", "Insufficient data"), 335 * this.k + this.tx, -195 * this.k + this.ty);
		}
		ctx.restore();
	}

	private drawYearAxis(ctx: CanvasRenderingContext2D): void {
		if (!this.nodes.some((node) => node.year !== null)) return;
		const width = 460;
		const yearSpan = this.maxYear - this.minYear;
		const span = Math.max(1, yearSpan);
		const bottom = this.cssHeight - 26;
		const top = 24;
		const ticks = [...new Set([this.minYear, Math.round((this.minYear + this.maxYear) / 2), this.maxYear])];
		ctx.save();
		ctx.font = `11px ${this.fontFamily}`;
		ctx.textBaseline = "bottom";
		for (const year of ticks) {
			const worldX = yearSpan === 0 ? 0 : ((year - this.minYear) / span - 0.5) * width;
			const x = worldX * this.k + this.tx;
			if (x < -20 || x > this.cssWidth + 20) continue;
			ctx.beginPath();
			ctx.moveTo(x, top);
			ctx.lineTo(x, bottom);
			ctx.strokeStyle = "rgba(105, 116, 128, 0.10)";
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.fillStyle = "rgba(95, 105, 116, 0.72)";
			ctx.textAlign = x < 42 ? "left" : x > this.cssWidth - 42 ? "right" : "center";
			ctx.fillText(String(year), x, this.cssHeight - 7);
		}
		const unknownX = (-width / 2 - 48) * this.k + this.tx;
		if (this.nodes.some((node) => node.year === null) && unknownX > 0 && unknownX < this.cssWidth) {
			ctx.fillStyle = "rgba(95, 105, 116, 0.72)";
			ctx.textAlign = "center";
			ctx.fillText(tr("年份未知", "Year unknown"), unknownX, this.cssHeight - 7);
		}
		ctx.restore();
	}

	private drawNode(ctx: CanvasRenderingContext2D, node: DrawNode): void {
		const x = node.x * this.k + this.tx;
		const y = node.y * this.k + this.ty;
		const radius = node.radius + (node.id === this.hoverId ? 1.6 : 0);
		const dimmed = this.focus !== null && !this.focus.has(node.id);
		if (dimmed) ctx.globalAlpha = 0.25;
		if (node.isSeed) {
			const glow = ctx.createRadialGradient(x, y, radius, x, y, radius + 22);
			glow.addColorStop(0, "rgba(60, 64, 70, 0.16)");
			glow.addColorStop(1, "rgba(60, 64, 70, 0)");
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius + 22, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		const active = node.id === this.hoverId || node.id === this.selectedId;
		const classic = this.classicGlow.has(node.id) && !node.isSeed;
		const beat = classic && this.animationsAllowed() ? classicBreath(node.id) : 0;
		ctx.fillStyle = this.colorMode === "graph" && active ? this.graphNodeFocused : node.color;
		ctx.shadowColor = "rgba(60, 64, 70, 0.18)";
		ctx.shadowBlur = 5;
		ctx.fill();
		ctx.shadowColor = "rgba(0, 0, 0, 0)";
		ctx.shadowBlur = 0;
		ctx.lineWidth = 1;
		// 峰值时淡化描边，让光晕从盘缘融出去
		if (classic) {
			ctx.strokeStyle = withAlpha(shadeColor(node.color, 0.85), Math.max(0.08, 1 - 0.92 * beat));
		} else {
			ctx.strokeStyle = shadeColor(node.color, 0.85);
		}
		ctx.stroke();
		if (classic) {
			drawClassicSelfGlow(ctx, x, y, radius, node.color, beat, this.classicGlow.get(node.id) ?? 0);
		}
		if (node.isSeed) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = "#333943";
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
			ctx.lineWidth = 1;
			ctx.strokeStyle = "rgba(51, 57, 67, 0.45)";
			ctx.stroke();
		}
		if (node.id === this.selectedId) {
			ctx.beginPath();
			// 种子节点已有两圈外环，选中环要画在它们外面
			ctx.arc(x, y, radius + (node.isSeed ? 10.5 : 3), 0, Math.PI * 2);
			ctx.lineWidth = 2;
			ctx.strokeStyle = this.graphNodeFocused;
			ctx.stroke();
		}
		const library = this.libraryStatus?.(node);
		if (library) {
			ctx.save();
			ctx.font = "bold 9px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const badge = (dx: number, dy: number, text: string, color: string): void => {
				ctx.beginPath(); ctx.arc(x + dx, y + dy, 6, 0, Math.PI * 2);
				ctx.fillStyle = color; ctx.fill();
				ctx.fillStyle = "#ffffff"; ctx.fillText(text, x + dx, y + dy);
			};
			const state = library.local.state;
			if (state === "held" || state === "note-only" || state === "ambiguous") {
				badge(radius, -radius, state === "held" ? "H" : state === "note-only" ? "N" : "?", state === "held" ? "#197348" : state === "note-only" ? "#8f6100" : "#59616c");
			}
			if (library.providers.oa?.state === "available") badge(-radius, radius, "O", "#197348");
			if (library.providers.scihub?.state === "available") badge(radius, radius, "S", "#345e9e");
			ctx.restore();
		}
		if (dimmed) ctx.globalAlpha = 1;
	}

	private rebuild(nodes: readonly PaperNode[], resetView: boolean): void {
		this.distanceScores = radialDistanceScores(nodes, this.seedScore, this.distanceScale);
		const placed = new Map(placeLayout(this.layoutMode, nodes, this.edges, this.layoutMode === "radial" ? this.distanceScores : this.seedScore).map((node) => [node.id, node]));
		this.nodes = nodes.map((node) => {
			const at = placed.get(node.id);
			if (this.layoutMode === "radial" && !node.isSeed && similarityRadius(this.distanceScores.get(node.id)) !== null) {
				this.orbitAngles.set(node.id, Math.atan2(at?.y ?? 0, at?.x ?? 0));
			}
			return {
				...node,
				x: at?.x ?? 0,
				y: at?.y ?? 0,
				homeX: at?.x ?? 0,
				homeY: at?.y ?? 0,
				radius: at?.radius ?? 8,
				color: this.colorOf(node),
				shown: this.isShown(node),
			};
		});
		this.maxWeight = this.edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.captureStructure();
		this.refreshFocus();
		if (resetView) {
			this.selectedId = this.nodes.find((node) => node.isSeed)?.id ?? null;
			this.hoverId = null;
			this.refreshFocus();
			this.adjusted = false;
			this.hideTooltip();
			this.resize();
			this.fit();
			return;
		}
		this.draw();
	}

	private recolor(): void {
		for (const node of this.nodes) node.color = this.colorOf(node);
	}

	private colorOf(node: PaperNode): string {
		if (this.colorMode === "community") return communityColor(this.communities.get(node.id) ?? 0);
		if (this.colorMode === "year") return yearColor(node.year, this.minYear, this.maxYear);
		if (this.colorMode === "topic") {
			const seed = this.nodes.find((candidate) => candidate.isSeed);
			return topicSimilarityColor(topicSimilarity(node.topicTags, seed?.topicTags));
		}
		return this.graphNode;
	}

	private isShown(node: PaperNode): boolean {
		return node.isSeed || this.scrubYear === null || (node.year !== null && node.year <= this.scrubYear);
	}

	private drawLabels(ctx: CanvasRenderingContext2D): void {
		const ranked = [...this.nodes].sort((a, b) => b.citedByCount - a.citedByCount || a.id.localeCompare(b.id));
		const rankOf = new Map(ranked.map((node, index) => [node.id, index]));

		ctx.textBaseline = "middle";
		ctx.font = `11px ${this.fontFamily}`;
		ctx.textAlign = "left";
		const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
		const place = (node: DrawNode, maxWidth: number, alpha: number): void => {
			const cx = node.x * this.k + this.tx;
			const cy = node.y * this.k + this.ty;
			const comparison = this.layoutMode === "radial" && node.isSeed;
			const y = comparison ? cy + node.radius + 18 : cy;
			const text = fitText(ctx, comparison ? `${tr("比较中心", "Comparing with")}: ${node.title}` : authorYear(node), comparison ? 240 : maxWidth);
			const width = ctx.measureText(text).width;
			const rightX = cx + node.radius + 6;
			const leftX = cx - node.radius - 6 - width;
			const anchor = comparison || rightX + width <= this.cssWidth - 4 || leftX < 4 ? "left" : "right";
			const x = comparison ? cx - width / 2 : anchor === "left" ? rightX : leftX;
			const box = { x, y: y - 8, w: width, h: 16 };
			const must = node.isSeed || node.id === this.selectedId || node.id === this.hoverId;
			if (!must && overlaps(box, boxes)) return;
			boxes.push(box);
			const dimmed = this.focus !== null && !this.focus.has(node.id);
			ctx.globalAlpha = dimmed ? 0.35 * alpha : alpha;
			ctx.lineWidth = 2;
			ctx.strokeStyle = this.bgStart;
			ctx.textAlign = anchor;
			ctx.strokeText(text, x, y);
			ctx.fillStyle = this.graphText;
			ctx.fillText(text, x, y);
			ctx.globalAlpha = 1;
		};

		for (const node of this.nodes) {
			if (!node.shown) continue;
			const must = node.isSeed || node.id === this.selectedId || node.id === this.hoverId;
			if (this.layoutMode === "radial" && !must) continue;
			const alpha = must ? 1 : citationLabelAlpha(rankOf.get(node.id) ?? 99, this.k);
			if (alpha <= 0.02) continue;
			place(node, must || (rankOf.get(node.id) ?? 99) <= 7 ? 168 : 140, alpha);
		}
	}
}

function themeColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	try {
		if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", trimmed)) {
			return fallback;
		}
	} catch {
		return fallback;
	}
	return trimmed;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const slice = `${text.slice(0, mid)}…`;
		if (ctx.measureText(slice).width <= maxWidth) low = mid;
		else high = mid - 1;
	}
	return `${text.slice(0, low)}…`;
}

function hexRgba(hex: number, alpha: number): string {
	const red = (hex >> 16) & 255;
	const green = (hex >> 8) & 255;
	const blue = hex & 255;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Kumu 节点描边：同色系加深一点，制造与画布的分离感。 */
function shadeColor(rgb: string, factor: number): string {
	const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return "rgba(58, 63, 69, 0.4)";
	const red = Math.round(Number(match[1]) * factor);
	const green = Math.round(Number(match[2]) * factor);
	const blue = Math.round(Number(match[3]) * factor);
	return `rgb(${red}, ${green}, ${blue})`;
}

/** Pure self-color breath: centroid falloff, bright at center → soft fade to outer edge. */
function drawClassicSelfGlow(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	color: string,
	beat: number,
	influence: number,
): void {
	const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return;
	const red = Number(match[1]);
	const green = Number(match[2]);
	const blue = Number(match[3]);
	const power = 0.4 + 0.6 * influence;
	const halo = (8 + 16 * beat) * power;
	const peak = (0.32 + 0.48 * beat) * power;
	const outer = radius + halo;
	// 质心最亮，经盘缘到外晕平滑减淡（多档色停避免断层）
	const glow = ctx.createRadialGradient(x, y, 0, x, y, outer);
	const rim = clamp(radius / Math.max(outer, 1), 0.15, 0.85);
	glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${peak})`);
	glow.addColorStop(rim * 0.45, `rgba(${red}, ${green}, ${blue}, ${peak * 0.78})`);
	glow.addColorStop(rim, `rgba(${red}, ${green}, ${blue}, ${peak * 0.42})`);
	glow.addColorStop(rim + (1 - rim) * 0.45, `rgba(${red}, ${green}, ${blue}, ${peak * 0.16})`);
	glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(x, y, outer, 0, Math.PI * 2);
	ctx.fill();
}

function withAlpha(color: string, alpha: number): string {
	const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return color;
	return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${clamp(alpha, 0, 1)})`;
}

function strokeArrow(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	nodeRadius: number,
): void {
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const tipX = x2 - Math.cos(angle) * (nodeRadius + 2);
	const tipY = y2 - Math.sin(angle) * (nodeRadius + 2);
	const length = 7;
	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(tipX - length * Math.cos(angle - 0.4), tipY - length * Math.sin(angle - 0.4));
	ctx.lineTo(tipX - length * Math.cos(angle + 0.4), tipY - length * Math.sin(angle + 0.4));
	ctx.closePath();
	ctx.fill();
}

function parkNear(x: number, y: number, id: string): { x: number; y: number } {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
	const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
	return { x: x + Math.cos(angle) * 36, y: y + Math.sin(angle) * 36 };
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function overlaps(
	box: { x: number; y: number; w: number; h: number },
	boxes: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
	return boxes.some(
		(other) =>
			!(box.x + box.w < other.x || other.x + other.w < box.x || box.y + box.h < other.y || other.y + other.h < box.y),
	);
}
