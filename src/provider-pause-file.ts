import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ProviderPause, ProviderPauseStore } from "./provider-limits";

// One hour bounds a corrupt or clock-skewed file; real pauses are shorter.
const MAX_PAUSE = 60 * 60_000;

/**
 * The research CLI's provider pauses (`.cache/research/providers/<service>.json`), so a rate
 * limit seen by either the plugin or a CLI command pauses both. Reads are direct because every
 * request checks them; writes go through the research CLI's worker, the only writer of the file.
 */
export function providerPauseFiles(repository: string, record: (service: string, pause: ProviderPause) => Promise<void>): ProviderPauseStore | null {
	if (!existsSync(join(repository, "Tools", "research", "cli.js"))) return null;
	const file = (service: string): string => join(repository, ".cache", "research", "providers", `${service}.json`);
	return {
		read(service) {
			try {
				const value = JSON.parse(readFileSync(file(service), "utf8")) as Partial<ProviderPause>;
				const now = Date.now();
				return typeof value.until === "number" && value.until > now && value.until <= now + MAX_PAUSE && typeof value.state === "string"
					? { state: value.state, until: value.until } : null;
			} catch { return null; }
		},
		write(service, pause) {
			void record(service, pause).catch(() => undefined);
		},
	};
}
