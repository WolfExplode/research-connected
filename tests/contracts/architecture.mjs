import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";

const root = resolve("src");
// Pure semantic core. Coordinators (neighborhood/paper/citation-evidence) remain
// outside this list until their source DTO types move out of HTTP adapters.
const domain = new Set([
	"aggregates.ts", "communities.ts", "community-regions.ts",
	"diversity.ts", "doi-path.ts", "graph-filter.ts", "labels.ts", "layout.ts",
	"layout-modes.ts", "relation.ts", "similarity.ts", "text-similarity.ts",
	"topic-similarity.ts", "types.ts", "discovery-graph.ts", "question-workspace.ts",
]);
const adapters = new Set(["citation-sources.ts", "llm.ts", "obsidian-http.ts", "openalex.ts", "vault-note.ts"]);
const ui = new Set([
	"app.ts", "detail-cards.ts", "embed-block.ts", "embed-mount.ts", "filter-controls.ts",
	"graph-chrome.ts", "main.ts", "map-canvas.ts", "settings.ts",
	"sidebar-resize.ts", "view.ts", "visual.ts", "discovery-view.ts", "library-bridge.ts",
]);
const httpAdapters = new Set(["citation-sources.ts", "llm.ts", "obsidian-http.ts", "openalex.ts"]);
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
const domGlobal = /\b(?:document|window|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame)\b/;

function localTarget(file, specifier) {
	if (!specifier.startsWith(".")) return null;
	const target = normalize(join(dirname(file), specifier));
	return basename(extname(target) ? target : `${target}.ts`);
}

const errors = [];
for (const name of [...domain, ...adapters]) {
	const file = join(root, name);
	const source = readFileSync(file, "utf8");
	if (domain.has(name)) {
		if (/from\s+["']obsidian["']/.test(source)) errors.push(`${name}: domain must not import obsidian`);
		if (domGlobal.test(source)) errors.push(`${name}: domain must not use DOM globals`);
	}
	for (const match of source.matchAll(importPattern)) {
		const target = localTarget(file, match[1]);
		if (domain.has(name) && target && httpAdapters.has(target)) errors.push(`${name}: domain must not import HTTP adapter ${target}`);
		if (adapters.has(name) && target && ui.has(target)) errors.push(`${name}: adapter must not import UI module ${target}`);
	}
}
assert.deepEqual(errors, [], `Dependency boundary violations:\n${errors.join("\n")}`);
console.log("architecture checks passed");
