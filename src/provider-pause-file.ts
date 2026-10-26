import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { ProviderPause, ProviderPauseStore } from "./provider-limits";

// One hour bounds a corrupt or clock-skewed file; real pauses are shorter.
const MAX_PAUSE = 60 * 60_000;

/**
 * The research CLI's provider pauses (`.cache/research/providers/<service>.json`), so a rate
 * limit seen by either the plugin or a CLI command pauses both. The format is pinned by the
 * research library's contract test.
 */
export function providerPauseFiles(repository: string): ProviderPauseStore | null {
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
			const target = file(service), temp = `${target}.${process.pid}.tmp`;
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(temp, `${JSON.stringify({ service, ...pause, source: "research-connected" })}\n`, "utf8");
			renameSync(temp, target);
		},
	};
}
