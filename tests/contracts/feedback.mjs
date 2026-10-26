import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { build } from "esbuild";

const links = [];
class Setting {
	controlEl = {
		addClass() {},
		createEl(tag, options) { links.push({ tag, ...options }); },
	};
	setName() { return this; }
	setDesc() { return this; }
	addText() { return this; }
	addTextArea() { return this; }
	addSlider() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
}
class PluginSettingTab {
	containerEl = { empty() {} };
}
const bundle = await build({ entryPoints: ["src/settings.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, () => ({ Setting, PluginSettingTab, getLanguage: () => "en" }));
const tab = new loaded.exports.ConnectedPapersSettingTab({}, {}, { settings: { ...loaded.exports.DEFAULT_SETTINGS } });
if (tab.getSettingDefinitions) {
	for (const definition of tab.getSettingDefinitions()) definition.render(new Setting());
} else {
	tab.display();
}
assert.deepEqual(links.map(({ tag, text }) => [tag, text]), [["a", "User guide"], ["a", "Report a bug"], ["a", "Request a feature"]]);
const readme = readFileSync("README.md", "utf8");
for (const { href, attr } of links) {
	assert.equal(new URL(href).origin, "https://github.com");
	assert.equal(attr.target, "_blank");
	assert.equal(attr.rel, "noopener noreferrer");
	assert.ok(readme.includes(href), "settings and README must share the same feedback destinations");
	const template = new URL(href).searchParams.get("template");
	if (template) assert.ok(existsSync(`.github/ISSUE_TEMPLATE/${template}`), "feedback must point to an existing template");
}
console.log("feedback links render and match README and issue templates");
