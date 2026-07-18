export type FeatureKey =
	| "multiLlmTracking"
	| "visibilityScore"
	| "citationAnalytics"
	| "competitorBenchmarking"
	| "brandMentionTracking"
	| "promptVolumeEstimates"
	| "sentimentAnalysis"
	| "crawlerAnalytics"
	| "geographicTracking"
	| "socialMediaTracking"
	| "shoppingTracking"
	| "multiLanguage"
	| "actionRecommendations"
	| "contentGapAnalysis"
	| "siteAudits"
	| "keywordResearch"
	| "emailAlerts"
	| "dataExportApi"
	| "biConnectors"
	| "whiteLabelAgency"
	| "openSource"
	| "contentGeneration";

export type CompetitorCategory =
	| "tracking"
	| "content"
	| "api-developer"
	| "ecommerce"
	| "seo-traditional"
	| "open-source"
	| "other";

export interface FeatureDefinition {
	label: string;
	description: string;
}

export interface FeatureCategory {
	label: string;
	features: Record<string, FeatureDefinition>;
}

export interface Competitor {
	slug: string;
	name: string;
	domain: string;
	url: string;
	tagline: string;
	description: string;
	category: CompetitorCategory;
	ahrefsDR: number;
	ahrefsTraffic: number;
	status: "active" | "shutting-down" | "acquired" | "beta";
	features: Partial<Record<FeatureKey, boolean>>;
	pricing?: {
		hasFree: boolean;
		startingPrice?: string;
		hasEnterprise: boolean;
	};
	highlights?: string[];
	notes?: string;
}

export const FEATURE_CATEGORIES: Record<string, FeatureCategory> = {
	core: {
		label: "Core Tracking",
		features: {
			multiLlmTracking: {
				label: "Multi-LLM Tracking",
				description:
					"Track across ChatGPT, Claude, Gemini, Perplexity, and more",
			},
			visibilityScore: {
				label: "AI Visibility Score",
				description:
					"Aggregate score showing brand presence across AI responses",
			},
			citationAnalytics: {
				label: "Citation Analytics",
				description:
					"Track which websites and sources are cited in AI responses",
			},
			competitorBenchmarking: {
				label: "Competitor Benchmarking",
				description:
					"Compare visibility against competitors for each prompt",
			},
			brandMentionTracking: {
				label: "Brand Mention Tracking",
				description: "Monitor when and how AI platforms mention your brand",
			},
		},
	},
	platform: {
		label: "Platform",
		features: {
			whiteLabelAgency: {
				label: "White-Label / Agency",
				description: "Multi-client dashboards and custom branding",
			},
			openSource: {
				label: "Open Source",
				description: "Source code available for self-hosting",
			},
			contentGeneration: {
				label: "Content Generation",
				description: "AI-powered content creation and optimization",
			},
		},
	},
	advanced: {
		label: "Advanced Analytics",
		features: {
			promptVolumeEstimates: {
				label: "Prompt Volume Estimates",
				description: "Estimated search volumes for tracked queries",
			},
			sentimentAnalysis: {
				label: "Sentiment Analysis",
				description: "Track brand perception across AI platforms",
			},
			crawlerAnalytics: {
				label: "AI Crawler Analytics",
				description: "Track AI bot visits to your website",
			},
			geographicTracking: {
				label: "Geographic Tracking",
				description: "Track AI visibility by region or country",
			},
			socialMediaTracking: {
				label: "Social Media Tracking",
				description:
					"Monitor brand mentions on Reddit and social platforms",
			},
			shoppingTracking: {
				label: "Shopping Tracking",
				description:
					"Monitor product visibility in AI shopping features",
			},
			multiLanguage: {
				label: "Multi-Language",
				description: "Track visibility across multiple languages",
			},
		},
	},
	insights: {
		label: "Actionable Insights",
		features: {
			actionRecommendations: {
				label: "Action Recommendations",
				description:
					"Prioritized action items based on visibility gaps",
			},
			contentGapAnalysis: {
				label: "Content Gap Analysis",
				description:
					"Detect content gaps where competitors are cited but you aren't",
			},
			siteAudits: {
				label: "AI Site Audits",
				description: "Assess how AI-friendly your site content is",
			},
			keywordResearch: {
				label: "AI Keyword Research",
				description:
					"Discover conversational prompts users ask on AI platforms",
			},
		},
	},
	reporting: {
		label: "Reporting & Integration",
		features: {
			emailAlerts: {
				label: "Email Alerts",
				description: "Automated alerts and summary emails",
			},
			dataExportApi: {
				label: "Data Export / API",
				description: "Export data to CSV or access via API",
			},
			biConnectors: {
				label: "BI Connectors",
				description:
					"Native connectors to Looker Studio, NinjaCat, and other BI tools",
			},
		},
	},
};

export const ALL_FEATURE_KEYS: FeatureKey[] = Object.values(
	FEATURE_CATEGORIES,
).flatMap((cat) => Object.keys(cat.features) as FeatureKey[]);

export function getFeatureLabel(key: FeatureKey): string {
	for (const cat of Object.values(FEATURE_CATEGORIES)) {
		if (key in cat.features) return cat.features[key].label;
	}
	return key;
}

export function getFeatureDescription(key: FeatureKey): string {
	for (const cat of Object.values(FEATURE_CATEGORIES)) {
		if (key in cat.features) return cat.features[key].description;
	}
	return "";
}

export const Getcito_FEATURES: Record<FeatureKey, boolean> = {
	multiLlmTracking: true,
	visibilityScore: true,
	citationAnalytics: true,
	competitorBenchmarking: true,
	brandMentionTracking: true,
	promptVolumeEstimates: false,
	sentimentAnalysis: false,
	crawlerAnalytics: false,
	geographicTracking: false,
	socialMediaTracking: false,
	shoppingTracking: false,
	multiLanguage: false,
	actionRecommendations: false,
	contentGapAnalysis: false,
	siteAudits: false,
	keywordResearch: false,
	emailAlerts: false,
	dataExportApi: true,
	biConnectors: false,
	whiteLabelAgency: true,
	openSource: true,
	contentGeneration: false,
};

export const CATEGORY_LABELS: Record<CompetitorCategory, string> = {
	tracking: "AI Visibility Tracking",
	content: "Content Generation",
	"api-developer": "API",
	ecommerce: "E-commerce",
	"seo-traditional": "Traditional SEO",
	"open-source": "Open Source",
	other: "Other",
};

export const LOW_DR_THRESHOLD = 25;

export function isLowDR(competitor: Competitor): boolean {
	return competitor.ahrefsDR < LOW_DR_THRESHOLD;
}

export function getScreenshotUrl(slug: string): string {
	return `https://nynjceth7hnajxhe.public.blob.vercel-storage.com/screenshots/${slug}.jpg`;
}
