# Extractable UI patterns

## GraphChrome

- Source: `src/graph-chrome.ts`
- Category: basic/layout
- Description: shared control rail, tab strip, export actions, year scrubber and bottom sheet
- Extractable props: `layouts`, `layout`, `color`, `noteButton`, `researchButton`, `analysisButton`, `timelineButton`, event callbacks
- Hardcoded: Chinese labels, relation vocabulary, warm paper surfaces, export labels

## FilterDrawer

- Source: `src/filter-controls.ts` plus shell drawer in `src/app.ts` / `src/embed-mount.ts`
- Category: basic
- Description: relation legend, thresholds, year range, facets and path-to-seed focus
- Extractable props: filter state and read/write callbacks
- Hardcoded: `筛选 / 图例`, relation labels, threshold labels

## BottomSheet

- Source: `src/graph-chrome.ts`
- Category: layout
- Description: collapsed one-line selection summary that expands into details, lists, analysis or timeline
- Extractable props: title, metadata, expanded state, body content
- Hardcoded: `展开` / `收起` affordance and sheet geometry

## GraphStage

- Sources: `src/map-canvas.ts`, `src/graph-3d.ts`, `src/app.ts`, `src/embed-mount.ts`
- Category: layout
- Description: canvas stage with zoom controls, tooltip, empty/loading states and optional drawer
- Extractable props: canvas renderer, layout, selected node, zoom callbacks
- Hardcoded: `+`, `−`, `适配`, `拖拽` interaction language
