import assert from 'node:assert/strict';
import { build } from 'esbuild';

class Element {
  children = []; listeners = {};
  constructor(tag, options = {}) { this.tag = tag; this.textContent = options.text || ''; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  empty() { this.children = []; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  find(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.find(tag)]); }
}
const state = { note: 'Research/Papers/Example.md', held: false, bookmark: false };
let busy = false, calls = 0, finish;
let expectedDoi = 'https://doi.org/10.1234/example';
const library = {
  read: () => state, busy: () => busy,
  save: async (paper, onProgress) => { onProgress('Downloading from example.org…'); calls++; assert.equal(paper.doiUrl, expectedDoi); busy = true; await new Promise(resolve => { finish = resolve; }); busy = false; return state; },
};
const bundle = await build({ entryPoints: ['src/paper-requests-view.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['obsidian', './vault-paper-library', './paper-actions', './hover-hint'], logLevel: 'silent' });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, id => {
  if (id === 'obsidian') return { BasesView: class { registerDomEvent() {} }, getLanguage: () => 'en' };
  if (id === './vault-paper-library') return { vaultPaperLibrary: () => library };
  if (id === './paper-actions') return { acquisitionMessage: reason => `Acquisition failed: ${reason}` };
  if (id === './hover-hint') return { setHoverHint() {} };
  throw new Error(id);
});
const { PaperRequestsView } = loaded.exports;
globalThis.window = new EventTarget();
let fulfilled = false, checks = 0;
const parent = new Element('div'), plugin = { settings: {}, researchLibrary: () => ({ reconcileRequest: async path => { checks++; assert.equal(path, state.note); return fulfilled; } }) };
const view = new PaperRequestsView({}, parent, plugin);
let opened;
const frontmatter = { doi: '10.1234/example', title: 'Example', year: 2020 };
view.app = { metadataCache: { getFileCache: () => ({ frontmatter }) }, workspace: { openLinkText: async path => { opened = path; } } };
view.config = { getOrder: () => ['file.name', 'note.doi'], getDisplayName: prop => prop };
const entry = { file: { path: state.note, basename: 'Example' }, getValue: () => ({ toString: () => '10.1234/example' }) };
view.data = { data: [entry], groupedData: [{ hasKey: () => false, entries: [entry] }] };
view.onload(); view.onDataUpdated();
assert.equal(parent.find('button')[0].textContent, 'Download');
parent.find('a')[0].listeners.click({ preventDefault() {} });
assert.equal(opened, state.note);
parent.find('button')[0].listeners.click();
view.onDataUpdated();
assert.equal(parent.find('button')[0].disabled, true);
assert.equal(parent.find('button')[0].textContent, 'Checking library…');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(parent.find('button')[0].textContent, 'Downloading from example.org…');
state.reason = 'no-oa-copy'; finish();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls, 1);
assert.equal(parent.find('button')[0].disabled, false);
assert.ok(parent.find('div').some(el => el.textContent.includes('no-oa-copy')), 'failed acquisition stays visible beside the row');
state.held = true; view.onDataUpdated();
assert.equal(parent.find('button')[0].textContent, 'Check / clear request');
assert.equal(parent.find('button')[0].disabled, false);
fulfilled = true;
parent.find('button')[0].listeners.click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls, 1, 'a confirmed local paper clears the request without a download');
assert.equal(checks, 2);
fulfilled = false;
// Missing DOI: hold download until verified recovery completes, then pass that DOI
// directly to acquisition even if Obsidian's metadata index has not updated yet.
state.held = false; delete frontmatter.doi;
let completeLookup, lookups = 0;
plugin.recoverLibraryDoiStatus = async path => { lookups++; assert.equal(path, state.note); return new Promise(resolve => { completeLookup = resolve; }); };
view.onDataUpdated();
const click = parent.find('button')[0].listeners.click;
click(); click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(lookups, 1, 'duplicate clicks share the pending action');
assert.equal(calls, 1, 'download waits for DOI lookup');
assert.equal(parent.find('button')[0].textContent, 'Finding DOI…');
assert.equal(parent.find('button')[0].disabled, true);
expectedDoi = 'https://doi.org/10.1234/recovered';
completeLookup({ state: 'found', doi: '10.1234/recovered' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls, 2);
assert.equal(parent.find('button')[0].textContent, 'Downloading from example.org…');
finish(); await new Promise(resolve => setTimeout(resolve, 0));
for (const outcome of ['ambiguous', 'failed', 'skipped']) {
  plugin.recoverLibraryDoiStatus = async () => ({ state: outcome, reason: `Review ${outcome}` });
  parent.find('button')[0].listeners.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2, `${outcome} lookup must not start acquisition`);
  assert.ok(parent.find('div').some(el => el.textContent === `Review ${outcome}`));
  assert.equal(parent.find('button')[0].disabled, false);
}
plugin.recoverLibraryDoiStatus = async () => ({ state: 'not-found', reason: 'No verified DOI' });
expectedDoi = null;
parent.find('button')[0].listeners.click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls, 3, 'no verified match still allows title-based acquisition');
finish(); await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(parent.find('div').some(el => el.textContent.includes('No verified DOI')));
// A configured DOI property is respected and needs no lookup.
plugin.settings.literatureDoiProperty = 'paper_doi';
frontmatter.paper_doi = '10.1234/configured'; expectedDoi = 'https://doi.org/10.1234/configured';
plugin.recoverLibraryDoiStatus = async () => { throw new Error('must not look up an existing DOI'); };
view.onDataUpdated(); parent.find('button')[0].listeners.click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls, 4);
finish(); await new Promise(resolve => setTimeout(resolve, 0));
view.data = { data: [], groupedData: [] }; view.onDataUpdated();
assert.equal(parent.find('p')[0].textContent, 'No papers to obtain.');
view.onunload();
assert.equal(parent.find('table').length, 0);
console.log('paper requests view checks passed');
