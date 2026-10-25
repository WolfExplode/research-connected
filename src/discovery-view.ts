import { ItemView, WorkspaceLeaf } from "obsidian";
import { tr } from "./i18n";

/** Compatibility for saved workspace tabs. Discovery now lives in the main graph app. */
export const DISCOVERY_VIEW = "research-connected-discovery";

export class DiscoveryGraphView extends ItemView {
	constructor(leaf: WorkspaceLeaf) { super(leaf); }
	getViewType(): string { return DISCOVERY_VIEW; }
	getDisplayText(): string { return "Research Connected"; }
	async onOpen(): Promise<void> {
		this.contentEl.textContent = tr("正在打开 Research Connected…", "Opening Research Connected…");
		const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent("research-connected-open-discovery", { detail: {} })), 0);
		this.register(() => window.clearTimeout(timer));
	}
}
