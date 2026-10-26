# Shared UI components

This is a vanilla TypeScript/DOM Obsidian plugin. There is no React/Vue component library. The reusable UI primitives are DOM factories and shared mounts.

## `src/graph-chrome.ts`

`mountGraphChrome` is the shared control system for both the main graph pane and the note embed. It creates layout/color controls, the year scrubber, tabs, export actions, and the collapsible bottom sheet. `paintBadges`, `paintEvidenceBadges`, and `paintPaperStateBadges` are shared semantic badge renderers.

## `src/filter-controls.ts`

`buildLegend` creates relation chips for direct citation, co-citation, coupling, and weak edges. `buildFilters` creates thresholds, year bounds, OpenAlex facets, and the path-to-seed toggle. These controls are used in the pane drawer and embed drawer.

## `src/visual.ts`

Small formatting helpers (`formatCount`, `snippet`) used in node metadata and details.

The source of truth is kept in the files above; both shells intentionally call the same graph-chrome and filter-control mounts so labels and state semantics do not drift.
