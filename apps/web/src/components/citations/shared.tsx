import {
	type CitationCategory,
	CATEGORY_CONFIG,
	CITATION_CATEGORIES,
	CITATION_PAGE_TYPES,
	PAGE_TYPE_CONFIG,
} from "@/lib/domain-categories";

export const getCategoryLabel = (category: string) =>
	CATEGORY_CONFIG[category as CitationCategory]?.label ?? category;

export const getCategoryColorClass = (category: string) =>
	CATEGORY_CONFIG[category as CitationCategory]?.badgeClass ?? "bg-gray-500/90 text-white";

export const formatUrlForDisplay = (url: string) => {
	let displayUrl = url.replace(/^https?:\/\//, "");
	displayUrl = displayUrl.replace(/^www\./, "");
	displayUrl = displayUrl.replace(/#:~:text=[^&]*/, "");
	if (displayUrl.endsWith("#")) displayUrl = displayUrl.slice(0, -1);
	const maxLength = 80;
	if (displayUrl.length > maxLength) {
		displayUrl = `${displayUrl.substring(0, maxLength)}...`;
	}
	return displayUrl;
};

export function formatPeriodLabel(days: number): string {
	if (days === 1) return "24 hours";
	if (days === 7) return "week";
	if (days === 14) return "2 weeks";
	if (days === 30) return "month";
	if (days === 60) return "2 months";
	if (days === 90) return "3 months";
	return `${days} days`;
}

export const extractSubreddit = (url: string): string | null => {
	try {
		const match = url.match(/reddit\.com\/r\/([^/?#]+)/i);
		return match ? `r/${match[1]}` : null;
	} catch {
		return null;
	}
};

export const extractFilenameFromUrl = (url: string) => {
	try {
		const urlObj = new URL(url);
		const segments = urlObj.pathname.split("/").filter(Boolean);
		if (segments.length === 0) return urlObj.hostname.replace(/^www\./, "");
		return segments[segments.length - 1];
	} catch {
		return url;
	}
};

export const CATEGORY_META: Record<string, { label: string; color: string }> = Object.fromEntries(
	CITATION_CATEGORIES.map((c) => [c, { label: CATEGORY_CONFIG[c].label, color: CATEGORY_CONFIG[c].chartColor }]),
);
export const PAGE_TYPE_META: Record<string, { label: string; color: string }> = Object.fromEntries(
	CITATION_PAGE_TYPES.map((p) => [p, { label: PAGE_TYPE_CONFIG[p].label, color: PAGE_TYPE_CONFIG[p].chartColor }]),
);

export const attributionDotClass = (a: "brand" | "competitor" | "other") =>
	a === "brand" ? "bg-emerald-500" : a === "competitor" ? "bg-red-500" : "bg-gray-400";

export function UnderlineTabs<T extends string>({
	tabs,
	activeKey,
	onSelect,
}: {
	tabs: readonly { key: T; label: string }[];
	activeKey: T;
	onSelect: (key: T) => void;
}) {
	return (
		<nav className="-mb-px flex gap-4 border-b border-border" aria-label="Tabs">
			{tabs.map(({ key, label }) => (
				<button
					key={key}
					type="button"
					onClick={() => onSelect(key)}
					className={`cursor-pointer whitespace-nowrap pb-2.5 text-xs font-medium transition-colors border-b-2 ${
						activeKey === key
							? "border-foreground text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
					}`}
				>
					{label}
				</button>
			))}
		</nav>
	);
}
