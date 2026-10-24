# Optional library integration

The local build accepts a version 1 library bridge supplied by another Obsidian plugin. The graph
continues to work when no bridge is installed. Network requests, holdings and credentials belong
to the supplying plugin; they are not added to Research Connected settings or saved graph snapshots.

`src/library-bridge.ts` defines the contract. Research Connected dispatches a synchronous
`research-connected-library-request` custom event on `window`, with a mutable `detail` object.
The host assigns `detail.bridge` with:

- `version: 1`.
- `read(paper)`: a synchronous, indexed lookup returning current local holdings and already-cached
  provider results. It must not start network requests or write source records; rendering calls it
  frequently. Paper records/DOI aliases should be considered when matching.
- `check(paper, { provider, refresh, local })`: an asynchronous availability check. The details panel
  calls it only after an explicit button click, with `provider` equal to `oa` or `scihub` and
  `refresh: true`. Providers report links, not verified downloads.
- `open(note)`: open a vault-relative library note.

The host dispatches `research-connected-library-changed` when holdings, cached results or bridge
availability change. The graph redraws badges and refreshes the selected paper. Remove the request
listener on host unload, then emit the change event. Research Connected removes its change listener
when its view is destroyed. The bridge currently targets the full graph pane; note embeds retain
their existing behavior.

Local states are `held` (a primary source file actually exists), `note-only`, `absent` (no matching
library note), and `ambiguous` (multiple notes match). Node badges use H, N, −, and ? respectively.
Available OA/Sci-Hub links receive O/S badges. Provider failures, unchecked providers and no-result
responses remain distinct in the details panel. Node colors retain their original meaning.
The host may include `local.matchedBy` (`doi`, `openalex`, or `title`); the details panel displays
this basis. `local.files` contains vault-relative full-text paths, opened through the same `open`
callback as notes. Standalone full texts may have `local.note: null`. A host must not count a
remote URL, a metadata sidecar or a note without its full text as a held paper.

## Local discovery graphs

The optional `bridge.discovery` extension supplies `context()` (question and paper selectors) and
`run(request)` (an asynchronous local discovery request). `src/discovery-graph.ts` defines the
request/result DTOs. Requests support ASReview `rank`/`similar`, and PaperQA2 selected-PDF
`index`/`search`; graph generation never requests a model answer. Runners and Python environment
settings remain in the host plugin. Missing dependencies or training labels surface as errors.

`research-connected-open-discovery` accepts `detail.payload` (existing results) or `detail.paper`
(preselect a source note); the plugin sets `detail.handled` synchronously and opens the related-paper
workspace. Results use exact local note/file identities (`local:<vault-relative path>`). A host
recognizes these with `matchedBy: file`, including DOI-less papers. The workspace has radial,
planar and timeline layouts, local holdings badges and availability actions.

Query/source membership edges contain no citation evidence. Priority, TF-IDF similarity and retrieval
order remain separate signals; result-to-result relationships are not inferred. Retrieval positions
are not converted into similarity scores. Unranked training examples, duplicate results, unsafe
paths and zero-overlap similarity matches are omitted. Sessions do not modify saved citation
projects, source records, observations or screening labels.

Remote data is ephemeral and must expire in the host. Failure to query a provider must not imply
that a paper cannot be obtained. Credentials must not appear in returned URLs or error messages.
The graph only opens HTTP(S) links without embedded credentials. Holdings and provider responses
are deliberately not persisted with graph projects.

## Background open-access checks

An optional `bridge.prefetch(papers)` schedules OA checks for displayed graph nodes. Both citation
and discovery views call it when their graph changes, and details panels call it for the selected
paper. `read()` stays synchronous and never starts network work. The host owns automatic-check
preferences, deduplication, batching, cache freshness, retries and worker lifetime. This extension
never triggers Sci-Hub requests.

Provider results may include `links: [{ url, kind }]` (PDF and landing-page alternatives), `stale`,
`checking`, and `refreshError`. Details preserve old links while the host refreshes them and show
stale/refreshing/error indicators. The host emits coalesced library-change events so maps update
badges without refreshing or rebuilding citation data. Research Vault implements this with one
reusable background Node worker and batches of up to 20 DOIs; it does not import its ESM research
toolchain into Obsidian's renderer.
