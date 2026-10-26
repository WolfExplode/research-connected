import type { LayoutMode } from "./layout-modes";
import { relationKind, type RelationKind } from "./relation";
import type { GraphEdge } from "./types";

/** The same edge set drives drawing, picking and the visible-connection legend. */
export function visibleConnections(edges: readonly GraphEdge[], shown: ReadonlySet<string>,
	kinds: Record<RelationKind, boolean>, layout: LayoutMode, similarity: "text" | "citations",
	showAll: boolean, activeId: string | null): GraphEdge[] {
	if (layout === "radial" && similarity !== "citations") return [];
	return edges.filter(edge => shown.has(edge.source) && shown.has(edge.target) && kinds[relationKind(edge)] &&
		(layout !== "radial" || showAll || (activeId !== null && (edge.source === activeId || edge.target === activeId))));
}
