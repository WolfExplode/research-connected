# Routes / surfaces

This is an Obsidian plugin, not a routed web app.

| Surface | Entry | Role |
| --- | --- | --- |
| Main pane | `src/main.ts` → `src/view.ts` → `src/app.ts` | Full graph exploration, search, evidence, citation timeline, analysis and optional LLM narrative |
| Note embed | `src/embed-block.ts` → `src/embed-mount.ts` | Self-contained 3D graph inside Reading View and Live Preview |
| Browser pane preview | `preview/index.html` → `preview/main.ts` | Offline/fixture preview of the main pane |
| Browser embed preview | `preview/embed.html` → `preview/embed-main.ts` | Offline/fixture preview of the note embed |

`src/graph-chrome.ts` and `src/filter-controls.ts` are the shared UI boundary between the two surfaces.
