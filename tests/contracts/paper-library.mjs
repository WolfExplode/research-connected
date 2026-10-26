import assert from "node:assert/strict";
import { build } from "esbuild";

class TFile {
  constructor(path) { this.path = path; this.extension = path.split(".").at(-1); this.basename = path.split("/").at(-1).replace(/\.md$/, ""); }
}
const target = await build({ entryPoints: ["src/vault-paper-library.ts", "src/vault-note.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, outdir: ".cache/build/library-contract", logLevel: "silent" });
function load(name) {
  const loaded = { exports: {} }, output = target.outputFiles.find(file => file.path.endsWith(name + ".js"));
  new Function("module", "exports", "require", output.text)(loaded, loaded.exports, () => ({ TFile, getLanguage: () => "en" }));
  return loaded.exports;
}
const { vaultPaperLibrary, invalidatePaperLibrary } = load("vault-paper-library");
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
  // Without research tools, Save and Bookmark refuse instead of writing a second kind of note.
  const bare = harness(), library = vaultPaperLibrary(bare.app, () => bare.settings, () => null);
  assert.equal(vaultPaperLibrary(bare.app, () => bare.settings, () => null), library, "all surfaces share a vault service");
  await assert.rejects(library.setBookmark(paper, true), /research tools/);
  await assert.rejects(library.save(paper), /research tools/);
  assert.equal(bare.files.size, 0, "only the research tools create paper notes");
  assert.match(library.read(paper).error, /research tools/, "the refusal is shown on the paper");

  // The tools write the note; confirmed state shows until Obsidian indexes it.
  const kept = harness(), bookmarkCalls = [];
  const tools = {
    read: () => ({ local: { state: "absent", note: null, files: [] } }),
    bookmark: async (_paper, value) => { bookmarkCalls.push(value); return { local: { state: "note-only", note: "Research/Papers/Example.md", files: [], bookmark: value } }; },
  };
  const keptLibrary = vaultPaperLibrary(kept.app, () => kept.settings, () => tools);
  await keptLibrary.setBookmark(paper, true);
  assert.equal(keptLibrary.read(paper).note, "Research/Papers/Example.md"); assert.equal(keptLibrary.read(paper).bookmark, true);
  assert.equal(keptLibrary.bookmarks().length, 1, "a confirmed bookmark shows before Obsidian indexes the note");
  assert.deepEqual(bookmarkCalls, [true]);
  invalidatePaperLibrary(kept.app, "Research/Papers/Example.md");
  assert.equal(keptLibrary.bookmarks().length, 0, "a note change drops confirmed state in favor of the indexed note");

  const remote = harness(); let calls = 0, release;
  const libraryService = { read: () => ({ local: { state: "absent", note: null, files: [] } }), save: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { local: { state: "note-only", note: "Research/Papers/Remote.md", bookmark: true, reason: "no-oa-copy" } }; } };
  const integrated = vaultPaperLibrary(remote.app, () => remote.settings, () => libraryService);
  const first = integrated.save(paper), second = integrated.save({ ...paper, id: "alias" });
  assert.equal(first, second, "concurrent saves of one DOI share acquisition");
  await Promise.resolve(); await Promise.resolve(); release();
  await first; assert.equal(calls, 1); assert.equal(integrated.read(paper).reason, "no-oa-copy");
  assert.equal(remote.files.size, 0, "the research library owns canonical source creation");

  console.log("tool-only note writes and acquisition delegation passed");
} finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
