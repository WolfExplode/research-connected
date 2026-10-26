# Research Connected — User and technical guide

An Obsidian plugin that draws a **similarity map** for one seed paper, in the spirit of [Connected Papers](https://www.connectedpapers.com/). The product is an interactive 2D canvas graph in its own pane and inside notes.

This release supports **Obsidian desktop 1.14.4 or newer**. Mobile support will be enabled after testing on mobile devices.

It is not a sidebar of citation cards. Reference Map / Literature Flow–style index lists are an explicit non-goal. This project is not affiliated with Connected Papers.

## Rename

The display name is **Research Connected**. The plugin id is `research-connected`.

Earlier builds used the id `connected-papers-openalex` and the folder `<vault>/.obsidian/plugins/connected-papers-openalex/`. That id does not carry over. After you install this build:

1. Turn off **Connected Papers (OpenAlex)** if it is still enabled.
2. Remove the old folder `connected-papers-openalex`.
3. Enable **Research Connected** from `research-connected`.

Plugin settings (the OpenAlex API key) live in that folder’s `data.json`. Copy the old `data.json` into the new folder before you reload if you want to keep the key. Notes that already use a `connected-papers` fence keep working. `research-connected` is the same fence.

The graph is built from the public [OpenAlex](https://openalex.org/) works API.

Open **Graph options** beside the zoom and reload controls to change **Diversify results**.
It is on by default and makes room for different candidates by penalizing overlap with papers
already selected. Turning it off removes that penalty; the existing relevance ranking, source
quotas, and node limit still apply. Changes are saved as a plugin preference and rebuild the
current citation graph, including in note embeds. Local discovery results do not use this rule,
so the control is disabled there. This option does not search additional local papers.

## Network use and local data

Building a graph or searching for a paper sends its DOI, OpenAlex ID, or search text to OpenAlex. The plugin also queries Semantic Scholar to cross-check metadata and fill missing references or abstracts, Crossref for remaining DOI-based gaps, and OpenCitations for citation evidence between papers on the graph. These requests send paper identifiers and, if configured, the relevant service's API key or token. Clicking **Find DOI** sends the title and available citation details to Crossref, with a title search through Europe PMC as a fallback. A contact email, if provided, is sent to Crossref and as a legacy `mailto` parameter to OpenAlex. External links open OpenAlex or DOI pages in the browser.

The optional research narrative is off by default. Only when you click Generate does it send the selected papers and their available citation evidence to the LLM endpoint you configure; abstracts are included only if you enable that setting. Research projects, reading and exclusion states, saved views, and service credentials are stored in this vault's plugin `data.json`; credentials are not encrypted. The plugin does not send usage telemetry. See [Settings](#settings) for the limits and behavior of each service.

The source code is available under the [MIT License](../LICENSE).

## Interface language

The graph pane, note embeds, settings, controls, and plugin messages follow Obsidian's interface language. Simplified Chinese is used for Chinese locales; English is used for other locales. Reload the plugin after changing Obsidian's language. Paper titles, author names, abstracts, and saved user content retain their original language.

## Build

```bash
npm install
npm run build
```

`npm run build` typechecks, then bundles `src/main.ts` to `main.js`. You need Node 18+.

Loadable plugin files:

| File | Role |
| --- | --- |
| `main.js` | Bundled plugin (generated) |
| `manifest.json` | Plugin id `research-connected` |
| `styles.css` | Pane styles |

## Install

1. Build the plugin (above).
2. Copy `main.js`, `manifest.json`, and `styles.css` into:

   ```text
   <vault>/.obsidian/plugins/research-connected/
   ```

3. Reload Obsidian (or restart it). If a previous copy failed to load, replace `main.js` and `manifest.json` with this build, reload, then turn the plugin off and on again.
4. Settings → Community plugins → turn on **Research Connected**.

Restricted mode must be off, or Obsidian will not load community plugins.

## Usage

1. Command palette → **Open Research Connected** (the command name follows Obsidian's interface language).
   The same command is on the ribbon (git-fork icon).
   The view opens as a **main-area tab** titled “Research Connected”, not in the sidebars.
2. In the pane, enter a seed:
   - DOI (`10.1038/nature14539` or `https://doi.org/...`)
   - OpenAlex work id (`W2919115771`) or an `openalex.org` work URL
   - or a title. Title search shows up to 8 hits; click one to make it the seed.
3. Press **Build** to load the map.
4. The seed sits in the middle with a double ring and a halo. Other papers are placed by similarity:
   - in **Network**, node colors identify detected citation-structure groups; in **Timeline** and **Similarity**, color shows topic similarity to the seed
   - node size follows year-normalized citation counts; classics in the sampled graph receive a subtle glow
   - line weight follows the relation score
5. Drag a node to move it. Drag the background to pan. Scroll to zoom. **+ / − / Fit to view** zoom and fit the map. On touch screens, pinch with two fingers to zoom. With the canvas focused, the arrow keys pan, `+` / `-` zoom, and `0` or `F` fits.
6. Hover a node for its title. Click it for the detail sheet: title, authors, year, citation count, how it relates to the seed, a short abstract, **OpenAlex**, and **DOI** when a DOI exists.

When the **Library and full text** panel has no DOI, click **Find DOI**. This sends the paper's title and available citation details to Crossref, then searches Europe PMC if Crossref has no verified match. Recovery requires the full title, a compatible year, and corroborating first-author or volume/page information. Multiple matching DOIs are shown for review without assigning one. Verified results, their source, and recent misses are saved in plugin settings; source notes are not edited. A recovered DOI immediately enables availability checks. **Retry DOI search** makes a fresh request; opening a paper does not start a DOI search. Recent misses expire after one day.
   Those links open with `window.open`. Only `https://openalex.org` and `https://doi.org` URLs are opened. The bundle does not call Electron.
7. Chinese titles render with the interface font plus a CJK fallback stack. Controls and command names follow Obsidian's interface language.

The project and view controls beneath the search box save the current graph and camera position locally. The bottom status bar has **Undo** after a node exclusion or deep expansion, and **Inspect** for looking up a DOI or OpenAlex ID. Inspection uses this map's retained sample: it can identify filtered or unselected candidates, but cannot determine why a work outside the sample was absent from OpenAlex results.

While a request is in flight the button reads **Building…**. Failures (unknown id, exhausted budget, network) show a banner and leave the previous map in place.

## Embed a graph in a note

A fenced block renders the same neighborhood as an interactive **2D canvas** graph inside the note. The language can be `connected-papers` or `research-connected`. Reading view and Live Preview both mount it. While the cursor is inside the fence, Obsidian shows the source; leaving the block builds the graph again — the zoom, filters, and layout you chose are remembered across that rebuild. The command-palette pane uses the same canvas renderer.

The fence is the anchor in the note. `position` changes how that block sits among the surrounding paragraphs. It does not teleport the graph to another heading.

````markdown
```connected-papers
doi: 10.1038/nature14539
# optional
position: inline
width: 100%
height: 520
align: center
labels: author-year
maxNodes: 40
depth: 1
```
````

| Line | Required | Meaning |
| --- | --- | --- |
| `doi:` | one seed | DOI, with or without `https://doi.org/`. |
| `openalex:` / `id:` / `seed:` | one seed | OpenAlex work id (`W2919115771`) or a DOI. A bare DOI or `W…` id on its own line also works. |
| `position:` | no | `inline` (default, in the column), `float-left`, `float-right` (beside the following text), or `full` (clear floats and span the note column). |
| `width:` | no | `420`, `420px` (240–1400), `60%` (30–100), `24em`, or `24rem`. Default `100%`. Floats default to `420px` when `width` is omitted. |
| `height:` | no | Graph area in pixels, clamped to 280–900. Default **480**. |
| `align:` | no | `left` (default), `center`, or `right`. Centers or right-aligns a block that is narrower than the column. Ignored for floats. |
| `labels:` | no | `author-year` (default: family name and year on each node), `title`, `both`, or `off`. Overlapping labels drop out; the seed, the selection, and the node under the pointer stay. |
| `maxNodes:` | no | 20–300. Overrides the setting for this block only. Default is the setting (50). |
| `depth:` | no | `1` (default) is the seed neighborhood. `2` also samples references of the two closest papers, up to the node cap. |
| `yearFrom:` / `yearTo:` | no | Inclusive year range for the other papers. The seed stays. If both are set and reversed, they are swapped. |
| `language:` / `type:` / `concept:` | no | Preset filters. They apply only when OpenAlex included that field (`language`, `type`, `concepts`). |
| `minCoCite:` / `minShared:` | no | Hide co-citation edges below that count, and coupling edges below that shared-reference count. Default 1. |
| `layout:` | no | `temporal` (default; year on X), `radial` (Similarity view; distance from seed = similarity), or `force2d` (Network force layout grouped by detected citation communities). Legacy `kumu` / `community` and `force3d` values map to `force2d`. |
| `color:` | no | `topic` (default outside Network), `community` (default in Network), `graph` (citation-count ramp), or `year`. |

`full` widens the block by Obsidian’s `--file-margins` (no effect when that variable is 0, as in the dev preview). Title search is not available in the fence. Use the command pane for that. Lines starting with `#` are comments.

Nodes show **author + year** by default. The full title is the hover tooltip and the evidence panel. Both surfaces use a left rail for layout choices and the graph key/filter controls, a central canvas, and a right-side **Paper details & evidence** panel. The panel also contains prior/derivative lists, bookmarks, and optional research narrative. The left and right rails can collapse; in narrow panes the evidence panel moves below the graph. Export actions are grouped under **Export**. The note embed keeps a compact detail sheet to preserve reading width.

Drag pans the graph. A plain scroll wheel scrolls the note past the graph; hold **⌘/Ctrl** and scroll — or pinch on a trackpad — to zoom, as do **+ / − / Fit to view**. On touch screens one finger scrolls the note and a two-finger pinch zooms and pans. The embed grip at the bottom-right changes the graph area’s width and height after it opens (with the grip focused, the arrow keys resize in steps, faster with Shift); `width` and `height` in the fence are only the starting size. The command pane fills its tab and has no grip.

**Reload** fetches again and skips the short in-memory cache. Click a node for its title, year, citation count, why it connects to the seed, a short abstract, and **OpenAlex** / **DOI** source buttons. Inside Obsidian the detail also offers **Open in graph**, which jumps to the full graph pane on the same seed. Hover or click an edge for that pair’s explanation.

Citation edges are arrows (A cites B; mutual cites get both heads). Co-citation and coupling stay undirected. Thickness is three steps, **weak / medium / strong**, matching the graph key. Weak edges start hidden. Hovering or selecting a node highlights its visible one-hop neighbors; press **Shift + arrow** to select a nearby node by direction. Right-click a node for **Exclude**, **Deep dive**, or **Set as seed**. Deep-dug members are remembered per seed and restored on rebuild. Hover or click an edge for the evidence detail: shared-reference count, co-citation count, sources, and the caveat that citation lists can be incomplete.

After the graph loads, language, work type, and concept filters appear only when at least one paper has that OpenAlex field. Node size is normalized by publication year and citation count. Author–year labels stay.

The layout modes are **Network**, **Timeline**, and **Similarity map**. **Timeline** maps publication year linearly from left to right; unknown-year works sit in a separate left gutter. Vertical position follows log citation count, with small offsets to separate overlaps. **Similarity** places papers closer to the seed when the selected Text or Citations score is higher. The comparison paper stays fixed at the center. Dragging another paper rotates it around its score-defined orbit without changing its distance or score. Subtle guide rings provide distance references; missing scores sit separately under “Insufficient data.” Only the center and active papers are labeled, and the active paper has a simple guide line to the center. Select a paper to inspect score details or choose “Compare against this paper” to rebuild around it. Citation edges remain available in Network and Timeline. Similarity is unavailable for ASReview screening and PDF retrieval, whose ranks are not similarity scores. **Network** uses a force layout and groups nodes by communities detected from the sampled citation/similarity graph; node color denotes that algorithmic grouping, not a definitive scholarly school. Outside Network, node color shows topic similarity to the seed; missing topic metadata is gray. Node size uses citations normalized by publication year. The year scrubber filters papers after the chosen year; **Play** advances one year at a time.

**Similarity subviews.** Select **Text** or **Citations** beneath Similarity. Text uses 75% SPECTER2 cosine plus 25% word overlap when both vectors are available; otherwise it uses word overlap with an explicit fallback label in details. Inputs are titles and abstracts, or stored study summaries when abstracts are missing. Pair scores stay stable when candidates are added. With the updated Research Vault bridge, cached vectors are read first and missing DOI embeddings are downloaded automatically in the background. Local vectors persist in source sidecars; external vectors use the DOI disk cache. Scores update on completion. Research Vault settings can disable automatic SPECTER2 downloads. Download status appears in the active workflow’s diagnostics; provider failures pause requests for 15 minutes and unavailable results are cached for seven days. Embedding lookup does not upload PDFs or summaries; Wider literature search sends the source title and abstract or summary as described below. Graph builds can also request Semantic Scholar vectors when enabled. Citations uses 55% shared-reference similarity, 35% co-citation, and 10% direct citation, with no text contribution. The same center, papers, selection, angular positions, and viewport remain when switching. Scores are decimals, not probabilities. Library-only papers remain visible in Citations with unavailable evidence; membership edges never become citation claims. The method is remembered in saved views; Network and Timeline retain their separate graph selection score. Rerun old Discovery results to replace legacy TF-IDF scores.

**Find similar papers.** Choose this task in the top selector, then enter a source DOI, OpenAlex ID, title, or select a library paper. The same task is available in note embeds using their existing source paper. Choose **My library**, **Wider literature**, or **Both**. My library compares source notes supplied by the Research Vault bridge, including notes without a PDF, DOI, or embedding. Wider literature sends the source title and abstract (or local study summary) to OpenAlex semantic search, which returns at most 50 candidates per query. These can be outside the current citation neighborhood. The plugin then reranks candidates using its Text score; it does not treat the provider's retrieval score as SPECTER2 similarity. Both merges matching DOI/OpenAlex identities and reuses local evidence. The Show count limits display; a larger value does not expand OpenAlex's 50-candidate query limit. Successful requests are cached for the current pane/embed session; Find similar papers reruns the current query, and failures expose a retry action. This is a candidate search, not an exhaustive or guaranteed globally nearest result set.

**Tasks and views.** The top selector contains **Explore citations**, **Find similar papers**, **Screen papers**, and **Search PDFs**. ASReview and PaperQA2 power screening and PDF retrieval respectively. **Network**, **Timeline**, and **Similarity map** in the sidebar only change presentation and preserve the current paper set. Switching Text/Citations preserves membership as well. Enter Find similar papers explicitly to retrieve a different pool. Search results are transient; returning to Explore citations restores the citation session without replacing its saved snapshot. Legacy local-similarity links and companion results open the unified Find similar papers task.

**Citation connections in Similarity.** In **Citations**, hover or select a paper to show its recorded citation, co-citation and bibliographic-coupling connections in the same colors as Network. Click a connection for its evidence. Enable **Graph options → Show all connections** to display all available connections between shown papers. Legend counts reflect the connections currently displayed and respect the relation filters. Papers without citation evidence have no inferred connections. Text keeps connections hidden; orbit distances continue to follow the selected similarity score.

**Distance scale.** This control appears in **Graph options** only in Similarity mode. **Relative** (default) spreads the displayed score range across the rings. It highlights differences within this result set, including small differences. **Absolute** uses the fixed 0–1 scale for consistent distances between graphs. Actual scores, ranking, selection, angles, and zoom stay unchanged. Equal scores share an orbit; missing scores remain in the separate data-insufficient area. The scale is retained in saved views and embed view state.

**Prior work** lists papers often cited by the current subgraph (how many visible papers’ reference lists include them). **Later work** lists papers that often cite the current subgraph (how many visible papers appear in their reference list). Both are lists, not new edge types. A count below 2 is left out.

Edges stay thin neutral gray by default; when you hover or select a node, its links take the color of the sharpest relation, not a blend. The graph key lists them:

| Color | Relation | What the text counts |
| --- | --- | --- |
| Gold | Direct citation | One paper lists the other, or they cite each other. |
| Teal | Co-citation | How many sampled citing papers list both. |
| Indigo | Bibliographic coupling | How many referenced works they share. |
| Gray | Weak link | A fallback link with none of the counts above. |

Thickness is the same three steps as the graph key (weak / medium / strong), not a continuous score. The same OpenAlex API key from settings is sent; without a key the small daily budget still applies, and a 429 is shown inside the block instead of freezing the editor.

`depth: 2` costs a few extra OpenAlex calls. If that second hop fails, the block keeps the depth-1 graph and says so.

## Save and Bookmark

**Save** adds a paper to your vault library and attempts to obtain its full text. With Research
Vault installed, it uses the existing acquisition tools: create or reuse the source note, try
open-access routes, validate the file, and file it beside the note. A failed attempt keeps the note
with `needs_reason`, `acquisition_status`, and `acquisition_attempted_at`; use **Retry download** or
import a copy later. Already-held full text shows **In library**. Without the acquisition bridge,
the note is still retained and records `download-unavailable`.

**Bookmark** is a separate shortlist. It sets `bookmark: true` in the library note, creating a
metadata-only note when necessary, without downloading. Unbookmarking keeps the note, files, and
reading notes. The bookmark button in the top workspace toolbar opens the same vault-wide list
from any task. Bookmarks can be exported and organized using question links in the library;
changing graphs or questions does not change the flag. Exclude remains project-scoped and never
means delete or a negative question judgment.

Old project saved-paper entries migrate to vault bookmarks on startup, after a plugin-data backup.
An existing note's bookmark choice wins. Failed entries remain available under legacy bookmarks;
use **Retry migration** or the **Migrate legacy bookmarks to library** command. Legacy `favorite`
properties are read compatibly and migrate to `bookmark`.

## Literature notes

Select a paper, then choose **Export → Write to note**. With nothing selected, the seed is written. Outside Obsidian (the dev preview) the same action copies the note contents instead.

The note goes to **Literature note folder** (created if missing; empty means the vault root). A file with the same name gets a numeric suffix rather than being overwritten. The frontmatter is always written:

| Property | Value |
| --- | --- |
| `title`, `authors`, `year` | From OpenAlex. `authors` is one comma-separated string. |
| `doi` | Bare DOI, omitted when the work has none. |
| `openalex` | OpenAlex work URL. |
| `rc-project` | Research project name, or the seed ID when the project is unnamed. |
| `rc-status` | `unread`, `to-read`, or `read`. |

**Literature note filename** and **Literature note body** accept `{{title}}`, `{{authors}}`, `{{year}}`, `{{doi}}`, `{{openalex}}`, `{{relation}}` (how the paper relates to the seed), `{{project}}`, and `{{status}}`. The filename defaults to `{{year}} {{title}}`, drops `\ / : * ? " < > |`, and is cut to 80 characters. An empty body writes a `# title` heading.

The plugin recognizes notes already in the vault by DOI and OpenAlex frontmatter; conflicting matches require review. When a paper has a note, its details show **In your notes · Open note**. The note’s `reading_status` (or legacy `rc-status`) supplies its reading state; changing it in the panel or Prior / Later work cards synchronizes both properties. Bookmark and Save preserve existing reading notes and personal metadata.

## Settings

### Multiple evidence sources and optional LLM

OpenCitations checks and the Semantic Scholar and Crossref fallbacks work in both the graph pane and note embeds. The optional LLM research narrative is available only in the graph pane.

- **OpenCitations:** After building a graph, the plugin checks reference lists for up to 20 papers with DOIs, one at a time, and adds citation edges only between nodes already on the graph. It shows two sources only when OpenAlex also records a citation in the same direction. The status bar reports checks and failures; this is not exhaustive coverage. An access token can be entered in settings.
- **Semantic Scholar:** During graph construction, the plugin compares citation and reference counts in batches and flags large discrepancies in paper details. When an OpenAlex reference list is missing, Semantic Scholar references can fill it and contribute to edges, with their source identified. Opening a paper without an OpenAlex abstract triggers one Semantic Scholar abstract request; the result is labeled with its source. If neither service has an abstract, the detail says so. Requests are made per paper and cached for the session, without bulk abstract prefetching. An API key is optional.
- **Crossref:** For papers with DOIs whose reference lists remain empty after OpenAlex and Semantic Scholar, the plugin checks registered references for up to 12 papers per graph. Only references that match DOIs already on the graph contribute to similarity and citation edges, with Crossref identified as the source. If Semantic Scholar cannot supply an abstract, opening that paper can trigger a Crossref abstract request. Missing Crossref data does not affect the main graph; this is not complete reference recovery.
- **LLM disabled by default:** The research narrative control, generated content, and model requests are absent until you enable the feature and configure an endpoint and model. It supports JSON responses compatible with `chat/completions`. HTTPS is required by default; a local HTTP service is allowed. The API key is stored in the plugin's local `data.json`, not in an encrypted keychain.
- **Manual generation:** Only clicking Generate sends the seed, up to eight directly referenced papers, up to eight directly citing papers, and available citation evidence. Abstract sharing is off by default; retrieved citation context remains part of the evidence package. The narrative covers the sampled graph and does not follow the year slider. The plugin does not read full texts or claim a complete scholarly history.
- **Output checks:** The plugin validates JSON structure, paper IDs, and citation direction, and rejects papers outside the submitted evidence. This cannot prove every model statement correct; model self-assessment is not a statistical confidence score. The evidence snapshot can be opened for review, copied, or written to a new note. Disabling the feature does not delete notes you exported earlier.

Source queries use a five-minute session cache and serial rate limiting. A failed query leaves the existing graph in place. Model output stays in the current graph session; generating again calls the model again. Changing the seed or settings, or closing the view, prevents an older result from replacing the current narrative. Obsidian's `requestUrl` cannot physically cancel a request already sent, so requests have timeouts and stale results are discarded.

For development, `npm test` runs offline checks without network or model usage; `npm run verify` also checks OpenAlex live. After building the preview, `preview/index.html?fixture=1` uses offline data, and `&llm=1` shows a simulated narrative without calling a real model.

Settings → Research Connected.

| Setting | Default | What it does |
| --- | --- | --- |
| OpenAlex API key | empty | Sent as `Authorization: Bearer`. Stored only in local plugin data. |
| Contact email (`mailto`) | empty | No longer raises the OpenAlex limit; a valid address is sent to Crossref as contact information. |
| Maximum nodes | 50 (range 20–300) | Cap including the seed. 40–60 is the intended range; larger maps benefit from extended/deep sampling. Applied on the next build. |
| Include references | on | Seed's outgoing references. |
| Include citing works | on | Works that cite the seed, also used as co-citation context. |
| Include related works | on | OpenAlex `related_works` as extra candidate nodes. |
| Literature note folder | empty | Folder for **Write to note**. Empty is the vault root. See [Literature notes](#literature-notes). |
| Literature note filename | empty | Filename template. Empty is `{{year}} {{title}}`. |
| Literature note body | empty | Body template under the frontmatter. Empty is a title heading. |
| DOI property name | `doi` | Extra frontmatter property checked when matching existing notes. `doi` is always checked. |

Turn off every neighbor toggle and the pane asks you to enable one. The next build uses the new toggles; the current map is not rebuilt automatically.

### Authentication and limits

OpenAlex still answers **without a key**, on a small daily budget. A keyless response while this plugin was written reported `X-RateLimit-Limit: 1000` and `X-RateLimit-Limit-USD: 0.1`. The live numbers are whatever the API puts in `X-RateLimit-*` that day.

A free key from [openalex.org/settings/api](https://openalex.org/settings/api) raises that budget. OpenAlex documents the free key as about **10×** the keyless allowance. Past the budget, or above 100 requests/second, the API returns **HTTP 429**. The pane tells you to add a key or wait until the daily reset.

Since February 2026 OpenAlex **ignores `mailto`**. The email setting is still sent to older OpenAlex gateways but does **not** raise its limit; Crossref uses a valid email as contact information for its public API. An OpenAlex key is the way to get a higher OpenAlex budget. See [OpenAlex authentication](https://help.openalex.org/api/authentication/).

One map on standard sampling is a handful of calls: one work lookup, up to three list calls, and one or two batched id lookups. Deep sampling cursor-pages the reference and citation lists (100 works per page, up to 1,000 examined) and fetches more batched details. Without an OpenAlex API key, deep sampling stops after the first page and the status bar says so. Title search is a separate, slightly more expensive call.

## Algorithm

Connected Papers builds a similarity map from co-citation and bibliographic coupling over a large citation graph. This plugin approximates that with a **sampled** OpenAlex neighborhood. It is not a citation tree and not a ranked list.

1. Resolve the seed work.
2. Sample candidates (most-cited first when a sort applies). The **Sampling depth** setting picks the tier:
   - **standard** — up to 80 works the seed cites, 40 that cite it, 20 related works; about 5 requests per map
   - **extended** — up to 200 references and 200 citing works, 100 per page, 50 related
   - **deep** — references and citing works examined up to 1000 each (100 per page), 100 related; past the first page this needs an OpenAlex API key, otherwise the status bar reports that only the first page was read
3. Keep at most `Maximum nodes − 1` neighbors (20–300; pair anything above ~80 with extended or deep sampling so the pools can fill the slots):
   - records whose OpenAlex `type` is non-research (**book-review**, editorial, correction/erratum, letter, retraction, peer-review, paratext) are dropped first — a book review's title embeds the book ("…By Author. Publisher, year. Pp. …") and citations meant for the book land on the review, which would bend the map toward the wrong record; the status line reports how many were filtered. The seed itself is kept regardless of type, with a note in its detail sheet
   - related works first, capped near 22% of the slots (at least 6 when that many exist), so topic-neighbors cannot crowd out the citation structure
   - remaining slots split between references and citing works
   - unused quota is filled by citation count
   - the same work is kept once; a reference outranks a citing work, which outranks a related work
4. Batch-fetch `referenced_works` and `abstract_inverted_index` for the kept nodes and for the citing sample (the citing sample is the co-citation context even when a citer is not drawn).
5. Score every pair:

   ```text
   score = 0.55 * bibliographic coupling
         + 0.35 * co-citation
         + 0.10 * direct citation
   ```

   - **Bibliographic coupling** is the cosine of the two reference-id sets: `|A ∩ B| / sqrt(|A| |B|)`.
   - **Co-citation** counts how often both ids show up together in the reference lists of the sampled citing papers, normalized by `both / sqrt(countA * countB)`.
   - **Direct citation** is 1 when either work lists the other.
6. Edges, so the picture is a map rather than a star:
   - the seed links to its **7** nearest neighbors
   - every other node links to its **2** nearest neighbors with score ≥ **0.07**
   - a node with no edge still gets its single best link
7. Layout: seed fixed at the origin, other nodes start on a golden-angle spiral (radius from similarity to the seed), then a short force simulation. Springs are shorter for higher scores; nodes repel and cannot overlap. Dragging after that moves only the node you grab.

`related_works` in OpenAlex means “recent papers that share topics”, not a Connected Papers score. Related works are only **candidates**. Edge weight is always the score above.

Highly cited papers are sampled, not exhaustively expanded. With standard sampling a seed with tens of thousands of citations contributes its 40 most-cited citers, not the full citing set; deep sampling raises that to 1000. Co-citation is counted over the reference lists of at most 400 sampled citers, so deep sampling improves edge quality but never covers the whole citing population.

## Data quality: known OpenAlex issues

OpenAlex is the best free citation index, but published audits have found recurring defects. What they are, and what this plugin does about each:

| Known issue | What the plugin does |
| --- | --- |
| **Book reviews, editorials, corrections** are indexed as works; a book review's title embeds the reviewed book and citations meant for the book land on the review, so the record looks like a highly cited "paper" by the wrong author | Records whose `type` is non-research are dropped from the map (the status line reports the count); the seed is kept with a note. OpenAlex's `type` field is the reliable detector — title heuristics are not |
| **Retracted articles** stay in citation graphs and keep accumulating citations | `is_retracted` is fetched for every node; the detail sheet shows a prominent retraction warning. Retracted works are kept on the map (they are part of citation history) but flagged |
| **Missing abstracts** on a large share of records | Abstracts are reconstructed from `abstract_inverted_index` when present; otherwise the sheet asks Semantic Scholar once, and says so when neither source has one |
| **Incomplete reference lists** — OpenAlex captures fewer references than the original articles list (audits report roughly a fifth to a quarter missing on average, worse for older and non-English works) | When Semantic Scholar reports references for a node whose OpenAlex list is empty, the missing list is backfilled from S2 and takes part in scoring (the detail sheet says so, and the edge evidence credits Semantic Scholar). Coupling and co-citation remain approximations over whatever the two sources have |
| **Misattributed citation counts** — the book-review trap and merged/split records make one record inherit another work's citations | Each node's OpenAlex citation count is bulk-compared against Semantic Scholar's (one POST per map). Counts an order of magnitude apart get a ⚠ warning in the detail sheet. Turn this off with the Semantic Scholar cross-check setting |
| **Language field is auto-detected** from title and abstract, with published error rates around one in seven records | The language facet and filter are shown as OpenAlex reports them; treat them as best-effort |
| **Author and institution disambiguation errors** — names are merged or split incorrectly, especially for non-English names | Authors are displayed exactly as OpenAlex sends them. Verify authorship through the DOI link before citing |
| **Duplicate and versioned records** (preprint vs published version, merging mistakes) | De-duplication is by OpenAlex work id only; a preprint and its published version are separate OpenAlex records and can both appear on one map |
| **No predatory-journal screening** — OpenAlex indexes by availability, not quality | Not filtered. If that matters for your field, cross-check venues against DOAJ |

Sources for the audits: Alperin et al. 2024 (coverage and metadata completeness), Gusenbauer 2024 (reference-capture error), Haupka 2024 (document-type misclassification), Céspedes et al. 2025 (language detection accuracy), and the 2025 systematic review of OpenAlex criticism (arXiv 2512.16434). The general advice from that literature applies here too: for anything beyond exploration, cross-validate against a second source (Semantic Scholar, Crossref, or the publisher page).

## OpenAlex endpoints

Base: `https://api.openalex.org`. The plugin sends `Accept: application/json` and, when a key is set, `Authorization: Bearer <key>`.

| Call | Endpoint | Role |
| --- | --- | --- |
| Seed by DOI | `GET /works/doi:{doi}?select=id,display_name,publication_year,cited_by_count,doi,authorships,abstract_inverted_index,referenced_works,related_works` | Resolve a DOI |
| Seed by id | `GET /works/{openAlexId}` with the same `select` | Resolve `W…` or an OpenAlex URL |
| Title search | `GET /works?search={query}&per_page=8&select=id,display_name,publication_year,cited_by_count,doi,authorships` | Picker, not the graph |
| References of the seed | `GET /works?filter=cited_by:{id}&per_page=80&sort=cited_by_count:desc` plus the list `select` | Outgoing citations. OpenAlex’s `cited_by` filter means “works this id cites”. |
| Citing works | `GET /works?filter=cites:{id}&per_page=40&sort=cited_by_count:desc` | Incoming citations |
| Related works | `GET /works?filter=related_to:{id}&per_page=20` | Topic-similar candidates |
| Reference lists and abstracts | `GET /works?filter=openalex:{id}\|{id}…&per_page={n}&select=id,referenced_works,abstract_inverted_index` | Batches of up to 80 ids |

Abstracts are reconstructed from `abstract_inverted_index` when OpenAlex has one and shown in full. Many works have none; the sheet then asks Semantic Scholar once for that paper, and says so when neither source has one.

Filter names are easy to invert: `cited_by:W…` returns works **in** that work’s `referenced_works` (outgoing). `cites:W…` returns works that **list** that id (incoming).

## Development preview

The pane UI is plain DOM (`src/app.ts`) so it can run outside Obsidian. The preview is the same map, not a second product.

```bash
npm run preview
python3 -m http.server 8734 --bind 127.0.0.1
```

Open `http://127.0.0.1:8734/preview/index.html`. Add `?demo=1` to build the example DOI immediately.

The note embed (same DOM as the plugin, without Obsidian) is `http://127.0.0.1:8734/preview/embed.html`. It loads `doi: 10.1038/nature14539` unless you pass `?doi=`. Add `&fixture=1` for offline data, as in the pane preview.

`npm test` runs architecture, UI contract, and offline logic checks without network requests. `npm run build` typechecks and creates the production bundle. `npm run verify` also includes a live OpenAlex check for `10.1038/nature14539`.

## Project layout

Official sample-plugin shape: `src/main.ts` bundled by esbuild to `main.js`, plus `manifest.json`, `styles.css`, and `versions.json`.

- `src/main.ts` — plugin, command, ribbon, settings, code-block registration
- `src/view.ts` — `ItemView` (2D pane)
- `src/embed-block.ts` — `connected-papers` and `research-connected` Markdown code blocks
- `src/embed-syntax.ts` — fence parser (`position`, `width`, `align`, `labels`)
- `src/embed-mount.ts` — embed chrome, graph state, optional depth-2 hop
- `src/map-canvas.ts` — shared 2D canvas renderer and graph interactions
- `src/graph-edit.ts` — graph edits and persisted deep-dug members
- `src/labels.ts` — node labels
- `src/relation.ts` — edge kind and localized explanations
- `src/app.ts` — pane orchestration, search, node edits, and detail panels
- `src/neighborhood.ts` — sampling and OpenAlex orchestration
- `src/similarity.ts` — coupling / co-citation scores
- `src/text-similarity.ts`, `src/diversity.ts` — semantic scores and MMR selection
- `src/layout.ts` — 2D force layout
- `src/openalex.ts` — works client
