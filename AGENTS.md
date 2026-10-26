# Research Connected

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for development and checks, and
[docs/engineering/architecture.md](docs/engineering/architecture.md) for the current code map.
[docs/README.md](docs/README.md) identifies current guidance and historical material.
[CONTEXT.md](CONTEXT.md) defines the domain vocabulary.

- Preserve existing local edits and user project data. Never commit credentials or vault data.json.
- Use LF for text files, including on Windows; .gitattributes enforces the repository convention.
- Run npm test and npm run build for behavior changes. Browser checks use isolated fixture data.
- Keep production networking and persistence behind the Obsidian adapters.
- Rebuild main.js from TypeScript. It is a tracked release artifact, not an editing entry point.
- Historical proposals and design prototypes in docs/archive are context, not current instructions.
