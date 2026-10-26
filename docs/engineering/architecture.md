# Architecture and code map

Research Connected is a desktop Obsidian plugin built from TypeScript into one CommonJS bundle.
The pane and Markdown embed share rendering and paper behavior while keeping their host mounting
and sizing separate. There is no separate backend owned by this plugin.

## Modules and responsibilities

| Responsibility | Module |
| --- | --- |
| Plugin lifecycle and settings persistence | src/main.ts, src/settings.ts, src/settings-model.ts |
| Obsidian pane and Markdown mounting | src/view.ts, src/embed-block.ts |
| Pane and embed composition | src/app.ts, src/embed-mount.ts |
| Mode-aware top status and hover hints | src/info-bar.ts, src/hover-hint.ts |
| Shared graph controls and paper details | src/graph-surface.ts, src/graph-chrome.ts, src/detail-cards.ts, src/paper-actions.ts |
| Canvas drawing and interaction | src/map-canvas.ts, src/node-popover.ts |
| Layout, relationships, and candidate selection | src/layout*.ts, src/similarity.ts, src/diversity.ts, src/neighborhood.ts |
| Work identity and project snapshots | src/work-identity.ts, src/project-state.ts, src/graph-edit.ts |
| Reading changes and final view saves | src/workflow/reading-state.ts, src/workflow/project-save.ts |
| Text/citation comparison and retrieval UI | src/paper-comparison.ts, src/similarity-search.ts, src/similarity-explorer.ts |
| Scholarly source adapters | src/openalex.ts, src/citation-sources.ts, src/obsidian-http.ts |
| Literature notes and optional host integration | src/vault-note.ts, src/library-bridge.ts |
| Question-scoped discovery | src/question-workspace.ts, src/discovery-graph.ts |
| Optional research narrative | src/narrative.ts, src/llm.ts |

The source root retains stable domain module names; workflow modules concentrate coordination that
was previously repeated between the pane, lists, and embed. Group code when ownership and behavior
can move together. Avoid file moves whose only effect is adding indirection to imports.

## State and effects

**Paper** means one project-local work with traceable source records. Work identity logic owns
alias resolution; UI modules do not infer identity from a similar title.

**Project** means a saved citation graph and its paper states, deep dives, views, and explicit
question memberships. Transient local discovery and similarity pools must not replace its snapshot.

**View** means layout, comparison kind, distance scale, filters, selection, viewport, and collapsed
panels. Restoration uses a silent chrome Interface so applying saved state does not simulate user
clicks or independently schedule a partially restored view. The map and year controls are restored
from the same value. Pending debounced view changes are captured before disposal or project switches.

The **reading-state Module** serializes same-paper changes behind one Interface. Its Implementation
persists the project, synchronizes a matching note, and persists compensation on note-sync failure.
If compensation also fails, ReadingSaveError carries the last confirmed saved value. The UI presents
that value and an inline error instead of claiming a successful rollback. Its Locality keeps failure
ordering and recovery in one place. The pane and embed are two Adapters at this Seam.
While a reading change is pending, project notifications must not re-import older frontmatter
or replace the active reading control. Partial saves expose an explicit note-sync retry.

Plugin saveData calls are serialized in main.ts. Credentials share Obsidian's plugin data file and
are not encrypted. User project data never belongs in repository fixtures or screenshots.

## Dependency direction

Pure graph calculations accept data and return data. They do not access Obsidian, DOM, or HTTP.
Source/persistence Adapters do not import UI mounting code. The composition modules connect these
Seams; tests/contracts/architecture.mjs checks the existing semantic core and adapter direction.

The optional LibraryBridge supplies local holdings, text evidence, and discovery capabilities.
Missing capabilities must leave citation exploration usable. Retrieval UI distinguishes pending,
failed, empty, and ready results and exposes retry and compared/displayed counts.

## Repository layout and generated files

| Path | Purpose |
| --- | --- |
| src/ | Production TypeScript and shared workflow Modules |
| preview/ | Standalone pane/embed pages and deterministic source fixtures |
| tests/unit/ | Offline semantic and workflow checks |
| tests/browser/ | Real-DOM behavior and responsive checks |
| tests/contracts/ | Dependency, settings, documentation-link and UI contracts |
| tests/support/ | Browser/offline Obsidian helpers |
| tests/live/ | Explicit opt-in checks against real scholarly APIs |
| benchmarks/ | Deterministic compute benchmarks and ranking experiments |
| scripts/ | Development orchestration, including the headless browser runner |
| docs/engineering/ | Current maintenance guidance |
| docs/archive/ | Earlier proposals, audits, plans and design prototypes |
| .cache/ | Ignored test bundles and browser failure screenshots |

main.js and styles.css are tracked release assets. Edit TypeScript and the stylesheet source;
rebuild main.js with npm run build. Preview JavaScript and .cache bundles are generated and ignored.

## Verification

npm test runs lint, offline/contracts, and all browser suites. Browser checks serve an ephemeral
loopback origin, block external requests, and use isolated contexts. Release and pull-request CI
install pinned Playwright Chromium and run the same checks. Explicit live verification is separate.

The benchmark measures synthetic computation, not browser frame rate or network latency. Reusing an
unchanged graph avoids computing a layout whose coordinates would be discarded. Continuous canvas
animation pauses while the document is hidden or reduced motion is requested; interaction state
remains usable. Large initial planar layouts still run synchronously; profile browser long tasks
before introducing a worker or changing layout semantics.
