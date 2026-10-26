const ALLOWED_HOSTS = new Set(["doi.org", "openalex.org"]);

/** HTTPS links we are willing to hand to the OS browser. */
export function allowedExternalUrl(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
	const host = parsed.hostname.toLowerCase();
	if (ALLOWED_HOSTS.has(host)) return parsed.toString();
	return null;
}

/** Provider links may point to any publisher, repository, or configured mirror. */
export function providerExternalUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
		return parsed.toString();
	} catch {
		return null;
	}
}
