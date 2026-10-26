import { vaultPaperLibrary } from "./vault-paper-library";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { mountGraphApp, type GraphAppHandle } from "./app";
import { LOGO_ICON } from "./logo";
import { VIEW_TYPE } from "./constants";
import { obsidianGetJson, obsidianPostJson } from "./obsidian-http";
import { openExternal } from "./open-external";
import { createVaultNote, lookupLiteratureNote, openLiteratureNote, rememberLiteratureNote, syncLiteratureReading } from "./vault-note";
import type { ConnectedPapersSettings } from "./settings";
import type { ResearchProject } from "./project-state";
import type { PaperLibraryService } from "./library-panel";

export interface GraphHost {
	getSettings(): ConnectedPapersSettings;
	saveSettings(notify?: boolean): Promise<void>;
	researchLibrary?(): PaperLibraryService | null;
}

export class ConnectedPapersView extends ItemView {
	private appHandle: GraphAppHandle | null = null;
	private headerStatus: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: GraphHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Research Connected";
	}

	getIcon(): string {
		return LOGO_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("cpo-host");
		this.mount();
	}

	/** Rebuild the pane on a new seed, e.g. from a note embed. */
	openSeed(target: { kind: "doi" | "openalex"; value: string }): void {
		this.appHandle?.destroy();
		this.contentEl.empty();
		this.mount(target);
	}

	openDoiPathSearch(): void {
		this.appHandle?.openDoiPathSearch();
	}

	openDiscovery(options: Parameters<GraphAppHandle["openDiscovery"]>[0] = {}): void {
		this.appHandle?.openDiscovery(options);
	}

	private mount(initialTarget?: { kind: "doi" | "openalex"; value: string }): void {
		this.headerStatus?.remove();
		const leaf = this.contentEl.closest<HTMLElement>(".workspace-leaf-content");
		const header = leaf?.querySelector<HTMLElement>(".view-header");
		const headerStatus = header?.createDiv({ cls: "cpo-view-status" });
		const actions = header?.querySelector<HTMLElement>(".view-actions");
		if (header && headerStatus && actions) header.insertBefore(headerStatus, actions);
		this.headerStatus = headerStatus ?? null;
		this.appHandle = mountGraphApp(this.contentEl, {
			researchLibrary: () => this.host.researchLibrary?.() ?? null,
			getSettings: () => this.host.getSettings(),
			persistSettings: () => this.host.saveSettings(false),
			getJson: obsidianGetJson,
			postJson: obsidianPostJson,
			openExternal,
			createNote: (filename, markdown, folder) => createVaultNote(this.app, filename, markdown, folder),
			lookupLiteratureNote: (paper) => lookupLiteratureNote(this.app, paper, this.host.getSettings().literatureDoiProperty),
			openLiteratureNote: (path) => { void openLiteratureNote(this.app, path); },
			syncLiteratureReading: (paper, reading) => syncLiteratureReading(this.app, paper, reading, this.host.getSettings().literatureDoiProperty),
			rememberLiteratureNote,
			paperLibrary: vaultPaperLibrary(this.app, () => this.host.getSettings(), () => this.host.researchLibrary?.() ?? null),
			loadSavedProject: () => Object.values(this.host.getSettings().researchProjects ?? {}).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
			statusHost: this.headerStatus ?? undefined,
		saveProject: async (project: ResearchProject) => {
			this.host.getSettings().researchProjects[project.seedId] = project;
			await this.host.saveSettings(false);
		},
			initialTarget,
		});
	}

	async onClose(): Promise<void> {
		this.appHandle?.destroy();
		this.appHandle = null;
		this.headerStatus?.remove();
		this.headerStatus = null;
		this.contentEl.empty();
		this.contentEl.removeClass("cpo-host");
	}
}
