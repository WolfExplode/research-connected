import type { ProviderRecord } from "./research-tools";

/**
 * How long provider results stay usable. Mirrors Tools/research/availability-cache.cjs, which the
 * CLI and worker apply when they write the cache; this side only decides what to show and when to
 * ask the worker again.
 */
const MINUTE = 60_000, DAY = 86_400_000;

export function availabilityTtl(name: string, value: ProviderRecord | undefined): number {
	return value?.state === "error" ? 5 * MINUTE : name === "oa" && value?.state === "available" ? 7 * DAY : DAY;
}

function valid(value: ProviderRecord | undefined): value is ProviderRecord & { checkedAt: string } {
	return !!value && ["available", "not-found", "error"].includes(value.state) && Number.isFinite(Date.parse(value.checkedAt ?? ""));
}

export function needsRefresh(value: ProviderRecord | undefined, name: string, now = Date.now()): boolean {
	if (!valid(value)) return true;
	if (Date.parse(value.retryAfter ?? "") > now) return false;
	const age = now - Date.parse(value.checkedAt);
	return age < 0 || age >= availabilityTtl(name, value) || !!value.refreshError;
}

export function providerView(value: ProviderRecord | undefined, name: string, now = Date.now()): ProviderRecord {
	if (value?.state === "not-configured") return value;
	if (!valid(value)) return { state: "not-checked" };
	const age = now - Date.parse(value.checkedAt);
	if (age < 0) return { state: "not-checked" };
	const stale = age >= availabilityTtl(name, value) || !!value.refreshError;
	if (stale && name !== "oa") return { state: "not-checked" };
	return { ...value, cached: true, stale };
}

/** A failed refresh keeps a known OA link visible as stale instead of replacing it with the error. */
export function mergeResult(previous: ProviderRecord | undefined, checked: ProviderRecord, name: string, now = Date.now()): ProviderRecord {
	const stamp = new Date(now).toISOString();
	if (name === "oa" && checked.state === "error" && previous?.state === "available" && valid(previous)) {
		return { ...previous, cached: true, stale: true, refreshError: checked.detail, lastAttemptAt: stamp, retryAfter: checked.retryAfter || new Date(now + 5 * MINUTE).toISOString() };
	}
	return { ...checked, checkedAt: stamp, cached: false, stale: false };
}
