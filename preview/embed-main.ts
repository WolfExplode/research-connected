import { mountEmbed } from "../src/embed-mount";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { openExternal } from "../src/open-external";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { nicholsSnapshot, workIdentityFixtureGet } from "./work-identity-fixture";
import { normalizeProjects } from "../src/project-state";
import { fixtureGet } from "./fixture";

const root = document.querySelector("#embed");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #embed");
}

const getJson: GetJson = async (url, init) => {
	const response = await window.fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const params = new URLSearchParams(window.location.search);
const identity = params.has("identity");
const doi = params.get("doi") || (identity ? "10.1353/lan.1986.0014" : "10.1038/nature14539");
const position = params.get("position") || "inline";
const labels = params.get("labels") || "author-year";
const width = params.get("width");
const layout = params.get("layout");
const offline = params.has("fixture");
const lines = [`doi: ${doi}`, "height: 640", `position: ${position}`, `labels: ${labels}`];
if (width) lines.push(`width: ${width}`);
if (layout) lines.push(`layout: ${layout}`);

const settings = { ...DEFAULT_SETTINGS, researchProjects: identity ? normalizeProjects({ W4245234602: { version: 1, seedId: "W4245234602", name: "Nichols 1986", updatedAt: 1, views: [], snapshot: nicholsSnapshot() } }) : {} };

mountEmbed(root, {
	source: lines.join("\n"),
	getSettings: () => settings,
	getJson: identity ? workIdentityFixtureGet : offline ? fixtureGet : getJson,
	openExternal,
});
