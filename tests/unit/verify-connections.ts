import assert from "node:assert/strict";
import { visibleConnections } from "../../src/connection-visibility";
import { emptyFilter } from "../../src/graph-filter";
import type { GraphEdge } from "../../src/types";

export function verifyConnections(): void {
	const edge = (source: string, target: string, patch: Partial<GraphEdge>): GraphEdge => ({
		source, target, weight: 0.5, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "none", ...patch,
	});
	const direct = edge("a", "b", { direct: "source-cites-target" });
	const co = edge("b", "c", { coCitedBy: 2 });
	const coupling = edge("a", "c", { sharedRefs: 3 });
	const edges = [direct, co, coupling], shown = new Set(["a", "b", "c"]), kinds = emptyFilter().kinds;
	assert.deepEqual(visibleConnections(edges, shown, kinds, "radial", "text", true, "a"), [], "Text has no citation connections");
	assert.deepEqual(visibleConnections(edges, shown, kinds, "radial", "citations", false, null), [], "Unfocused Citations stays uncluttered");
	assert.deepEqual(visibleConnections(edges, shown, kinds, "radial", "citations", false, "b"), [direct, co], "Only incident connections appear on focus");
	assert.deepEqual(visibleConnections(edges, shown, kinds, "radial", "citations", true, null), edges, "Show all needs no selection");
	assert.deepEqual(visibleConnections(edges, shown, { ...kinds, direct: false }, "radial", "citations", true, "b"), [co, coupling], "Legend filters apply");
	assert.deepEqual(visibleConnections(edges, new Set(["a", "b"]), kinds, "radial", "citations", true, null), [direct], "Hidden endpoints remove their connections");
	for (const layout of ["force2d", "temporal"] as const) {
		assert.deepEqual(visibleConnections(edges, shown, kinds, layout, "text", false, null), edges, "Other layouts retain their connections");
	}
}
