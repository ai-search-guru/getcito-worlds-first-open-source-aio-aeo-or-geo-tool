/**
 * Helpers for building route head() meta tags.
 * Respects white-label / deployment branding configuration.
 */

const DEFAULT_DESCRIPTION =
	"Track and optimize your brand's visibility across AI models.";

interface RouteMatchContext {
	context?: {
		clientConfig?: {
			branding?: { name?: string; url?: string; icon?: string };
		};
	};
}

/**
 * Get the app display name from route match context.
 * Returns the white-label branding name if configured, otherwise "Getcito".
 */
export function getAppName(match: RouteMatchContext): string {
	return match.context?.clientConfig?.branding?.name || "Getcito";
}

/**
 * Get the absolute base URL for the deployment, with no trailing slash.
 * Used to build canonical / og:url / og:image absolute URLs.
 */
export function getAppUrl(match: RouteMatchContext): string | undefined {
	const url = match.context?.clientConfig?.branding?.url;
	return url ? url.replace(/\/$/, "") : undefined;
}

/**
 * Get the brand name from the matched routes hierarchy.
 * Searches for the $brand layout match which stores brandName in loader data.
 */
export function getBrandName(
	matches: Array<{ loaderData?: Record<string, unknown> }>,
): string | undefined {
	for (const m of matches) {
		if (m.loaderData && typeof m.loaderData.brandName === "string") {
			return m.loaderData.brandName;
		}
	}
	return undefined;
}

/**
 * Build a page title following the convention:
 *   "PageName | BrandName · AppName"  (with brand context)
 *   "PageName · AppName"              (without brand context)
 */
export function buildTitle(
	pageName: string,
	opts: { appName: string; brandName?: string },
): string {
	if (opts.brandName) {
		return `${pageName} | ${opts.brandName} · ${opts.appName}`;
	}
	return `${pageName} · ${opts.appName}`;
}

function toAbsolute(appUrl: string | undefined, path: string): string {
	if (path.startsWith("http")) return path;
	if (!appUrl) return path;
	return `${appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Build OG / Twitter Card meta tags for a page.
 *
 * Points og:image at the dynamic /api/og endpoint which renders a brand-aware
 * PNG. The endpoint accepts ?title=…&description=… so each page can render its
 * own social card. URLs are absolute when an appUrl is supplied — required by
 * crawlers like Facebook, Twitter, and Slack.
 */
export function buildOgMeta(opts: {
	title: string;
	description?: string;
	path?: string;
	appUrl?: string;
}): Array<Record<string, string>> {
	const description = opts.description || DEFAULT_DESCRIPTION;

	const ogImageParams = new URLSearchParams();
	ogImageParams.set("title", opts.title);
	ogImageParams.set("description", description);
	const ogImageUrl = toAbsolute(opts.appUrl, `/api/og?${ogImageParams.toString()}`);

	const meta: Array<Record<string, string>> = [
		{ property: "og:title", content: opts.title },
		{ property: "og:description", content: description },
		{ property: "og:image", content: ogImageUrl },
		{ property: "og:image:width", content: "1200" },
		{ property: "og:image:height", content: "630" },
		{ property: "og:type", content: "website" },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: opts.title },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: ogImageUrl },
	];

	if (opts.path && opts.appUrl) {
		meta.push({
			property: "og:url",
			content: toAbsolute(opts.appUrl, opts.path),
		});
	}

	return meta;
}
