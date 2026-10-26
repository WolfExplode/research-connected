import { providerExternalUrl } from "./safe-url";

/**
 * Open a validated HTTP(S) link from a paper or availability provider. Obsidian rejects any plugin bundle that
 * contains `require("electron")`, so this stays on `window.open` only.
 */
export function openExternal(url: string): void {
	const safe = providerExternalUrl(url);
	if (!safe) return;
	window.open(safe, "_blank", "noopener,noreferrer");
}
