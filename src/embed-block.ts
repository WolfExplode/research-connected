import { vaultPaperLibrary } from "./vault-paper-library";
import { MarkdownRenderChild, Plugin, type MarkdownPostProcessorContext } from "obsidian";
import { mountEmbed } from "./embed-mount";
import { obsidianGetJson, obsidianPostJson } from "./obsidian-http";
import { openExternal } from "./open-external";
import type { ConnectedPapersSettings } from "./settings-model";
import type { PaperLibraryService } from "./library-panel";
import { createVaultNote, lookupLiteratureNote, openLiteratureNote, rememberLiteratureNote, syncLiteratureReading } from "./vault-note";

interface EmbedHost extends Plugin {
	getSettings(): ConnectedPapersSettings;
	saveSettings(notify?: boolean): Promise<void>;
	/** Open the full graph pane focused on a seed; absent in hosts that cannot. */
	openGraph?(target: { kind: "doi" | "openalex"; value: string }): void;
	researchLibrary?(): PaperLibraryService | null;
}

/**
 * Reading view and Live Preview both use this processor. While the cursor is
 * inside the fence, Obsidian shows the source; leaving the block mounts the
 * graph again.
 */
export function registerConnectedPapersEmbed(plugin: EmbedHost): void {
	const handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		ctx.addChild(new ConnectedPapersEmbed(el, source, plugin, ctx));
	};
	// `connected-papers` stays valid so existing notes keep rendering.
	plugin.registerMarkdownCodeBlockProcessor("connected-papers", handler);
	plugin.registerMarkdownCodeBlockProcessor("research-connected", handler);
}

class ConnectedPapersEmbed extends MarkdownRenderChild {
	private destroyView: (() => void) | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly source: string,
		private readonly plugin: EmbedHost,
		_ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	onload(): void {
		const { plugin } = this;
		this.destroyView = mountEmbed(this.containerEl, {
			source: this.source,
			getSettings: () => plugin.getSettings(),
			persistSettings: () => plugin.saveSettings(false),
			getJson: obsidianGetJson,
			postJson: obsidianPostJson,
			openExternal,
			paperLibrary: vaultPaperLibrary(plugin.app, () => plugin.getSettings(), () => plugin.researchLibrary?.() ?? null),
			researchLibrary: () => plugin.researchLibrary?.() ?? null,
			stagePaper: async () => { await plugin.saveSettings(false); },
			createNote: (filename, markdown, folder) => createVaultNote(plugin.app, filename, markdown, folder),
			lookupLiteratureNote: (paper) => lookupLiteratureNote(plugin.app, paper, plugin.getSettings().literatureDoiProperty),
			openLiteratureNote: (path) => { void openLiteratureNote(plugin.app, path); },
			syncLiteratureReading: (paper, reading) => syncLiteratureReading(plugin.app, paper, reading, plugin.getSettings().literatureDoiProperty),
			rememberLiteratureNote,
			openGraph: plugin.openGraph ? (target) => plugin.openGraph?.(target) : undefined,
		});
	}

	onunload(): void {
		this.destroyView?.();
		this.destroyView = null;
	}
}
