import { cleanAndValidateDomain } from "@/lib/domain-categories";

export type WebsiteValidationResult =
	| { isValid: true; formattedUrl: string }
	| { isValid: false; error: string };

/**
 * Validate a user-entered brand website. Accepts either a bare domain
 * (`example.com`) or a full URL, and normalizes the result to an
 * origin-only URL (path, query, and hash are stripped) so we always
 * store `https://example.com/` rather than `https://example.com/products`.
 */
export function validateWebsiteUrl(input: string): WebsiteValidationResult {
	if (!input || input.trim() === "") {
		return { isValid: false, error: "Website URL is required" };
	}
	let candidate = input.trim();
	if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
		candidate = `https://${candidate}`;
	}
	let urlObj: URL;
	try {
		urlObj = new URL(candidate);
	} catch {
		return { isValid: false, error: "Please enter a valid website URL or domain" };
	}
	if (!cleanAndValidateDomain(urlObj.hostname)) {
		return { isValid: false, error: "Website URL must have a valid domain name" };
	}
	return { isValid: true, formattedUrl: `${urlObj.origin}/` };
}
