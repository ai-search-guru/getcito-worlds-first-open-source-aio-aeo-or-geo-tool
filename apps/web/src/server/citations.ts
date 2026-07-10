/**
 * Server functions for citation data.
 * Replaces apps/web/src/app/api/brands/[id]/citations/route.ts
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, prompts, SYSTEM_TAGS } from "@workspace/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCitationUrlStats, getPerPromptDailyCitationPages, getPerPromptCitationPages } from "@/lib/postgres-read";
import { getEffectiveBrandedStatus } from "@workspace/lib/tag-utils";
import { citationDateWindow, applyPerPromptKeyedLVCF } from "@/lib/chart-utils";
import {
	type CitationCategory,
	type CitationPageType,
	CITATION_CATEGORIES,
	CITATION_PAGE_TYPES,
	emptyCategoryCounts,
	emptyPageTypeCounts,
	extractDomain,
	normalizeUrl,
	toRoundedPercentages,
	resolvePageType,
	isGoogleSurfaceUrl,
} from "@/lib/domain-categories";
import { categorizeDomain as categorizeDomainShared, classifyUrl as classifyUrlShared } from "@/lib/domain-categories.server";
import { buildGoogleModule, emptyGoogleModule } from "@/lib/google-module";

/**
 * Get citation statistics for a brand
 */
