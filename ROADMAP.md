# Roadmap

Research Connected is the Obsidian front end for the cardiology research library. Its work follows
that repository's needs; the upstream product plan it was forked from is kept in the
[archive](docs/archive/plans/upstream-roadmap.md) for reference.

## Rules that hold for every change

- **Agents keep full access.** Anything an agent might need lives in vault notes or behind a
  `research` CLI command with `--json` output. Plugin `data.json` holds view and session state only.
- **The research tools write.** Paper notes, sidecars, acquired files and caches are written by the
  research CLI. The plugin orchestrates and renders.
- **The citation graph works alone.** Library features need the research tools; graph building
  does not.

## Next

- **Saved graphs agents can read.** Saved citation graphs, question memberships, deep dives and
  exclusions live in `data.json`. Expose a question's graph through a CLI command, or store it as a
  vault note the plugin reads.
- **Search paper contents.** Move the search tab from Research Vault into the Explore menu.

## Later

- **Multiple seeds.** Add nodes of the current graph as origins and resample, in the same project.
- **JSON Canvas export** of the visible view, linking nodes to existing literature notes.
- **Author view.** Frequent authors in the current graph and their recent work, with a warning for
  ambiguous names.
