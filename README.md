<h1 align="center">Research Connected</h1>

<p align="center"><img src="docs/images/logo.svg" width="96" height="96" alt="Research Connected logo"></p>

<p align="center">Map a paper's citation neighborhood, inspect the evidence behind each connection, and run your research library's paper workflows from Obsidian.</p>

Research Connected is the Obsidian front end for the
[cardiology research library](https://github.com/WolfExplode/cardiology-research-library). It began
as a fork of [Abe-Junwei/research-connected](https://github.com/Abe-Junwei/research-connected) and now
owns the library's paper workflows: holdings, Save and Bookmark, availability, similarity,
discovery and labels. Those run through the library's research command-line tools; the citation
graph works without them.

![Research Connected graph pane: related papers on the left and the selected paper's relationship evidence on the right](docs/images/graph-pane.png)

## What it does

- **Citation maps.** Enter a title, DOI or OpenAlex ID and build a sampled similarity map, in
  Planar, Timeline or Similarity layouts. Select a node or an edge to see shared references,
  co-citations and direct citation evidence. Semantic Scholar, Crossref and OpenCitations fill gaps
  and flag mismatched records.
- **Find similar papers.** Compare a paper with your whole library, with wider literature from
  OpenAlex semantic search, or both. Text similarity uses SPECTER2 where available, with an explicit
  word-overlap fallback.
- **Screen and search a question.** Rank a question's unassessed papers with ASReview and search
  selected PDFs with PaperQA2, on the same canvas and details panel.
- **Library actions.** Save (create or reuse the library note and try to get the full text),
  Bookmark, check open-access and Sci-Hub availability, and label quality, reading status and
  question relevance. Everything is written to the paper note's frontmatter or by the research
  tools, never only to plugin data.
- **Embeds.** A `research-connected` code block puts a graph in any note:

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

## Install

This plugin isn't in the Obsidian community catalog. Build it and link it into the vault:

```sh
npm ci
npm run build
```

Copy or link `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/research-connected/`,
then enable **Research Connected**. In the cardiology research library the plugin folder is a
junction to this checkout. Requires Obsidian 1.14.4 or later on desktop.

For the library features, set **Research tools repository** in settings to the research library
checkout (empty uses the folder containing the vault) and **Node executable** if `node` isn't on
PATH. See [research tools](docs/RESEARCH_TOOLS.md) for what runs where.

## Network use and privacy

- **OpenAlex** receives the DOI, OpenAlex ID or search text you enter, and your API key if set.
- **Semantic Scholar**, **Crossref** and **OpenCitations** receive paper identifiers. A key or token
  goes only to the service it belongs to.
- Every scholarly request goes through one rate-limited lane per service. Rate-limit pauses are
  shared with the research tools through `.cache/research/providers/`.
- **Your language-model endpoint** receives selected papers and their evidence only after you enable
  the research narrative and press **Generate**.

Projects, saved views and service credentials are stored in the plugin's `data.json`. Credentials
are **not encrypted**. The plugin sends no telemetry.

## Limitations

- The map is a **sample**, not a complete citation index.
- Similarity and community colors are exploratory; verify important claims against the papers.
- OpenAlex has known gaps: missing abstracts, incomplete reference lists and author
  disambiguation errors. The [user guide](docs/USER_GUIDE.md#data-quality-known-openalex-issues)
  lists them.

## Documentation

The [user guide](docs/USER_GUIDE.md) covers the graph, settings and embeds. The
[documentation index](docs/README.md) lists the architecture, UI contract and research tools
guides. [Contributing](CONTRIBUTING.md) covers setup and checks; planned work is on the
[roadmap](ROADMAP.md).

## Feedback

Settings link to the same places: the [user guide](https://github.com/WolfExplode/research-connected/blob/main/docs/USER_GUIDE.md),
[report a bug](https://github.com/WolfExplode/research-connected/issues/new?template=bug_report.yml) and
[request a feature](https://github.com/WolfExplode/research-connected/issues/new?template=feature_request.yml).
Reports are public; leave out API keys, private notes and `data.json`.

## License

[MIT](LICENSE). Research Connected is an independent project and is not affiliated with Connected Papers.
