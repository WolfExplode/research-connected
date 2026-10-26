import assert from "node:assert/strict";
import { build } from "esbuild";

class TFile {
  constructor(path) { this.path = path; this.extension = path.split(".").at(-1); this.basename = path.split("/").at(-1).replace(/\.md$/, ""); }
}
const target = await build({ entryPoints: ["src/vault-paper-library.ts", "src/workflow/bookmark-migration.ts", "src/vault-note.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, outdir: ".cache/build/library-contract", logLevel: "silent" });
function load(name) {
  const loaded = { exports: {} }, output = target.outputFiles.find(file => file.path.endsWith(name + ".js"));
  new Function("module", "exports", "require", output.text)(loaded, loaded.exports, () => ({ TFile, getLanguage: () => "en" }));
  return loaded.exports;
}
const { vaultPaperLibrary, invalidatePaperLibrary } = load("vault-paper-library");
const { migrateProjectBookmarks } = load("bookmark-migration");
const oldWindow = globalThis.window; globalThis.window = new EventTarget();
const paper = { id: "W12", title: "Cardiac exercise and autonomic function", doiUrl: "https://doi.org/10.1234/example", year: 2020, abstract: "Study abstract", authors: "Example", authorList: ["Example"], openAlexUrl: "https://openalex.org/W12", origin: "related", isSeed: false, citedByCount: 0, retracted: false, concepts: [] };
function harness() {
  const files = new Map(), props = new Map(), bodies = new Map();
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"),
      getAbstractFileByPath: path => files.get(path) ?? null,
      createFolder: async path => { files.set(path, { path }); },
      create: async (path, body) => {
        const file = new TFile(path); files.set(path, file); bodies.set(path, body);
        const data = {};
        for (const line of body.split("---")[1].split("\n")) {
          const match = /^([^:]+):\s*(.*)$/.exec(line); if (!match) continue;
          try { data[match[1]] = JSON.parse(match[2]); } catch { data[match[1]] = match[2]; }
        }
        props.set(path, data); return file;
      },
    },
    metadataCache: { getFileCache: file => ({ frontmatter: props.get(file.path) }) },
    fileManager: { processFrontMatter: async (file, update) => { update(props.get(file.path)); } },
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
  };
  const settings = { literatureFolder: "Research/Papers", literatureFilename: "", literatureTemplate: "", literatureDoiProperty: "doi" };
  return { app, props, bodies, files, settings };
}
try {
  const h = harness(), library = vaultPaperLibrary(h.app, () => h.settings, () => null);
  assert.equal(vaultPaperLibrary(h.app, () => h.settings), library, "all surfaces share a vault service");
  await library.setBookmark(paper, true);
  const note = library.read(paper).note;
  assert.ok(note); assert.equal(library.bookmarks().length, 1);
  assert.equal(h.props.get(note).bookmark, true); assert.equal(h.props.get(note).held, false);
  h.props.get(note).quality = "high"; h.bodies.set(note, h.bodies.get(note) + "Human notes\n");
  await library.setBookmark({ ...paper, id: "alias" }, false);
  assert.equal(library.bookmarks().length, 0); assert.ok(h.files.has(note));
  assert.match(h.bodies.get(note), /Human notes/); assert.equal(h.props.get(note).quality, "high");
  await library.migrateBookmark(paper, "Old project");
  assert.equal(library.read(paper).bookmark, false, "migration honors a deliberate unbookmark");
  await library.setBookmark(paper, true);
  const state = await library.save(paper);
  assert.equal(state.note, note); assert.equal(state.bookmark, true); assert.equal(state.held, false);
  assert.equal(h.props.get(note).needs_reason, "download-unavailable");
  assert.ok(h.props.get(note).acquisition_attempted_at);
  h.props.get(note).openalex = "W12";
  invalidatePaperLibrary(h.app, note);
  assert.equal(library.bookmarks()[0].paper.openAlexUrl, "https://openalex.org/W12");
  assert.equal(library.read({ ...paper, id: `local:${note}` }).bookmark, true);

  const remote = harness(); let calls = 0, release;
  const bridge = { read: () => ({ local: { state: "absent", note: null, files: [] } }), save: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { local: { state: "note-only", note: "Research/Papers/Remote.md", bookmark: true, reason: "no-oa-copy" } }; } };
  const integrated = vaultPaperLibrary(remote.app, () => remote.settings, () => bridge);
  const first = integrated.save(paper), second = integrated.save({ ...paper, id: "alias" });
  assert.equal(first, second, "concurrent saves of one DOI share acquisition");
  await Promise.resolve(); await Promise.resolve(); release();
  await first; assert.equal(calls, 1); assert.equal(integrated.read(paper).reason, "no-oa-copy");
  assert.equal(remote.files.size, 0, "the bridge owns canonical source creation");

  const older = harness(), oldBridge = { read: () => ({ local: { state: "absent", note: null, files: [] } }) };
  const olderLibrary = vaultPaperLibrary(older.app, () => older.settings, () => oldBridge);
  await assert.rejects(olderLibrary.migrateBookmark(paper, "Legacy graph"), /Update and reload Research Vault/);
  assert.equal(older.files.size, 0, "an older bridge must not bypass canonical source creation during migration");

  const legacy = { W1: { name: "First graph", paperStates: { W12: { paper, staged: true, source: "OpenAlex" } } } };
  let fail = true, imports = 0;
  const migrationLibrary = { migrateBookmark: async () => { imports++; } };
  await assert.rejects(migrateProjectBookmarks(legacy, migrationLibrary, async () => { if (fail) throw new Error("disk full"); }), /disk full/);
  assert.equal(legacy.W1.paperStates.W12.staged, true);
  fail = false; await migrateProjectBookmarks(legacy, migrationLibrary, async () => {});
  assert.equal(legacy.W1.paperStates.W12.staged, false); assert.equal(imports, 2);
  await migrateProjectBookmarks(legacy, migrationLibrary, async () => {}); assert.equal(imports, 2);
  console.log("vault-wide bookmarks, acquisition delegation, note preservation and migration receipts passed");
} finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
