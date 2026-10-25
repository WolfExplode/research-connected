import { addIcon, Notice, Plugin } from "obsidian";
import { LOGO_ICON, LOGO_SVG } from "./logo";
import { tr } from "./i18n";
import { VIEW_TYPE } from "./constants";
import { registerConnectedPapersEmbed } from "./embed-block";
import { normalizeGrafted } from "./graph-edit";
import {
	ConnectedPapersSettingTab,
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
} from "./settings";
import { normalizeStagedList } from "./staging";
import { migrateProjectRecords, normalizeProjects } from "./project-state";
import { clamp } from "./visual";
import { invalidateLiteratureIndex } from "./vault-note";
import { ConnectedPapersView } from "./view";
import { DiscoveryGraphView, DISCOVERY_VIEW } from "./discovery-view";
import type { DiscoveryPayload } from "./discovery-graph";

export default class ConnectedPapersPlugin extends Plugin {
	settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS };
	private pendingSave: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		await this.loadSettings();

		// Main-area tab. The graph pane is the product, not a sidebar card list.
		this.registerView(VIEW_TYPE, (leaf) => new ConnectedPapersView(leaf, this));
		this.registerView(DISCOVERY_VIEW, leaf => new DiscoveryGraphView(leaf));
		this.addCommand({ id: "open-related-papers", name: tr("打开本地相关论文图谱", "Open local related-paper graph"), callback: () => { void this.openDiscovery(); } });
		this.registerDomEvent(window, "research-connected-open-discovery", event => {
			const detail = event.detail;
			if (!detail) return;
			detail.handled = true;
			void this.openDiscovery(detail.payload, detail.paper, detail.question, detail.mode).catch(error => new Notice(error instanceof Error ? error.message : "Could not open related papers"));
		});

		addIcon(LOGO_ICON, LOGO_SVG);

		this.addRibbonIcon(LOGO_ICON, "Research Connected", () => {
			void this.openView();
		});

		this.addCommand({
			// Preserve the published ID used by existing hotkeys and external links.
			id: "open-research-connected",
			name: tr("打开 Research Connected", "Open Research Connected"),
			callback: () => {
				void this.openView();
			},
		});

		this.addCommand({
			id: "find-doi-citation-path",
			name: tr("查找 DOI 引用路径（预算内）", "Find DOI citation path (budgeted)"),
			callback: () => {
				void (async () => {
					await this.openView();
					const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
					if (view instanceof ConnectedPapersView) view.openDoiPathSearch();
				})();
			},
		});

		this.registerEvent(this.app.workspace.on("css-change", () => {
			window.dispatchEvent(new Event("research-connected-theme"));
		}));
		const dropLiteratureIndex = (): void => invalidateLiteratureIndex();
		this.registerEvent(this.app.metadataCache.on("changed", dropLiteratureIndex));
		this.registerEvent(this.app.vault.on("delete", dropLiteratureIndex));
		this.registerEvent(this.app.vault.on("rename", dropLiteratureIndex));
		this.addSettingTab(new ConnectedPapersSettingTab(this.app, this, this));
		registerConnectedPapersEmbed(this);
	}

	getSettings(): ConnectedPapersSettings {
		return this.settings;
	}

	private async openDiscovery(payload?: DiscoveryPayload, paper?: string, question?: string, mode?: "rank" | "search"): Promise<void> {
		await this.openView();
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
		if (view instanceof ConnectedPapersView) view.openDiscovery({ payload, paper, question, mode });
		for (const leaf of this.app.workspace.getLeavesOfType(DISCOVERY_VIEW)) leaf.detach();
	}

	/** Note embeds call this to jump to the full graph pane on their seed. */
	openGraph(target: { kind: "doi" | "openalex"; value: string }): void {
		void (async () => {
			await this.openView();
			const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
			if (view instanceof ConnectedPapersView) view.openSeed(target);
		})();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as (Partial<ConnectedPapersSettings> & { stagedPapers?: unknown }) | null;
		const migrateIdentity = Object.values(stored?.researchProjects ?? {}).some((project) => project.snapshot?.version === 1);
		if (migrateIdentity && this.manifest.dir) {
			const path = `${this.manifest.dir}/data-before-work-identity-v2.json`;
			if (!await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.write(path, JSON.stringify(stored));
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		const maxNodes = Number(this.settings.maxNodes);
		this.settings.maxNodes = Number.isFinite(maxNodes) ? clamp(maxNodes, 20, 300) : DEFAULT_SETTINGS.maxNodes;
		this.settings.stagedPapers = normalizeStagedList(stored?.stagedPapers);
		this.settings.graftedBySeed = normalizeGrafted(stored?.graftedBySeed);
		this.settings.researchProjects = migrateProjectRecords(
			normalizeProjects(stored?.researchProjects),
			this.settings.stagedPapers,
			this.settings.graftedBySeed,
		);
		if (migrateIdentity && Object.entries(stored?.researchProjects ?? {}).some(([id, project]) => project.snapshot && !this.settings.researchProjects[id.toUpperCase()])) {
			throw new Error(tr("项目迁移未完成，已保留原数据及备份；请检查保存的项目格式", "Project migration could not complete. Original data and backup are retained; review the saved project format."));
		}
		this.settings.stagedPapers = [];
		this.settings.graftedBySeed = {};
		if (migrateIdentity) await this.saveSettings(false);
	}

	async saveSettings(notify = true): Promise<void> {
		const data = { ...this.settings } as Partial<ConnectedPapersSettings> & { stagedPapers?: unknown; graftedBySeed?: unknown };
		delete data.stagedPapers;
		delete data.graftedBySeed;
		const snapshot: unknown = JSON.parse(JSON.stringify(data));
		const save = this.pendingSave.catch(() => {}).then(async () => {
			await this.saveData(snapshot);
			window.dispatchEvent(new Event(notify ? "research-connected-settings" : "research-connected-project"));
		});
		this.pendingSave = save;
		await save;
	}

	private async openView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		const leaf = existing[0] ?? workspace.getLeaf("tab");
		if (existing.length === 0) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}
}
