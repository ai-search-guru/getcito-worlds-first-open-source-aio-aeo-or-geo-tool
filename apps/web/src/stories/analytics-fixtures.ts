/**
 * Deterministic mock data for the analytics page stories (overview, share of
 * voice, opportunities). Values are fixed (no randomness) so screenshots are
 * stable across runs.
 */

/** Build N consecutive YYYY-MM-DD strings ending at `end` (inclusive). */
function buildDates(n: number, end = "2026-06-04"): string[] {
	const [y, m, d] = end.split("-").map(Number);
	const base = new Date(y, m - 1, d);
	const out: string[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const dt = new Date(base);
		dt.setDate(base.getDate() - i);
		out.push(
			`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
		);
	}
	return out;
}

const DATES = buildDates(30);
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// AI visibility: a mild upward wave settling around 72%.
const visibilityTimeSeries = DATES.map((date, i) => ({
	date,
	overall: clamp(58 + i * 0.5 + 7 * Math.sin(i / 3.5)),
	nonBranded: clamp(40 + i * 0.4 + 6 * Math.sin(i / 4)),
	branded: clamp(90 + 4 * Math.sin(i / 5)),
}));

export const mockDashboardSummary = {
	totalPrompts: 42,
	totalRuns: 3120,
	averageVisibility: 68,
	nonBrandedVisibility: 51,
	brandedVisibility: 92,
	lastUpdatedAt: "2026-06-04T09:12:00.000Z",
	visibilityTimeSeries,
	citationTimeSeries: [],
};

// Share of voice: brand hovering in the low-30s against three competitors.
const shareTimeSeries = DATES.map((date, i) => ({
	date,
	share: clamp(29 + i * 0.18 + 4 * Math.sin(i / 4.5)),
}));

// Headline + entries are kept consistent with the trend's last point (35%), the
// way the server now derives them (LVCF current standings).
const sovLastShare = shareTimeSeries[shareTimeSeries.length - 1].share ?? 0;
export const mockShareOfVoice = {
	brandName: "Acme",
	brandShare: sovLastShare / 100,
	totalRuns: 3120,
	model: null,
	shareTimeSeries,
	entries: [
		{ name: "Acme", mentions: 1050, share: 0.35, isBrand: true, prompts: 31 },
		{ name: "Globex", mentions: 870, share: 0.29, isBrand: false, prompts: 28 },
		{ name: "Initech", mentions: 660, share: 0.22, isBrand: false, prompts: 24 },
		{ name: "Umbrella", mentions: 420, share: 0.14, isBrand: false, prompts: 19 },
	],
};

/** Mock opportunities report (the getOpportunitiesFn response shape). */
export const mockOpportunities = {
	reason: null,
	generatedFor: { brandName: "Acme" },
	report: {
		summary: [
			"Acme is out-cited by Globex and Initech on nearly every unbranded category question.",
			"Those answers lean on review sites and 'best CRM' roundups (G2, Capterra, PCMag) where competitors show up and Acme rarely does.",
			"Fastest wins are wide-open comparison and community surfaces; the entrenched media roundups are higher-effort, longer plays.",
		],
		opportunities: [
			{
				category: "creation",
				title: "Win the 'Acme vs Globex' and 'CRM alternatives' comparisons",
				why: "Buyers comparing CRMs see Globex named in most AI answers and you almost never — a neutral side-by-side gives assistants a reason to put Acme in the conversation.",
				relatedPrompts: [
					{ text: "acme vs globex pricing", promptId: "p8" },
					{ text: "best alternative to spreadsheets for tracking sales", promptId: "p6" },
				],
				yourCitations: [],
				competitorCitations: [
					{ title: "Globex vs the alternatives", domain: "globex.com", url: "https://globex.com/compare" },
				],
			},
			{
				category: "creation",
				title: "Create a link-worthy 'best CRM for small business' resource",
				why: "Globex wins this high-volume question through roundups you're absent from; a strong, citable resource of your own gives editors and assistants something to point to.",
				relatedPrompts: [{ text: "best crm for small business", promptId: "p1" }],
				yourCitations: [],
				competitorCitations: [
					{ title: "Globex for Small Business", domain: "globex.com", url: "https://globex.com/smb" },
				],
			},
			{
				category: "creation",
				title: "Publish a definitive 'CRM for startups' guide",
				why: "No source owns the startup-CRM explainer answers and the citations there keep changing, so a clear guide can claim them before a competitor does.",
				relatedPrompts: [
					{ text: "affordable accounting software for startups", promptId: "p3" },
					{ text: "what is customer relationship management", promptId: "p9" },
				],
				yourCitations: [],
				competitorCitations: [],
			},
			{
				category: "existing-content",
				title: "Shore up your Help Desk guide before it slips",
				why: "You already get cited for this answer, but a Globex page is gaining ground — reinforcing the page you have protects citations you're about to lose.",
				relatedPrompts: [{ text: "what is the best help desk software", promptId: "p4" }],
				yourCitations: [{ title: "Acme Help Desk Guide", domain: "acme.com", url: "https://acme.com/help-desk-guide" }],
				competitorCitations: [{ title: "Globex Help Desk", domain: "globex.com", url: "https://globex.com/help-desk" }],
			},
			{
				category: "outreach",
				title: "Run a verified-review drive on G2 and Capterra",
				why: "Review sites are the pages AI cites most for CRM picks, and competitors out-review you there — more recent reviews are the cheapest way to start getting named.",
				relatedPrompts: [
					{ text: "best crm for small business", promptId: "p1" },
					{ text: "tools for remote team collaboration", promptId: "p5" },
				],
				yourCitations: [{ title: "Acme CRM", domain: "acme.com", url: "https://acme.com" }],
				competitorCitations: [{ title: "Globex CRM", domain: "globex.com", url: "https://globex.com/crm" }],
			},
			{
				category: "outreach",
				title: "Earn inclusion in the major 'best CRM' roundups",
				why: "PCMag, Forbes Advisor and TechRadar are cited again and again for your biggest gaps but list competitors, not you — one inclusion can surface Acme across many related questions.",
				relatedPrompts: [
					{ text: "best crm for small business", promptId: "p1" },
					{ text: "top project management tools", promptId: "p2" },
				],
				yourCitations: [],
				competitorCitations: [
					{ title: "Globex for Small Business", domain: "globex.com", url: "https://globex.com/smb" },
				],
			},
			{
				category: "social",
				title: "Answer recurring 'which CRM' threads on r/CRM",
				why: "These Reddit threads feed a lot of AI answers and rotate often, so genuine, disclosed answers can get Acme surfaced quickly — competitors are already named there.",
				relatedPrompts: [
					{ text: "how do saas companies handle billing", promptId: "p10" },
					{ text: "what is customer relationship management", promptId: "p9" },
				],
				yourCitations: [],
				competitorCitations: [{ title: "Globex CRM overview", domain: "globex.com", url: "https://globex.com/crm" }],
			},
			{
				category: "social",
				title: "Seed honest comparison demos on YouTube",
				why: "Video walkthroughs get pulled into AI answers for evaluation questions, where competitor demos currently dominate and you're not represented.",
				relatedPrompts: [{ text: "best alternative to spreadsheets for tracking sales", promptId: "p6" }],
				yourCitations: [],
				competitorCitations: [],
			},
		],
		risks: [
			"The big media roundups are locked-in and slow to crack — treat them as longer plays, not quick wins.",
			"Several 'vs' queries are answered from competitor-owned domains you can't get listed on; focus on independent comparisons instead.",
			"Skip incentivized or fake reviews — assistants increasingly discount coordinated, inauthentic activity.",
		],
	},
};
