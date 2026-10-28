import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { bookmarkOf, type ResearchLibrary } from "./research-library";

/**
 * Labels live in the paper note's frontmatter, where agents and the research CLI read them:
 * quality, reading status and bookmark. Only changed properties are written,
 * so an unrelated edit made while the form is open survives.
 */
const QUALITIES = ["unassessed", "high", "mixed", "low"];
const READING = ["unread", "skimmed", "reading", "read"];

export class PaperLabelsModal extends Modal {
	constructor(app: App, private readonly file: TFile, private readonly saved: () => void = () => {}) { super(app); }

	onOpen(): void {
		this.titleEl.setText("Label paper");
		const props: Record<string, unknown> = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
		this.contentEl.createEl("p", { text: typeof props.title === "string" && props.title ? props.title : this.file.basename });
		const changes: Record<string, unknown> = {};
		new Setting(this.contentEl).setName("Quality").setDesc("Your assessment of the methods and evidence. Explain concerns in the reading notes.")
			.addDropdown(d => d.addOptions(Object.fromEntries(QUALITIES.map(v => [v, v]))).setValue(typeof props.quality === "string" ? props.quality : "unassessed").onChange(v => { changes.quality = v; }));
		new Setting(this.contentEl).setName("Reading status")
			.addDropdown(d => d.addOptions(Object.fromEntries(READING.map(v => [v, v]))).setValue(typeof props.reading_status === "string" ? props.reading_status : "unread").onChange(v => { changes.reading_status = v; }));
		new Setting(this.contentEl).setName("Bookmark").addToggle(t => t.setValue(bookmarkOf(props)).onChange(v => { changes.bookmark = v; }));
		const footer = this.contentEl.createDiv({ cls: "cpo-label-actions" });
		const save = footer.createEl("button", { text: "Save labels", cls: "mod-cta" });
		save.addEventListener("click", () => {
			save.disabled = true;
			void (async () => {
				if (Object.keys(changes).length) await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => { Object.assign(fm, changes); });
				this.saved(); this.close(); new Notice("Paper labels saved.");
			})().catch((error: unknown) => { save.disabled = false; new Notice(error instanceof Error ? error.message : "Labels could not be saved.", 10000); });
		});
		footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}

/** Reports provider links for a DOI; nothing is downloaded. */
export class PaperAvailabilityModal extends Modal {
	constructor(app: App, private readonly library: ResearchLibrary) { super(app); }

	onOpen(): void {
		this.titleEl.setText("Paper availability");
		const file = this.app.workspace.getActiveFile();
		const props = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		const input = this.contentEl.createEl("input", { type: "text", placeholder: "DOI or https://doi.org/…", attr: { "aria-label": "Paper DOI" } });
		input.value = typeof props?.doi === "string" ? props.doi : "";
		const status = this.contentEl.createEl("p", { text: "Checks report links only; papers are not downloaded." });
		const output = this.contentEl.createDiv();
		const actions = this.contentEl.createDiv({ cls: "cpo-label-actions" });
		for (const [provider, label] of [["all", "Check OA and Sci-Hub"], ["oa", "Check open access"], ["scihub", "Check Sci-Hub"]] as const) {
			actions.createEl("button", { text: label }).addEventListener("click", () => {
				status.setText("Checking availability…"); output.empty();
				const paper = { id: input.value, title: "", year: null, citedByCount: 0, authors: "", authorList: [], abstract: "", doiUrl: input.value, openAlexUrl: "",
					isSeed: false, origin: "related" as const, language: null, workType: null, venue: null, concepts: [], retracted: false };
				void this.library.check(paper, { provider, refresh: true }).then(data => {
					status.setText(`Local: ${data.local.state}`);
					for (const [name, value] of Object.entries(data.providers)) {
						output.createEl("p", { text: `${name === "oa" ? "Open access" : "Sci-Hub"}: ${value.state}${value.detail ? ` — ${value.detail}` : ""}` });
						for (const location of value.links?.length ? value.links : value.url ? [{ url: value.url, kind: "page" }] : []) {
							if (/^https?:\/\//i.test(location.url)) output.createEl("a", { text: location.kind === "pdf" ? "Open OA PDF" : "Open reported location", href: location.url, attr: { target: "_blank", rel: "noopener noreferrer" } });
						}
					}
				}).catch((error: unknown) => status.setText(error instanceof Error ? error.message : "Availability check failed."));
			});
		}
		input.focus();
	}

	onClose(): void { this.contentEl.empty(); }
}
