import { SimilarityMap } from "../../src/map-canvas";
import { registerPopover } from "../../src/graph-chrome";
import type { GraphEdge, PaperNode } from "../../src/types";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Exercise renderer lifecycle through its public interface with controlled frames. */
export function verifyCanvasLifecycle(root: HTMLElement, seed: PaperNode): void {
	const original = { raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame, media: window.matchMedia,
		hidden: Object.getOwnPropertyDescriptor(document, "hidden") };
	const frames = new Map<number, FrameRequestCallback>();
	const mediaListeners = new Set<() => void>();
	let nextFrame = 0, reduced = false;
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = id => { frames.delete(id); };
	window.matchMedia = () => ({ get matches() { return reduced; },
		addEventListener: (_type: string, listener: () => void) => { mediaListeners.add(listener); },
		removeEventListener: (_type: string, listener: () => void) => { mediaListeners.delete(listener); },
	}) as unknown as MediaQueryList;
	Object.defineProperty(document, "hidden", { configurable: true, value: false });
	const stage = document.createElement("div"), canvas = document.createElement("canvas"), tooltip = document.createElement("div");
	stage.style.width = "400px"; stage.style.height = "400px";
	stage.append(canvas, tooltip); root.append(stage);
	let map: SimilarityMap | undefined;
	try {
		map = new SimilarityMap(canvas, tooltip, stage);
		const nodes = [seed, { ...seed, id: "W2", isSeed: false, year: 1990 }, { ...seed, id: "W3", isSeed: false }, { ...seed, id: "W4", isSeed: false }];
		const edges: GraphEdge[] = ["W3", "W4"].map(source => ({ source, target: "W2", weight: 0.5, coupling: 0, coCitation: 0, sharedRefs: 0, coCitedBy: 0, direct: "source-cites-target" }));
		const scores = new Map(nodes.map(paper => [paper.id, paper.isSeed ? 1 : 0.5]));
		map.setGraph(nodes, edges, scores); map.setLayout("force2d");
		check(frames.size > 0, "classic-paper pulse must be scheduled when animation is allowed");
		map.setViewState({ zoom: 0.6, centerX: 17, centerY: 23, selectedId: seed.id });
		const before = map.getViewState(), anchor = map.nodeAnchor("W2");
		map.adoptGraph(nodes, edges, scores); map.setLayout("force2d");
		check(JSON.stringify(map.getViewState()) === JSON.stringify(before) && JSON.stringify(map.nodeAnchor("W2")) === JSON.stringify(anchor), "unchanged graph/layout updates must preserve the viewport and existing coordinates");
		Object.defineProperty(document, "hidden", { configurable: true, value: true });
		document.dispatchEvent(new Event("visibilitychange"));
		check(frames.size === 0, "hidden documents must cancel renderer animation frames");
		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		document.dispatchEvent(new Event("visibilitychange"));
		check(frames.size > 0, "visible documents may resume their pulse");
		reduced = true; mediaListeners.forEach(listener => listener());
		check(frames.size === 0, "reduced motion must stop continuous and simulation frames");
		const zoom = map.getViewState().zoom; map.zoomBy(1.2);
		check(map.getViewState().zoom > zoom && frames.size === 0, "reduced-motion zoom must apply immediately without animation");
		map.setLayout("radial");
		map.setComparisonScores(scores, "text");
		const textPositions = nodes.map(paper => map!.nodeAnchor(paper.id));
		const textView = map.getViewState();
		for (let round = 0; round < 3; round++) {
			map.adoptGraph(nodes, edges, new Map([[seed.id, 1]]));
			map.setComparisonScores(new Map([[seed.id, 1]]), "citations");
			check(JSON.stringify(map.nodeAnchor("W2")) !== JSON.stringify(textPositions[1]), "missing citation data must move to its separate grid");
			map.adoptGraph(nodes, edges, scores); map.setComparisonScores(scores, "text");
			check(JSON.stringify(nodes.map(paper => map!.nodeAnchor(paper.id))) === JSON.stringify(textPositions), "Text/Citations round trips must restore every orbital angle, rather than using missing-data grid angles");
			check(JSON.stringify(map.getViewState()) === JSON.stringify(textView), "comparison switching must preserve viewport and selection");
		}
		reduced = false; mediaListeners.forEach(listener => listener());
		map.destroy();
		check(frames.size === 0 && mediaListeners.size === 0, "destroy must release animation frames and media listeners");
	} finally {
		map?.destroy(); stage.remove();
		window.requestAnimationFrame = original.raf; window.cancelAnimationFrame = original.caf; window.matchMedia = original.media;
		if (original.hidden) Object.defineProperty(document, "hidden", original.hidden);
		else Reflect.deleteProperty(document, "hidden");
	}

	const frame = document.createElement("iframe"); root.append(frame);
	try {
		const doc = frame.contentDocument!;
		const menu = doc.createElement("details");
		menu.append(doc.createElement("summary"), doc.createElement("button")); doc.body.append(menu);
		const release = registerPopover(menu);
		try {
			menu.open = true; doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			check(!menu.open && doc.activeElement === menu.querySelector("summary"), "popover Escape must close and return focus within its own document");
			menu.open = true; doc.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
			check(!menu.open, "outside pointer in another document must close its own menu");
		} finally { release(); }
		menu.open = true; doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		check(menu.open, "released popovers must remove document listeners");
	} finally { frame.remove(); }
}
