<h1 align="center">Research Connected</h1>

<p align="center">English | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected logo"></p>

<p align="center">Map related papers, inspect the evidence behind each connection, and turn your reading into linked notes in Obsidian.</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected#quick-start">Quick start</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">User guide</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">Report a bug</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">Request a feature</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub release"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4+ desktop"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="License"></p>

## The map

![Research Connected graph pane around “Deep learning”: related papers on the left and the selected paper’s relationship evidence on the right](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

Select a node or an edge to see shared references, co-citations, and direct citation evidence.

## What you can do

- **Discover related research.** Enter a title, DOI, or OpenAlex ID and build a sampled similarity map. Switch among Planar, Timeline, and Similarity views. Similarity fixes the comparison paper at the center and places other papers at score-defined distances. Drag a paper around its orbit to untangle overlaps; its distance stays fixed. Select a paper for score details, or use “Compare against this paper” in its context menu to rebuild around it. No local PDFs are required.
- **Inspect each connection.** Read the references and citation evidence behind a relationship. Semantic Scholar, Crossref, and OpenCitations fill gaps and flag mismatched records.
- **Organize your reading.** Stage papers, mark them to read or read, exclude noise, and save named views. Write literature notes, embed the graph, or export BibTeX, YAML, and Markdown.

## Quick start

1. **Install and enable.** In Obsidian, open **Settings → Community plugins → Browse**, search for **Research Connected**, then install and enable it.
2. **Build your first map.** Run **Open Research Connected** from the command palette. Paste the DOI below, or enter a paper title, then select **Build**.
3. **Inspect a connection.** Select a paper or an edge to see why it is on the map. Use **Save view** to return to that arrangement.

```text
10.1038/nature14539
```

This example is “Deep learning” by LeCun, Bengio, and Hinton (2015). Results can change as the source databases update.

**Manual installation.** Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Abe-Junwei/research-connected/releases/latest), place them in `<vault>/.obsidian/plugins/research-connected/`, reload Obsidian, and enable the plugin.

## Explore research over time

![Timeline layout showing papers by publication year, with layout controls and a year slider](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

Switch to **Timeline**. The year slider narrows the visible map, and a saved view returns you to a useful selection.

## Keep the graph beside your notes

![A reading note with a Research Connected graph embedded between paragraphs](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

Add this block to a note. It renders in Reading view and Live Preview.

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

Select a paper and choose **Export → Write to note** to create a literature note. The plugin recognizes existing notes by DOI or OpenAlex ID, and synchronizes `rc-status` when the reading status changes. Set the folder, filename, body template, and DOI property in settings.

Embed options, frontmatter, sampling, and algorithms are in the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md). The older `connected-papers` embed name still works.

## Before you start

- **Desktop.** Obsidian 1.14.4 or later. Mobile support awaits device testing.
- **Network.** Building a map queries external scholarly services. Projects and reading states stay in your vault.
- **Service key.** An OpenAlex API key is optional and recommended. Create one in [OpenAlex settings](https://openalex.org/settings/api). Configuration is in the [guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md).
- **Sampling.** The map is a citation neighborhood, not every paper that cites the seed.
- **Notes.** Frontmatter is read to recognize literature notes. A note file changes only when you write one or change its reading status.
- **AI.** The research narrative is off by default. Exploring the map does not require a language model.
- **Interface language.** Simplified Chinese for Chinese locales, English otherwise.

## Network use and privacy

- **OpenAlex** receives the DOI, OpenAlex ID, or search text you enter, and your API key if you set one.
- **Semantic Scholar**, **Crossref**, and **OpenCitations** receive paper identifiers. A key or token is sent only to the service it belongs to.
- **Your language-model endpoint** receives the selected papers and their citation evidence only after you enable the research narrative and press **Generate**. Abstracts are included only if that option is on.

To match existing literature notes, the plugin lists Markdown paths and reads their cached frontmatter. Copy and export write to the system clipboard; the plugin does not read it. Writing a literature note or changing its reading state updates that vault file.

Projects, reading states, saved views, and service credentials are stored in this vault's plugin `data.json`. Credentials are **not encrypted**. The plugin sends no telemetry and does not read notes beyond literature-note frontmatter.

## Limitations

- The map is a **sample**, not a complete citation index. Highly cited papers contribute their most-cited citers, not all of them.
- Similarity and community colors are exploratory. Verify important claims against the original papers.
- OpenAlex has known gaps: missing abstracts, incomplete reference lists, and author disambiguation errors. The [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues) lists each gap and what the plugin does about it.

## Help and feedback

- **Something is not working.** [Report a bug](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml). Include the plugin and Obsidian versions, your system, the steps, and the expected and actual results. A public DOI or OpenAlex ID helps with paper-data problems.
- **A research workflow needs to change.** [Request a feature](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml). Describe the task, what gets in the way, and the result you need.
- **Setup help.** Read the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) and [check existing issues](https://github.com/Abe-Junwei/research-connected/issues).

English or Chinese is welcome. Submitting requires a GitHub account, and reports are public. Do not include API keys, private notes, unpublished research, a full vault, or `data.json`. A feature request does not promise implementation or a delivery date.

## Updates and license

Changes are in the [release notes](https://github.com/Abe-Junwei/research-connected/releases). Planned work is on the [roadmap](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md). Code and documentation contributions follow the [contributing guide](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md).

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE). Research Connected is an independent project and is not affiliated with Connected Papers.
