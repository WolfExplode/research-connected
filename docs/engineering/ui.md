# Pane and embed UI contract

The graph is the primary workspace, with paper details and evidence beside it. Pane and note embed
share graph chrome, detail cards, paper actions, and Obsidian theme tokens. Host-specific search,
placement, and heavy actions stay with their respective mounting code.

- src/responsive.ts determines narrow mode from the surface width: 780 px for panes, 560 px for embeds.
  Complete narrow rules follow that class, independent of the application window width.
- Narrow graphs retain at least 250 px height. Details fill the container beneath the graph.
  Short surfaces scroll vertically so controls remain reachable. The vertical resizer is hidden.
- Sidebar dragging changes a CSS custom property, leaving CSS free to override narrow sizing.
- Paper actions wrap within the card. Interactive controls must never depend on hidden overflow.
- Similarity scope controls show loading/error/empty states, counts, and retry. Citation evidence
  availability is separate from text-ranked candidate membership.
- Restore layout, comparison, filters, year slider/readout, and viewport together. Use silent state
  restoration; action callbacks are for user intent.
- Keep labels, pressed/expanded state, keyboard focus, and inline error announcements accessible.
- Respect Obsidian colors. Hardcoded fallback colors exist for standalone previews; add no fixed
  palette that overrides a user's theme.

The browser maintenance suite exercises narrow containers inside a wide desktop viewport,
pane/embed sizing, light/dark token paths, workflow failures, retries, navigation, and restoration.
Host acceptance should also cover Reading view, Live Preview, popouts, keyboard selection, and the
actual themes in use. Browser fixtures do not substitute for the full host matrix.
