# Domain language

- **Paper / work:** the project-local research item shown as a node; it may combine confirmed source records with traceable identifiers.
- **Source record:** one scholarly provider's bibliographic record, retained when works merge.
- **Project:** a saved citation graph, paper states, deep dives, named views, and explicit question memberships.
- **View:** the layout, comparison method, distance scale, filters, selection, viewport, and panel state of a graph.
- **Library paper:** a vault literature note with bibliographic and acquisition metadata, optionally paired with full text and a tool-managed sidecar.
- **Bookmark:** the vault-wide `bookmark` frontmatter flag; independent of holdings, project membership, and question relevance.
- **Save paper:** create or reuse its library note and attempt full-text acquisition; a failed attempt remains recorded in that note.
- **Reading state:** unread, to-read, or read; saved in the project and synchronized to a matching literature note.
- **Discovery result:** a transient ranked or retrieved paper pool, scoped to a question or comparison source; it does not replace a project's citation snapshot.
- **Library bridge:** the optional companion-plugin Interface for holdings, local text evidence, and discovery execution.

See [architecture](docs/engineering/architecture.md) for ownership and persistence rules.
