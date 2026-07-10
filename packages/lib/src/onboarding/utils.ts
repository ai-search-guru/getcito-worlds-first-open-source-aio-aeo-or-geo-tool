/**
 * Shared helpers for the onboarding pipeline. Kept in a small file so the
 * analyse / LLM modules don't pull each other in just for trivial domain
 * cleanups.
 */

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function cleanDomain(input: string): string {
	if (!input) return "";
	const trimmed = input.trim();
	try {
		const hasProtocol = /^https?:\/\//i.test(trimmed);
		const urlString = hasProtocol ? trimmed : `https://${trimmed}`;
		const url = new URL(urlString);
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return trimmed
			.replace(/^https?:\/\//i, "")
			.replace(/^www\./i, "")
			.split("/")[0]
			.toLowerCase()
			.trim();
	}
}

export function isValidDomain(domain: string): boolean {
	return DOMAIN_REGEX.test(domain);
}

export function cleanAndValidateDomain(input: string): string | null {
	const cleaned = cleanDomain(input);
	return cleaned && isValidDomain(cleaned) ? cleaned : null;
}

/**
 * Best-effort brand name guess from a domain — e.g. `nike.com` → "Nike".
 * Used as a fallback when the caller did not pass a brand name and the LLM
 * also failed to return one.
 */
export function inferBrandNameFromDomain(website: string): string {
	const domain = cleanDomain(website);
	if (!domain) return website;
	const parts = domain.split(".");
	const root = parts[0] || domain;
	return root.charAt(0).toUpperCase() + root.slice(1);
}

export function uniqueLowercase(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const norm = v.trim().toLowerCase();
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

export function uniqueTrim(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const trimmed = v.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}
