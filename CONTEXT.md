# Domain language

- **Paper / work:** the project-local research item shown as a node; it may combine confirmed source records with traceable identifiers.
- **Source record:** one scholarly provider's bibliographic record, retained when works merge.
- **Project:** a saved citation graph, paper states, deep dives, and named views.
- **View:** the layout, comparison method, distance scale, filters, selection, viewport, and panel state of a graph.
- **Library paper:** a vault literature note with bibliographic and acquisition metadata, optionally paired with full text and a tool-managed sidecar.
- **Bookmark:** the vault-wide `bookmark` frontmatter flag; independent of holdings and project membership.
- **Save paper:** create or reuse its library note and attempt full-text acquisition; a failed attempt remains recorded in that note.
- **Reading state:** unread, to-read, or read; saved in the project and synchronized to a matching literature note.
- **Similarity result:** a transient pool of papers compared with one source paper; it does not replace a project's citation snapshot.
- **Research tools:** the research repository's CLI and availability worker, run as child processes; the only creator of paper notes and the only writer of sidecars, acquired files and caches. The plugin edits frontmatter on existing notes.
- **Paper library service:** the Interface graphs use for holdings, availability, Save and Bookmark, stored text and library papers; implemented over the research tools.

See [architecture](docs/engineering/architecture.md) for ownership and persistence rules.
