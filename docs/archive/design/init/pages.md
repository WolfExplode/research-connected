# Surface dependency trees

## Main graph pane

`src/main.ts`

- `src/view.ts`
  - `src/app.ts`
    - `src/graph-chrome.ts`
    - `src/filter-controls.ts`
    - `src/map-canvas.ts`
    - `src/analysis-view.ts`
    - `src/timeline-view.ts`
    - `src/citation-timeline.ts`
    - `src/neighborhood.ts`
    - `src/openalex.ts`
    - `src/citation-sources.ts`
    - `src/llm.ts`
    - `src/export-graph.ts`
    - `src/vault-note.ts`
    - `styles.css`

## Note embed

`src/embed-block.ts`

- `src/embed-mount.ts`
  - `src/graph-chrome.ts`
  - `src/filter-controls.ts`
  - `src/graph-3d.ts`
  - `src/layout-3d.ts`
  - `src/analysis-view.ts`
  - `src/neighborhood.ts`
  - `src/openalex.ts`
  - `src/citation-sources.ts`
  - `src/export-graph.ts`
  - `styles.css`

The alignment target is both surfaces together, with `graph-chrome.ts` as the canonical interaction vocabulary.
