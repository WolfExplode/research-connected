# Pane and embed UI contract

The graph is the primary workspace, with paper details and evidence beside it. Pane and note embed
share graph chrome, detail cards, paper actions, and Obsidian theme tokens. Host-specific search,
placement, and heavy actions stay with their respective mounting code.

- Keep the UI minimal. Show information only when it helps users choose an action or understand
  a result. Avoid redundant summaries and persistent explanatory text; show loading and actionable
  errors when relevant, and clear transient status text when work finishes.
- src/responsive.ts determines narrow mode from the surface width: 780 px for panes, 560 px for embeds.
  Complete narrow rules follow that class, independent of the application window width.
- Narrow graphs retain at least 250 px height. Details fill the container beneath the graph.
  Short surfaces scroll vertically so controls remain reachable. The vertical resizer is hidden.
- Sidebar dragging changes a CSS custom property, leaving CSS free to override narrow sizing.
- Paper actions wrap within the card. Interactive controls must never depend on hidden overflow.
- Similarity scope controls contain scope, result limit, and retry actions. Their loading, error,
  empty, and result summaries belong in the top info bar. Citation evidence availability is separate
  from text-ranked candidate membership.
- Restore layout, comparison, filters, year slider/readout, and viewport together. Use silent state
  restoration; action callbacks are for user intent.
- Use setHoverHint from src/hover-hint.ts for control hover hints. It uses the Obsidian tooltip;
  never combine a native title with an aria-label tooltip. Keep hints concise and update them with
  action state. Graph-positioned paper previews remain owned by the canvas.
- Use createCountControl from src/count-control.ts for paper-count menus in panes and embeds.
  Pair a labeled numeric input with a compact preset dropdown; share sizing, keyboard behavior,
  validation, and disabled state. Keep defaults, presets, and bounds appropriate to the workflow.
- Keep labels, pressed/expanded state, keyboard focus, and inline error announcements accessible.
- Respect Obsidian colors. Hardcoded fallback colors exist for standalone previews; add no fixed
  palette that overrides a user's theme.

## Information placement and relevance

Use src/info-bar.ts for the pane and embed top info bar. Do not write directly to its DOM element
or add a second task-status paragraph inside the graph controls.

| Information | Placement and lifetime |
| --- | --- |
| Active view and result counts | Top info bar; update with mode, comparison, scope, project, or results. |
| Active task progress | Top info bar while that task runs; clear on completion or cancellation. |
| Actionable task failure | Top info bar with the reason; retain until retry, a new task, or context change. Keep recovery controls beside the action. |
| Explicit action confirmation | Brief top-bar success notice, then return to the current summary. Opening or restoring a project needs no persistent announcement. |
| Word-overlap fallback counts and explanatory detail | Shared hover hint on the Text summary; omit from Citations and other modes. |
| Paper metadata, evidence, reading/save failures | Selected-paper details beside the affected control. |
| Empty workspace guidance | The empty graph surface; describe the next action for the active method. |
| Provider diagnostics and sampling limitations | Info/help panel for the active workflow; signal partial graph results in the top summary. |

Priority is actionable error, active progress, explicit success, current result summary, then incidental
notice. Explicit success and incidental notices expire after four seconds. A background result update
must not erase a task error. Changing method, layout, comparison, question, project, or analysis tab
invalidates notices from the previous context. Async work must still check its generation/context
before publishing a message. Dispose status timers with the owning surface.

Keep summaries short: mode plus useful counts, rather than repeating the full seed title, authors,
and year. Similarity scope counts describe the candidate pool; changing Text/Citations must not
imply that the candidate pool changed. Show citation-loading failures only in Citations, library
retrieval failures only while Similarity is active, and embedding diagnostics only for Text similarity.
Local screening and PDF search must not inherit citation-workflow diagnostics.

The browser maintenance suite exercises narrow containers inside a wide desktop viewport,
pane/embed sizing, light/dark token paths, workflow failures, retries, navigation, and restoration.
Host acceptance should also cover Reading view, Live Preview, popouts, keyboard selection, and the
actual themes in use. Browser fixtures do not substitute for the full host matrix.
