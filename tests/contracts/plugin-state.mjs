import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: 'export { default } from "./src/main"; export { setOpenAlexCache } from "./src/openalex";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
class Plugin {}
const obsidian = { Plugin, BasesView: class {}, ItemView: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {}, Modal: class {}, TFile: class {}, getLanguage: () => "en" };
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, () => obsidian);
const PluginClass = loaded.exports.default;
const oldWindow = globalThis.window;
globalThis.window = { dispatchEvent() {}, setTimeout, clearTimeout };
let citationRequests = 0;
obsidian.requestUrl = async ({ url }) => {
  citationRequests++;
  const query = new URL(url);
  assert.ok(query.searchParams.get('select').includes('cited_by_count'));
  return { status: 200, json: { results: query.searchParams.get('filter').startsWith('doi:')
    ? [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1234/test', cited_by_count: 0 }, { id: 'https://openalex.org/W3', cited_by_count: null }]
    : [{ id: 'https://openalex.org/W2', cited_by_count: 42 }] } };
};
const citationPlugin = new PluginClass();
const citationCache = new Map();
loaded.exports.setOpenAlexCache({ read: async url => citationCache.get(url), write: async (url, body) => { citationCache.set(url, body); } });
const citationCounts = await citationPlugin.getCitationCounts([{ doi: '10.1234/test' }, { openalex: 'https://openalex.org/W2' }]);
assert.equal(citationRequests, 2);
assert.deepEqual(citationCounts.map(row => row.citationCount), [0, 42]);
assert.equal(citationCounts[0].doi, '10.1234/test');
await citationPlugin.getCitationCounts([{ doi: '10.1234/test' }, { openalex: 'https://openalex.org/W2' }]);
assert.equal(citationRequests, 2, 'citation lookups reuse the shared response cache');
loaded.exports.setOpenAlexCache(null);

const doiPlugin = new PluginClass();
doiPlugin.saveData = async () => {};
const note = new obsidian.TFile();
const fm = { title: 'A sufficiently detailed study of resting heart rate', year: 2020, authors: ['Jane Smith'], bookmark: true };
let noteWrites = 0, doiRequests = 0;
let duringWrite = () => {};
doiPlugin.app = {
  vault: { getAbstractFileByPath: () => note },
  metadataCache: { getFileCache: () => ({ frontmatter: structuredClone(fm) }) },
  fileManager: { async processFrontMatter(file, update) { noteWrites++; duringWrite(); update(fm); } },
};
obsidian.requestUrl = async () => {
  doiRequests++;
  return { status: 200, json: { message: { items: [{ DOI: '10.1234/recovered', title: [fm.title], published: { 'date-parts': [[2020]] }, author: [{ family: 'Smith' }] }] } } };
};
const path = 'Research/Papers/Test.md';
assert.deepEqual(await Promise.all([doiPlugin.recoverLibraryDoi(path), doiPlugin.recoverLibraryDoi(path)]), ['10.1234/recovered', '10.1234/recovered']);
assert.equal(doiRequests, 1, 'concurrent recovery shares a request');
assert.equal(noteWrites, 1);
assert.equal(fm.doi, '10.1234/recovered');
assert.equal(fm.doi_source, 'Crossref');
assert.ok(fm.doi_verified_at);
assert.equal(fm.bookmark, true);
delete fm.doi;
await doiPlugin.recoverLibraryDoi(path);
assert.equal(doiRequests, 1, 'verified recovery is cached');
delete fm.doi;
duringWrite = () => { fm.doi = '10.1234/manual'; };
assert.equal(await doiPlugin.recoverLibraryDoi(path), '10.1234/manual');
assert.equal(fm.doi, '10.1234/manual', 'preserves an identifier entered during lookup');
delete fm.doi;
duringWrite = () => { fm.title = 'Changed bibliography'; };
assert.equal(await doiPlugin.recoverLibraryDoi(path), null);
assert.equal(fm.doi, undefined, 'does not write a stale bibliographic match');
assert.equal(await doiPlugin.recoverLibraryDoi('Research/Papers/../../Other.md'), null);
fm.title = 'A sufficiently detailed study without a DOI';
duringWrite = () => {};
const beforeMiss = noteWrites;
obsidian.requestUrl = async ({ url }) => {
  doiRequests++;
  return { status: 200, json: url.includes('crossref') ? { message: { items: [] } } : { resultList: { result: [] } } };
};
assert.equal(await doiPlugin.recoverLibraryDoi(path), null);
const afterMiss = doiRequests;
assert.equal(await doiPlugin.recoverLibraryDoi(path), null);
assert.equal(doiRequests, afterMiss, 'recent misses do not repeatedly contact providers');
assert.equal(noteWrites, beforeMiss, 'missing DOI does not alter the note');
fm.title = 'A sufficiently detailed study with ambiguous metadata';
obsidian.requestUrl = async () => ({ status: 200, json: { message: { items: ['10.1234/one', '10.1234/two'].map(DOI => ({ DOI, title: [fm.title], published: { 'date-parts': [[2020]] }, author: [{ family: 'Smith' }] })) } } });
assert.equal(await doiPlugin.recoverLibraryDoi(path), null);
assert.equal(noteWrites, beforeMiss, 'ambiguous candidates never change the note');
const ambiguousStatus = await doiPlugin.recoverLibraryDoiStatus(path);
assert.equal(ambiguousStatus.state, 'ambiguous');
assert.match(ambiguousStatus.reason, /2 DOI candidates/);
delete fm.year;
const missingStatus = await doiPlugin.recoverLibraryDoiStatus(path);
assert.equal(missingStatus.state, 'skipped');
assert.match(missingStatus.reason, /Missing note metadata: year/);
fm.year = 2020;
fm.title = 'Another sufficiently detailed study without a DOI';
obsidian.requestUrl = async ({ url }) => ({ status: 200, json: url.includes('crossref') ? { message: { items: [] } } : { resultList: { result: [] } } });
const noMatch = await doiPlugin.recoverLibraryDoiStatus(path);
assert.equal(noMatch.state, 'not-found');
assert.match(noMatch.reason, /could not be verified/);
fm.title = 'A sufficiently detailed study with network failure';
obsidian.requestUrl = async () => { throw new Error('offline'); };
assert.equal((await doiPlugin.recoverLibraryDoiStatus(path)).state, 'failed');
globalThis.window = { dispatchEvent() {} };
try {
	const plugin = new PluginClass();
	const seed = { id: "W1", title: "Seed", isSeed: true, origin: "seed", doiUrl: null, year: 2000, citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "", openAlexUrl: "https://openalex.org/W1", language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const saved = { researchProjects: { W1: { version: 1, seedId: "W1", name: "Saved", updatedAt: 1, views: [], snapshot: { version: 2, seedId: "W1", savedAt: 1, nodes: [seed], catalog: [seed], edges: [], seedScore: [], referenceLists: [], citationEvidence: [], warnings: [], strategies: { references: true, citations: true, related: true }, skippedNonResearch: 0 } } } };
	const writes = [];
	plugin.loadData = async () => structuredClone(saved);
	plugin.saveData = async (value) => { writes.push(value); };
	await plugin.loadSettings();
	assert.equal(writes.length, 0, "loading current data writes nothing");
	assert.equal(plugin.settings.researchProjects.W1.snapshot.version, 2);

	let allowFirst;
	const gate = new Promise((resolve) => { allowFirst = resolve; });
	const order = [];
	plugin.saveData = async (data) => { order.push(data.maxNodes); if (order.length === 1) await gate; };
	plugin.settings.maxNodes = 30; const first = plugin.saveSettings(false);
	plugin.settings.maxNodes = 40; const second = plugin.saveSettings(false);
	await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
	assert.deepEqual(order, [30], "concurrent views must not start out-of-order saves");
	allowFirst(); await Promise.all([first, second]); assert.deepEqual(order, [30, 40]);
	plugin.saveData = async () => { throw new Error("disk full"); };
	await assert.rejects(plugin.saveSettings(false), /disk full/);
	plugin.saveData = async (data) => { order.push(data.maxNodes); };
	await plugin.saveSettings(false);
	assert.equal(order.length, 3, "a failed save must not block later retries");
	console.log("plugin loading and serialized persistence checks passed");
} finally {
	if (oldWindow === undefined) delete globalThis.window;
	else globalThis.window = oldWindow;
}

// The settings migration must keep all controls searchable, writable, and masked.
const settingsBundle = await build({ entryPoints: ["src/settings.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
const settingsModule = { exports: {} };
class SettingsTab {
	updates = 0;
	update() { this.updates++; }
}
new Function("module", "exports", "require", settingsBundle.outputFiles[0].text)(settingsModule, settingsModule.exports, () => ({ ...obsidian, PluginSettingTab: SettingsTab }));
let saves = 0;
const store = { settings: { ...settingsModule.exports.DEFAULT_SETTINGS }, saveSettings: async () => { saves++; } };
const tab = new settingsModule.exports.ConnectedPapersSettingTab({}, {}, store);
const controls = new Map();
const helpLinks = [];
function renderSettings() {
	controls.clear();
	helpLinks.length = 0;
	for (const definition of tab.getSettingDefinitions()) {
		assert.ok(definition.name && definition.desc, "every setting must have searchable text");
		const control = {
			inputEl: {},
			setPlaceholder() { return this; }, setValue() { return this; },
			setLimits() { return this; }, addOption() { return this; },
			onChange(callback) { this.change = callback; return this; },
		};
		const render = (callback) => { callback(control); controls.set(definition.name, control); };
		definition.render({
			addText: render, addTextArea: render, addSlider: render, addToggle: render, addDropdown: render,
			controlEl: { addClass() {}, createEl(tag, options) { helpLinks.push({ tag, ...options }); } },
		});
	}
}
renderSettings();
assert.deepEqual(helpLinks.map(({ tag, text, href, attr }) => [tag, text, href, attr]), [
	["a", "User guide", "https://github.com/WolfExplode/research-connected/blob/main/docs/USER_GUIDE.md", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Report a bug", "https://github.com/WolfExplode/research-connected/issues/new?template=bug_report.yml", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Request a feature", "https://github.com/WolfExplode/research-connected/issues/new?template=feature_request.yml", { target: "_blank", rel: "noopener noreferrer" }],
]);
assert.equal(controls.size, 21, "all non-LLM settings must remain available");
assert.equal(controls.get("OpenAlex API key").inputEl.type, "password");
await controls.get("Maximum nodes").change(999);
assert.equal(store.settings.maxNodes, 300);
await controls.get("DOI property name").change("  ");
assert.equal(store.settings.literatureDoiProperty, "doi");
await controls.get("Node executable").change("  ");
assert.equal(store.settings.researchNode, "node", "an empty Node executable falls back to node on PATH");
await controls.get("Research tools repository").change(" C:/research ");
assert.equal(store.settings.researchRepository, "C:/research");
await controls.get("Enable LLM research narrative").change(true);
assert.equal(tab.updates, 1, "LLM visibility must refresh through the host update API");
renderSettings();
assert.equal(controls.size, 25);
assert.equal(controls.get("LLM API key").inputEl.type, "password");
await controls.get("LLM endpoint").change(" https://example.test/chat/completions ");
assert.equal(store.settings.llmEndpoint, "https://example.test/chat/completions");
assert.equal(saves, 6);
store.saveSettings = async () => { throw new Error("disk full"); };
await assert.rejects(controls.get("Contact email (mailto)").change("a@example.test"), /disk full/);
console.log("settings search, persistence, visibility and secret masking checks passed");