export const getCitationsFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			days: z.number().optional().default(7),
			tags: z.string().optional(),
			model: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		// Window: `data.days` calendar days ending today (inclusive), plus the
		// contiguous equal-length previous window — all UTC (server-TZ independent).
		// `dateRange` is reused for the trend charts so totals + charts span identically.
		const { fromDateStr, toDateStr, prevFromDateStr, prevToDateStr, dateRange } = citationDateWindow(new Date(), data.days);
		const timezone = "UTC";

		// Get brand info, competitors, and all enabled prompts
		const [brandResult, competitorsList, allPrompts] = await Promise.all([
			db.select().from(brands).where(eq(brands.id, data.brandId)).limit(1),
			db.select().from(competitors).where(eq(competitors.brandId, data.brandId)),
			db
				.select({ id: prompts.id, value: prompts.value, tags: prompts.tags, systemTags: prompts.systemTags })
				.from(prompts)
				.where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true))),
		]);

		const primaryBrandDomain = extractDomain(brandResult[0]?.website || "");
		const additionalBrandDomains = (brandResult[0]?.additionalDomains || []).map(extractDomain);
		const brandDomains = new Set([primaryBrandDomain, ...additionalBrandDomains].filter(Boolean));
		const competitorDomains = new Set(competitorsList.flatMap((c) => c.domains.map(extractDomain)).filter(Boolean));
		// Defined early so both the empty (no matching prompts) return and the main
		// return below expose the same shape — `competitors` must be present in both.
		const competitorSummary = competitorsList.map((c) => ({ id: c.id, name: c.name, domains: c.domains }));

		// Collect available tags
		const allUserTags = new Set<string>();
		for (const p of allPrompts) {
			for (const tag of p.tags || []) allUserTags.add(tag);
		}
		const userTagsWithoutSystemTags = Array.from(allUserTags)
			.filter((tag) => tag.toLowerCase() !== SYSTEM_TAGS.BRANDED && tag.toLowerCase() !== SYSTEM_TAGS.UNBRANDED)
			.sort();
		const availableTags = [SYSTEM_TAGS.BRANDED, SYSTEM_TAGS.UNBRANDED, ...userTagsWithoutSystemTags];

		// Filter prompt IDs by tags if specified
		let enabledPromptIds = allPrompts.map((p) => p.id);
		const tagFilter = data.tags?.split(",").filter(Boolean) || [];
		if (tagFilter.length > 0) {
			const filterByBranded = tagFilter.includes(SYSTEM_TAGS.BRANDED);
			const filterByUnbranded = tagFilter.includes(SYSTEM_TAGS.UNBRANDED);
			const nonSystemFilterTags = tagFilter.filter(
				(t) => t !== SYSTEM_TAGS.BRANDED && t !== SYSTEM_TAGS.UNBRANDED,
			);

			const matchingPrompts = allPrompts.filter((p) => {
				const systemTags = p.systemTags || [];
				const userTags = p.tags || [];

				if (filterByBranded || filterByUnbranded) {
					const effectiveStatus = getEffectiveBrandedStatus(systemTags, userTags);
					if (filterByBranded && effectiveStatus.isBranded) return true;
					if (filterByUnbranded && !effectiveStatus.isBranded) return true;
				}

				if (nonSystemFilterTags.length > 0) {
					const allTagsLower = [...systemTags, ...userTags].map((t) => t.toLowerCase());
					if (nonSystemFilterTags.some((ft) => allTagsLower.includes(ft))) return true;
				}

				if ((filterByBranded || filterByUnbranded) && nonSystemFilterTags.length === 0) return false;
				return false;
			});

			enabledPromptIds = matchingPrompts.map((p) => p.id);

			if (enabledPromptIds.length === 0) {
				return {
					totalCitations: 0,
					uniqueDomains: 0,
					categoryCounts: emptyCategoryCounts(),
					domainDistribution: [] as { domain: string; count: number; category: CitationCategory; exampleTitle?: string; previousCount: number; changePercent: number | null }[],
					specificUrls: [] as { url: string; title?: string; domain: string; count: number; category: CitationCategory; pageType: CitationPageType; avgPosition: number | null; promptCount: number; isNew: boolean }[],
					pageTypeDistribution: [] as { pageType: CitationPageType; count: number }[],
					googleModule: emptyGoogleModule(),
					availableTags,
					citationTimeSeries: [] as ({ date: string } & Record<CitationCategory, number>)[],
					pageTypeTimeSeries: [] as ({ date: string } & Record<CitationPageType, number>)[],
					competitors: competitorSummary,
				competitorOnlyPrompts: [] as { id: string; value: string; competitorCitationCount: number; uniqueCompetitors: number }[],
				whatsChanged: {
					newUrls: [] as { url: string; domain: string; count: number; promptCount: number; category: CitationCategory }[],
					droppedUrls: [] as { url: string; domain: string; previousCount: number; currentCount: number; category: CitationCategory }[],
					titleChanges: [] as { url: string; domain: string; currentTitle: string; previousTitle: string; category: CitationCategory }[],
					newDomains: [] as { domain: string; count: number; category: CitationCategory }[],
					droppedDomains: [] as { domain: string; previousCount: number; category: CitationCategory }[],
				},
				};
			}
		}

		const [urlStats, perPromptDailyPages, perPromptPages, prevUrlStats] = await Promise.all([
			getCitationUrlStats(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds, data.model),
			getPerPromptDailyCitationPages(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds, data.model),
			getPerPromptCitationPages(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds, data.model),
			getCitationUrlStats(data.brandId, prevFromDateStr, prevToDateStr, timezone, enabledPromptIds, data.model),
		]);

		function categorizeDomain(domain: string): CitationCategory {
			return categorizeDomainShared(domain, brandDomains, competitorDomains);
		}
		const classify = (domain: string, url: string, title: string | null | undefined): CitationCategory =>
			classifyUrlShared(domain, url, title, brandDomains, competitorDomains);

		// Google search/shopping surfaces (Google AI Mode) are pulled OUT of the
		// source mix and surfaced in their own module below. Previous-period domain
		// counts (surfaces excluded) drive trend deltas + new/dropped detection.
		const prevDomainMap = new Map<string, number>();
		for (const { url, domain, count } of prevUrlStats) {
			if (isGoogleSurfaceUrl(url)) continue;
			prevDomainMap.set(domain, (prevDomainMap.get(domain) ?? 0) + Number(count));
		}

		// Build previous period URL map for comparison
		const prevUrlMap = new Map<string, { count: number; title?: string; domain: string }>();
		for (const { url, domain, title, count } of prevUrlStats) {
			if (isGoogleSurfaceUrl(url)) continue;
			const normalizedUrl = normalizeUrl(url);
			const existing = prevUrlMap.get(normalizedUrl);
			if (existing) {
				existing.count += Number(count);
				if (!existing.title && title) existing.title = title;
			} else {
				prevUrlMap.set(normalizedUrl, { count: Number(count), title: title || undefined, domain });
			}
		}

		// Categorize and normalize specific URLs with new fields
		const urlCounts = new Map<string, { count: number; title?: string; domain: string; positionSum: number; positionCount: number; promptCount: number }>();
		for (const { url, domain, title, count, avg_position, prompt_count } of urlStats) {
			if (isGoogleSurfaceUrl(url)) continue;
			const normalizedUrl = normalizeUrl(url);
			const c = Number(count);
			const positionSum = avg_position != null ? Number(avg_position) * c : 0;
			const positionCount = avg_position != null ? c : 0;
			const existing = urlCounts.get(normalizedUrl);
			if (existing) {
				existing.count += c;
				existing.positionSum += positionSum;
				existing.positionCount += positionCount;
				existing.promptCount = Math.max(existing.promptCount, Number(prompt_count));
				if (!existing.title && title) existing.title = title;
			} else {
				urlCounts.set(normalizedUrl, {
					count: c,
					title: title || undefined,
					domain,
					positionSum,
					positionCount,
					promptCount: Number(prompt_count),
				});
			}
		}

		const specificUrls = Array.from(urlCounts.entries())
			.map(([url, { count, title, domain, positionSum, positionCount, promptCount }]) => {
				const category = classify(domain, url, title);
				return {
					url,
					title,
					domain,
					count,
					category,
					pageType: resolvePageType(url, title, category),
					avgPosition: positionCount > 0 ? Math.round((positionSum / positionCount) * 10) / 10 : null,
					promptCount,
					isNew: !prevUrlMap.has(url),
				};
			})
			.sort((a, b) => b.count - a.count);

		// Domain distribution rebuilt from URL-level data: count + a per-domain
		// category taken from its top-cited URL (so a domain that's mostly review
		// articles reads as editorial rather than other), sorted by count.
		const domainAgg = new Map<string, { count: number; category: CitationCategory; topCount: number; exampleTitle?: string }>();
		for (const u of specificUrls) {
			const cur = domainAgg.get(u.domain);
			if (cur) {
				cur.count += u.count;
				if (u.count > cur.topCount) {
					cur.topCount = u.count;
					cur.category = u.category;
					cur.exampleTitle = u.title;
				}
			} else {
				domainAgg.set(u.domain, { count: u.count, category: u.category, topCount: u.count, exampleTitle: u.title });
			}
		}
		const domainDistribution = Array.from(domainAgg.entries())
			.map(([domain, v]) => {
				const previousCount = prevDomainMap.get(domain) || 0;
				return {
					domain,
					count: v.count,
					category: v.category,
					exampleTitle: v.exampleTitle,
					previousCount,
					changePercent: previousCount > 0 ? Math.round(((v.count - previousCount) / previousCount) * 100) : null,
				};
			})
			.sort((a, b) => b.count - a.count);

		// Category + page-type totals from the URL-level classification
		const categoryCounts = emptyCategoryCounts();
		const pageTypeCounts = emptyPageTypeCounts();
		for (const u of specificUrls) {
			categoryCounts[u.category] += u.count;
			pageTypeCounts[u.pageType] += u.count;
		}
		const totalCitations = CITATION_CATEGORIES.reduce((s, c) => s + categoryCounts[c], 0);
		const pageTypeDistribution = CITATION_PAGE_TYPES
			.map((pageType) => ({ pageType, count: pageTypeCounts[pageType] }))
			.filter((d) => d.count > 0);

		// Google AI Mode module: Shopping products (brand vs competitor) + search
		// queries, each tied to the prompts that triggered them.
		const promptLookup = new Map(allPrompts.map((p) => [p.id, p]));
		const googleModule = buildGoogleModule(
			perPromptPages,
			brandResult[0]?.name ?? "",
			competitorsList.map((c) => ({ id: c.id, name: c.name })),
			(id) => promptLookup.get(id)?.value,
		);

		// Citation time series via per-prompt LVCF with cadence normalization. Both
		// axes are classified at the URL level (surfaces excluded), so the trends
		// match the breakdown above and show every category / page type. `dateRange`
		// (the current window) was computed once up top so charts + totals stay aligned.
		const cadenceHours = brandResult[0]?.delayOverrideHours;
		// Classify each URL ONCE (from specificUrls) and reuse it here, keyed by the
		// normalized URL. The per-(prompt,day) rows carry their own title, so
		// re-classifying them could land an "other"-domain URL in a different category
		// than categoryCounts/the tabs — which would render a chart band with no tab and
		// let the stack sum to <100%. Looking up the canonical classification keeps the
		// trend charts, the totals, and the tab filters provably in sync.
		const urlCategory = new Map(specificUrls.map((u) => [u.url, u.category] as const));
		const urlPageType = new Map(specificUrls.map((u) => [u.url, u.pageType] as const));
		const categoryRows: { prompt_id: string; date: string; key: CitationCategory; count: number }[] = [];
		const pageTypeRows: { prompt_id: string; date: string; key: CitationPageType; count: number }[] = [];
		for (const r of perPromptDailyPages) {
			if (!r.url || isGoogleSurfaceUrl(r.url)) continue;
			const c = Number(r.count);
			const date = String(r.date);
			const nu = normalizeUrl(r.url);
			const category = urlCategory.get(nu) ?? classify(r.domain, r.url, r.title);
			const pageType = urlPageType.get(nu) ?? resolvePageType(r.url, r.title, category);
			categoryRows.push({ prompt_id: r.prompt_id, date, key: category, count: c });
			pageTypeRows.push({ prompt_id: r.prompt_id, date, key: pageType, count: c });
		}
		const smoothedCategories = applyPerPromptKeyedLVCF(categoryRows, dateRange, cadenceHours, CITATION_CATEGORIES);
		const smoothedPageTypes = applyPerPromptKeyedLVCF(pageTypeRows, dateRange, cadenceHours, CITATION_PAGE_TYPES);
		const citationTimeSeries = dateRange.map((date) => {
			const c = smoothedCategories.get(date);
			if (!c) return { date, ...emptyCategoryCounts() };
			return { date, ...(toRoundedPercentages(c) as Record<CitationCategory, number>) };
		});
		const pageTypeTimeSeries = dateRange.map((date) => {
			const c = smoothedPageTypes.get(date);
			if (!c) return { date, ...emptyPageTypeCounts() };
			return { date, ...(toRoundedPercentages(c) as Record<CitationPageType, number>) };
		});

		// What's Changed: new URLs, dropped URLs, title changes
		const MIN_COUNT_FOR_WHATS_CHANGED = 2;

		const newUrls = specificUrls
			.filter((u) => u.isNew && u.count >= MIN_COUNT_FOR_WHATS_CHANGED)
			.slice(0, 10)
			.map((u) => ({ url: u.url, domain: u.domain, count: u.count, promptCount: u.promptCount, category: u.category }));

		const droppedUrls: { url: string; domain: string; previousCount: number; currentCount: number; category: CitationCategory }[] = [];
		for (const [url, prevData] of prevUrlMap.entries()) {
			if (prevData.count < MIN_COUNT_FOR_WHATS_CHANGED) continue;
			const current = urlCounts.get(url);
			const currentCount = current?.count || 0;
			const dropPercent = ((prevData.count - currentCount) / prevData.count) * 100;
			if (dropPercent >= 50) {
				droppedUrls.push({
					url,
					domain: prevData.domain,
					previousCount: prevData.count,
					currentCount,
					category: classify(prevData.domain, url, prevData.title),
				});
			}
		}
		droppedUrls.sort((a, b) => b.previousCount - a.previousCount);

		const titleChanges: { url: string; domain: string; currentTitle: string; previousTitle: string; category: CitationCategory }[] = [];
		for (const [url, currentData] of urlCounts.entries()) {
			const prevData = prevUrlMap.get(url);
			if (!prevData) continue;
			if (currentData.title && prevData.title && currentData.title !== prevData.title) {
				titleChanges.push({
					url,
					domain: currentData.domain,
					currentTitle: currentData.title,
					previousTitle: prevData.title,
					category: classify(currentData.domain, url, currentData.title),
				});
			}
		}

		// Domain-level changes
		const currentDomainSet = new Set(domainDistribution.map((d) => d.domain));
		const newDomains = domainDistribution
			.filter((d) => d.previousCount === 0 && d.count >= MIN_COUNT_FOR_WHATS_CHANGED)
			.sort((a, b) => b.count - a.count)
			.slice(0, 10)
			.map((d) => ({ domain: d.domain, count: d.count, category: d.category }));

		const droppedDomains: { domain: string; previousCount: number; category: CitationCategory }[] = [];
		for (const [domain, prevCount] of prevDomainMap.entries()) {
			if (prevCount < MIN_COUNT_FOR_WHATS_CHANGED) continue;
			if (!currentDomainSet.has(domain)) {
				droppedDomains.push({ domain, previousCount: prevCount, category: categorizeDomain(domain) });
			}
		}
		droppedDomains.sort((a, b) => b.previousCount - a.previousCount);

		// Prompts with competitor citations but no brand citations (computed from already-fetched data)
		const competitorDomainEntries = competitorsList.flatMap((c) =>
			c.domains.map((d) => ({ domain: extractDomain(d), competitorId: c.id })),
		).filter((e) => e.domain);

		function resolveCompetitorId(citationDomain: string): string | undefined {
			const normalized = extractDomain(citationDomain);
			for (const entry of competitorDomainEntries) {
				if (normalized === entry.domain || normalized.endsWith(`.${entry.domain}`)) {
					return entry.competitorId;
				}
			}
			return undefined;
		}

		const promptCitationFlags = new Map<string, { hasBrand: boolean; hasCompetitor: boolean; competitorCount: number; competitorIds: Set<string> }>();
		for (const row of perPromptPages) {
			const cat = categorizeDomain(row.domain);
			let entry = promptCitationFlags.get(row.prompt_id);
			if (!entry) {
				entry = { hasBrand: false, hasCompetitor: false, competitorCount: 0, competitorIds: new Set() };
				promptCitationFlags.set(row.prompt_id, entry);
			}
			if (cat === "brand") entry.hasBrand = true;
			if (cat === "competitor") {
				entry.hasCompetitor = true;
				entry.competitorCount += Number(row.count);
				const compId = resolveCompetitorId(row.domain);
				if (compId) entry.competitorIds.add(compId);
			}
		}

		const competitorOnlyPrompts = Array.from(promptCitationFlags.entries())
			.filter(([, data]) => data.hasCompetitor && !data.hasBrand)
			.map(([id, data]) => {
				const prompt = promptLookup.get(id);
				if (!prompt) return null;
				return { id, value: prompt.value, competitorCitationCount: data.competitorCount, uniqueCompetitors: data.competitorIds.size };
			})
			.filter((p): p is NonNullable<typeof p> => p !== null)
			.sort((a, b) => b.competitorCitationCount - a.competitorCitationCount);

		return {
			totalCitations,
			uniqueDomains: domainDistribution.length,
			categoryCounts,
			domainDistribution,
			specificUrls,
			pageTypeDistribution,
			googleModule,
			availableTags,
			citationTimeSeries,
			pageTypeTimeSeries,
			competitors: competitorSummary,
			competitorOnlyPrompts,
			whatsChanged: {
				newUrls,
				droppedUrls: droppedUrls.slice(0, 10),
				titleChanges: titleChanges.slice(0, 10),
				newDomains,
				droppedDomains: droppedDomains.slice(0, 10),
			},
		};
	});
