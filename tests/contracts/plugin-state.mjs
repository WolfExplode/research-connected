import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
class Plugin {}
const obsidian = { Plugin, ItemView: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {}, Modal: class {}, TFile: class {}, getLanguage: () => "en" };
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, () => obsidian);
const PluginClass = loaded.exports.default;
const oldWindow = globalThis.window;
globalThis.window = { dispatchEvent() {} };
try {
	const plugin = new PluginClass();
	const seed = { id: "W1", title: "Seed", isSeed: true, origin: "seed", doiUrl: null, year: 2000, citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "", openAlexUrl: "https://openalex.org/W1", language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const saved = { researchProjects: { W1: { version: 1, seedId: "W1", name: "Saved", updatedAt: 1, views: [], snapshot: { version: 1, seedId: "W1", savedAt: 1, nodes: [seed], catalog: [seed], edges: [], seedScore: [], referenceLists: [], citationEvidence: [], warnings: [], strategies: { references: true, citations: true, related: true }, skippedNonResearch: 0 } } } };
	const files = new Map(); const writes = [];
	plugin.manifest = { dir: ".obsidian/plugins/research-connected" };
	plugin.app = { vault: { adapter: { exists: async (path) => files.has(path), write: async (path, value) => { files.set(path, value); } } } };
	plugin.loadData = async () => structuredClone(saved);
	plugin.saveData = async (value) => { assert.ok(files.size, "backup must precede the migrated write"); writes.push(value); };
	await plugin.loadSettings();
	assert.deepEqual(JSON.parse([...files.values()][0]), saved);
	assert.equal(writes[0].researchProjects.W1.snapshot.version, 2);
	await plugin.loadSettings();
	assert.equal(files.size, 1, "the original backup must not be overwritten");

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

	const blocked = new PluginClass(); let overwritten = false;
	blocked.manifest = plugin.manifest;
	blocked.app = { vault: { adapter: { exists: async () => false, write: async () => { throw new Error("backup failed"); } } } };
	blocked.loadData = plugin.loadData; blocked.saveData = async () => { overwritten = true; };
	await assert.rejects(blocked.loadSettings(), /backup failed/);
	assert.equal(overwritten, false, "backup failure must preserve the original data");
	console.log("plugin migration and serialized persistence checks passed");
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
	["a", "User guide", "https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Report a bug", "https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Request a feature", "https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml", { target: "_blank", rel: "noopener noreferrer" }],
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
