import type { CitationCategory, CitationPageType } from "@/lib/domain-categories";

export interface GoogleProductRow {
	name: string;
	count: number;
	attribution: "brand" | "competitor" | "other";
	competitorName?: string;
	prompts: { id: string; value: string; count: number }[];
	urls: { url: string; count: number }[];
}
export interface GoogleQueryRow {
	query: string;
	count: number;
	prompts: { id: string; value: string; count: number }[];
}
export interface GoogleModuleData {
	shopping: { totalCitations: number; brandCount: number; competitorCount: number; products: GoogleProductRow[] };
	search: { totalCitations: number; queries: GoogleQueryRow[] };
}

export interface CitationData {
	totalCitations: number;
	uniqueDomains: number;
	categoryCounts: Record<CitationCategory, number>;
	domainDistribution: {
		domain: string;
		count: number;
		category: CitationCategory;
		exampleTitle?: string;
		previousCount?: number;
		changePercent?: number | null;
	}[];
	specificUrls: {
		url: string;
		title?: string;
		domain: string;
		count: number;
		category: CitationCategory;
		pageType?: CitationPageType;
		avgPosition?: number | null;
		promptCount?: number;
		isNew?: boolean;
	}[];
	pageTypeDistribution?: { pageType: CitationPageType; count: number }[];
	googleModule?: GoogleModuleData;
	citationTimeSeries?: Array<{ date: string } & Partial<Record<CitationCategory, number>>>;
	pageTypeTimeSeries?: Array<{ date: string } & Partial<Record<CitationPageType, number>>>;
	competitors?: Array<{ id: string; name: string; domains: string[] }>;
	competitorOnlyPrompts?: Array<{ id: string; value: string; competitorCitationCount: number; uniqueCompetitors: number }>;
	whatsChanged?: {
		newUrls: { url: string; domain: string; count: number; promptCount: number; category: CitationCategory }[];
		droppedUrls: { url: string; domain: string; previousCount: number; currentCount: number; category: CitationCategory }[];
		titleChanges: { url: string; domain: string; currentTitle: string; previousTitle: string; category: CitationCategory }[];
		newDomains: { domain: string; count: number; category: CitationCategory }[];
		droppedDomains: { domain: string; previousCount: number; category: CitationCategory }[];
	};
}
