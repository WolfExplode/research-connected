# Layouts

## Main graph pane — `src/app.ts`

`mountGraphApp(root, deps)` renders the pane shell:

- `cpo-root`
  - `cpo-bar`: seed input, build button, example DOI, status and search results
  - `cpo-banner`: non-destructive errors/warnings
  - `cpo-body`
    - `cpo-rail`: filter button and vertical layout controls
    - `cpo-stage`: canvas, empty state, tooltip, filter drawer and zoom controls
  - `cpo-actions-bar`: tabs and exports
  - `cpo-sheet`: selected paper/list/analysis/timeline detail

The main pane is a full-height Obsidian view and owns the seed/search workflow. The actual DOM construction is in `src/app.ts` lines 68–170 and the tab/detail renderers in lines 200–690.

## Note embed — `src/embed-mount.ts`

`mountEmbed(root, deps)` renders the note-safe shell:

- `cpo-embed`
  - `cpo-embed-bar`: load status and reload action
  - `cpo-embed-body`
    - `cpo-rail`: filter and layout controls
    - `cpo-embed-stage`: 3D canvas, tooltip, drawer and zoom controls
  - `cpo-actions-bar`: shared tabs and exports
  - `cpo-sheet`: selected paper/list/analysis detail

The embed is deliberately self-contained and uses the same `mountGraphChrome` and `mountBottomSheet` functions as the pane. Its graph area is sized from the fence `height` and can be resized with the corner grip.

## Shared style

`styles.css` is the single stylesheet. The pane and embed currently share most tokens but have separate shell selectors (`.cpo-root` and `.cpo-embed`) and different top bars. The alignment pass should consolidate those selectors around shared surface, toolbar, rail, tab, drawer, and sheet tokens.
