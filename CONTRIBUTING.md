# Contributing

Use the [bug report form](https://github.com/WolfExplode/research-connected/issues/new?template=bug_report.yml) for problems and the [feature request form](https://github.com/WolfExplode/research-connected/issues/new?template=feature_request.yml) for improvements. English or Chinese is welcome. Search [existing issues](https://github.com/WolfExplode/research-connected/issues) first.

Reports are public. Remove API keys, private notes, and unpublished research from logs and screenshots. Do not upload a full vault or `data.json`. A public DOI/OpenAlex ID and short reproduction steps are usually more useful.

Use Node.js 24 (CI pins 24.11.1). Install the locked tools with `npm ci`, then run `npx playwright install chromium` once for headless browser checks. On Windows, the runner can use installed Chrome if the pinned Chromium is unavailable; set `PLAYWRIGHT_CHANNEL` explicitly when needed.

The [documentation index](docs/README.md), [architecture map](docs/engineering/architecture.md), and [UI contract](docs/engineering/ui.md) describe the current repository. Historical material lives in `docs/archive/`.

Before submitting a change, run:

```sh
npm test
npm run build
npm run preview
```

Check the graph pane and note embeds in Reading view and Live Preview, including keyboard navigation, narrow widths, light and dark themes. Settings changes should preserve saved projects and credentials. Changes to stored data need a migration regression and a reversible backup.

`npm test` runs lint, offline/contracts, and all three real-browser suites. `npm run test:unit` and `npm run test:browser` run the focused groups independently. Browser checks use isolated fixture data, block external requests, and fail on page errors. Generated bundles and failure screenshots are under `.cache/build/`. CI runs these checks for pull requests, main-branch pushes, and releases.

For interactive debugging, run `npm run test:browser:build`, serve the repository on loopback, and open `.cache/build/browser/review.html`, `doi.html`, or `maintenance.html`. Each page must report PASS. `npm run preview` builds pane and embed previews; it does not start a server.

`npm run verify` includes the explicit live OpenAlex check; `npm run test:live:review` runs the optional book-review source regression. These may contact scholarly APIs. `npm run perf` and `npm run mmr-sweep` run deterministic experiments from `benchmarks/`.

The browser preview uses browser networking and storage because it runs outside Obsidian. Production requests go through `src/obsidian-http.ts`; production persistence goes through the plugin data API. Keep those boundaries intact.

Release tags must match `package.json` and `manifest.json`. The release workflow validates, builds, and attests the three plugin files, then creates a draft release for review. Publish that draft only after host acceptance. Verify provenance with `gh attestation verify main.js --repo WolfExplode/research-connected` (and repeat for `manifest.json` and `styles.css`). Community scorecards update after the published release is scanned.

All edited text files use LF. Rebuild the tracked `main.js` release asset with `npm run build`; do not edit its bundled code. Keep generated preview/test output out of Git.
