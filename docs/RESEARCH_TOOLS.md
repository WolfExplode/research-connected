# Research tools

Research Connected's paper library runs on the research repository's command-line tools
(`Tools/research/cli.js` in cardiology-research-library). The citation graph works without them;
holdings, Save and Bookmark, availability, SPECTER2 vectors, discovery and labels need them.

## Setup

In settings, **Research tools repository** names the folder containing `Tools/research/cli.js`;
empty uses the folder that contains the vault. **Node executable** runs the tools (a path, or a
command on PATH). The setting's description reports whether the tools were found. A checkout
without `Tools/research/discover.js` is too old and is reported as such, rather than failing per
action.

The research CLI owns Python and model keys: ASReview and PaperQA2 environments are found under
the repository's `.cache/research-tools/` (or `RESEARCH_ASREVIEW_PYTHON` /
`RESEARCH_PAPERQA_PYTHON`), and a DeepSeek key in `.deepseek-key` or the environment. Research
Connected never runs Python. Its child processes receive its OpenAlex and Semantic Scholar keys
and its contact email (`RESEARCH_MAILTO`); keys flow one way.

## Process boundary

The plugin reaches the toolchain only through processes (`src/research-tools.ts`):

- `node Tools/research/cli.js <command> --vault <vault> --json` for `keep`, `availability`,
  `embeddings` and `discover`. Larger inputs (DOI lists, selections, fetched evidence) go on stdin.
- One long-lived availability worker (`Tools/research/availability-worker.js`) speaking JSONL:
  OpenAlex checks of up to 20 DOIs, and cache-only reads of up to 500 DOIs.

Repository modules are never loaded into Obsidian's renderer. The JSON shapes are pinned by
`tests/research-connected-contract.test.js` in the research repository and by the fake CLI in
`tests/unit/verify-research-library.ts` here. Every workflow the plugin runs is a CLI command an
agent can run the same way; there is no Obsidian-only path to a result.

## Ownership

The research tools are the only writer of paper notes, sidecars, acquired files and caches. The
plugin orchestrates and renders. Its own vault writes are frontmatter edits through Obsidian:
bookmarks on existing notes and the **Label this paper** form, which writes only changed
properties. Without research tools, Save and Bookmark explain what to set up and write nothing.

Labels, bookmarks, reading state and question relevance live in note frontmatter, never in plugin
data. Plugin data holds graph projects, views, settings and credentials.

## The library service

`src/research-library.ts` (`ResearchLibrary`) implements `PaperLibraryService`
(`src/library-panel.ts`), the interface graphs, embeds and details panels use. Its parts:

- **Holdings.** An index of vault notes and full-text files, rebuilt when a relevant note or file
  changes. Papers match by exact local path, DOI, OpenAlex id, then exact long title agreeing on
  year. Several matches are `ambiguous` and never merged. Local states are `held` (a primary full
  text exists), `note-only`, `absent` and `ambiguous`; node badges use H, N, −, and ?. Explicit
  `pdf`/`fulltext`/`full_text` properties can point to files in other folders. A remote URL, a
  sidecar or a note without its full text is not a held paper. `read()` is synchronous and never
  starts network work.
- **Availability.** One background open-access queue for every pane and embed: deduplicated,
  20 DOIs per batch, one batch in flight, paused after a provider failure. Stored results are read
  once per graph through the worker. OA links stay fresh for seven days, no-result and Sci-Hub
  entries for a day, failures for five minutes; old links stay visible as stale while refreshing.
  Sci-Hub checks are explicit only. Providers report links, not verified downloads.
- **Save and Bookmark.** Mutations are serialized; concurrent Saves of one paper share one
  acquisition through `research keep`. A note-only outcome with a reason is a completed result.
  Confirmed state is returned before Obsidian indexes the tool's write.
- **SPECTER2.** Stored vectors are read once per DOI through `embeddings --cached`; only DOIs
  without a vector or a recent provider answer are downloaded, in batches of 100. A failed batch
  pauses downloads for 15 minutes.
- **Fetched evidence.** Vectors from a graph build's Semantic Scholar batch and OpenAlex
  open-access fields are stored through `embeddings --store` and `availability --store`, so the
  CLI never downloads them a second time.
- **Discovery.** `discovery.context()` lists questions and papers; `discovery.run()` maps a
  request to `research discover rank|similar|index|search`. Graph generation never asks a model.

Open graphs refresh through a private `research-connected-library-changed` window event, emitted
once per burst and only for changes they can show (DOI, files, bookmark, reading status and
similar), not for reading-notes edits.

## Explore and local results

The main workspace selects question notes from `discovery.context().questions`. Saved citation
graphs carry explicit `questionPaths` memberships; old graphs start unassigned, and a graph can
be reused by several questions. Its snapshot, views and exclusions remain shared; bookmarks belong to vault notes.
`activeQuestion` remembers the selected note path. The main **Explore** selector switches between
Explore citations, Find similar papers, Screen papers and Search PDFs. All use the same question
selector, canvas, layout controls and paper details panel. Only method-specific inputs are shown.
Changing method retains the citation graph and caches local results for the session; late tool
responses are ignored after a context switch or disposal. Local results never enter saved citation
snapshots, and citation-editing controls are hidden while displaying them.

Find similar papers compares whole-library text through `textLibrary()`; wider-literature
retrieval uses Research Connected's own OpenAlex adapter. `research-connected-open-discovery`
accepts `detail.paper` (preselect a source note) or `{ question, mode: "rank" | "search" }`.
Old discovery tabs redirect there. Results use exact local identities (`local:<vault-relative path>`).

Query/source membership edges contain no citation evidence. Priority, similarity and retrieval
order remain separate signals; result-to-result relationships are not inferred. Retrieval positions
are not converted into similarity scores. Unranked training examples, duplicate results, unsafe
paths and zero-overlap similarity matches are omitted. Sessions do not modify saved citation
projects, source records, observations or screening labels.

Failure to query a provider must not imply that a paper cannot be obtained. Credentials must not
appear in returned URLs or error messages. The graph only opens HTTP(S) links without embedded
credentials. Holdings and provider responses are not persisted with graph projects.
