/**
 * Single-step onboarding wizard.
 *
 * One LLM call returns brand info + competitors + prompts; the user reviews
 * and edits before saving. Replaces the prior 4-step wizard that required
 * DataForSEO + Anthropic in tandem.
 */
import { useState, useCallback, useEffect, memo, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Loader2, AlertCircle, Play, Rocket } from "lucide-react";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Separator } from "@workspace/ui/components/separator";
import { useBrand, brandKeys } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { promptsSummaryKeys } from "@/hooks/use-prompts-summary";
import {
	analyzeBrandInfoFn,
	analyzeCompetitorsFn,
	analyzePromptsFn,
	cancelAnalyzeBrandFn,
	updateOnboardedBrandFn,
} from "@/server/onboarding";
import { trackEvent } from "@/lib/posthog";
import { CompetitorsEditor, newCompetitorEntry, type CompetitorEntry } from "@/components/competitors-editor";
import { PromptsListEditor, newPromptEntry, type EditablePrompt } from "@/components/prompts-list-editor";
import { WebLogo } from "./web-logo";

interface PromptWizardProps {
	onComplete: () => void;
}

/** Brand analysis runs in the worker (LLM + web search, ~1 min); the client polls for the result. */
const POLL_INTERVAL_MS = 2000;
const ANALYZE_TIMEOUT_MS = 6 * 60 * 1000; // give up after ~6 minutes

const analyzeStatusKey = (brandId: string) => ["analyze-brand", "status", brandId] as const;

interface WizardData {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: CompetitorEntry[];
	prompts: EditablePrompt[];
	shortDescription?: string;
	productsAndServices?: string[];
	keywords?: string[];
}

const EditableTagsInput = memo(
	({
		items,
		onValueChange,
		placeholder = "Add item...",
		maxItems = 10,
	}: {
		items: string[];
		onValueChange: (value: string[]) => void;
		placeholder?: string;
		maxItems?: number;
	}) => (
		<div className="space-y-2">
			<TagsInput
				value={items}
				onValueChange={onValueChange}
				placeholder={placeholder}
				searchPlaceholder={placeholder}
				maxItems={maxItems}
			/>
			<p className="text-xs text-muted-foreground">
				<strong>
					{items.length}/{maxItems}
				</strong>{" "}
				{items.length >= maxItems ? "items added. Remove an item to add a new one." : "items entered."}
			</p>
		</div>
	),
);
EditableTagsInput.displayName = "EditableTagsInput";

export default function PromptWizard({ onComplete }: PromptWizardProps) {
	const { brand } = useBrand();
	const queryClient = useQueryClient();
	const router = useRouter();
	const STORAGE_KEY = brand?.id ? `getcito_onboarding_${brand.id}` : null;

	const [phase, setPhase] = useState<"idle" | "analyzing" | "review">(() => {
		if (typeof window !== "undefined" && STORAGE_KEY) {
			if (localStorage.getItem(STORAGE_KEY)) return "review";
		}
		return "idle";
	});
	const [error, setError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	
	const [data, setData] = useState<WizardData>(() => {
		if (typeof window !== "undefined" && STORAGE_KEY) {
			const cached = localStorage.getItem(STORAGE_KEY);
			if (cached) {
				try {
					return JSON.parse(cached);
				} catch (e) {
					// ignore
				}
			}
		}
		return {
			brandName: brand?.name || "",
			website: brand?.website || "",
			additionalDomains: brand?.additionalDomains || [],
			aliases: brand?.aliases || [],
			competitors: [],
			prompts: [],
		};
	});

	const brandId = brand?.id;

	// Stop polling, drop the cached status so the next run starts clean, and
	// (best-effort) cancel the worker job. `errorMessage` surfaces a reason
	// (timeout); a bare cancel passes null.
	const stopAnalyzing = useCallback(
		(errorMessage: string | null) => {
			setPhase("idle");
			setError(errorMessage);
			if (brandId) {
				queryClient.removeQueries({ queryKey: analyzeStatusKey(brandId) });
				cancelAnalyzeBrandFn({ data: { brandId } }).catch(() => {});
			}
		},
		[brandId, queryClient],
	);

	const { mutate: enqueueAnalysis, isPending: isAnalyzingBrand } = useMutation({
		mutationFn: (vars: { brandId: string; website: string; brandName?: string }) =>
			analyzeBrandInfoFn({ data: vars }),
		onMutate: () => {
			setError(null);
			setPhase("analyzing");
		},
		onSuccess: (result) => {
			const newData: WizardData = {
				...data,
				brandName: result.brandName || brand?.name || "",
				website: brand?.website || result.website || "",
				additionalDomains: result.additionalDomains,
				aliases: result.aliases,
				competitors: result.competitors.map((c) =>
					newCompetitorEntry({ name: c.name, domains: c.domains, aliases: c.aliases, expanded: false }),
				),
				prompts: result.suggestedPrompts.map((p) =>
					newPromptEntry({ value: p.prompt, tags: p.tags, enabled: true }),
				),
				shortDescription: result.shortDescription,
				productsAndServices: result.productsAndServices,
				keywords: result.keywords,
			};
			setData(newData);
			if (STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
			setPhase("review");
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Analysis failed");
			setPhase("idle");
		},
	});

	const { mutate: enqueueCompetitorsAnalysis, isPending: isAnalyzingCompetitors } = useMutation({
		mutationFn: (vars: { brandId: string; website: string; brandName: string }) =>
			analyzeCompetitorsFn({ data: vars }),
		onSuccess: (result) => {
			setData((prev) => ({
				...prev,
				competitors: result.competitors.map((c) =>
					newCompetitorEntry({
						name: c.name,
						domains: c.domains,
						aliases: c.aliases,
						expanded: false,
					}),
				),
			}));
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Competitors analysis failed");
		},
	});

	const { mutate: enqueuePromptsAnalysis, isPending: isAnalyzingPrompts } = useMutation({
		mutationFn: (vars: { brandId: string; website: string; brandName: string; competitorNames: string[] }) =>
			analyzePromptsFn({ data: vars }),
		onSuccess: (result) => {
			setData((prev) => ({
				...prev,
				prompts: result.suggestedPrompts.map((p) =>
					newPromptEntry({ value: p.prompt, tags: p.tags, enabled: true }),
				),
			}));
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Prompts analysis failed");
		},
	});

	const handleAnalyze = useCallback(() => {
		if (!brand?.website || !brand?.id) return;
		enqueueAnalysis({ brandId: brand.id, website: brand.website, brandName: brand.name });
	}, [brand?.website, brand?.id, brand?.name, enqueueAnalysis]);

	const handleAnalyzeCompetitors = useCallback(() => {
		if (!brand?.id) return;
		enqueueCompetitorsAnalysis({
			brandId: brand.id,
			website: data.website || brand.website,
			brandName: data.brandName || brand.name,
		});
	}, [brand, data.website, data.brandName, enqueueCompetitorsAnalysis]);

	const handleAnalyzePrompts = useCallback(() => {
		if (!brand?.id) return;
		enqueuePromptsAnalysis({
			brandId: brand.id,
			website: data.website || brand.website,
			brandName: data.brandName || brand.name,
			competitorNames: data.competitors.map((c) => c.name).filter(Boolean),
		});
	}, [brand, data.website, data.brandName, data.competitors, enqueuePromptsAnalysis]);

	const hasAutoAnalyzed = useRef(false);

	// Synchronize form progress to localStorage so hard refreshes don't lose data
	useEffect(() => {
		if (STORAGE_KEY && phase === "review") {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		}
	}, [data, phase, STORAGE_KEY]);

	// Auto-start analysis when component mounts
	useEffect(() => {
		if (phase === "idle" && !hasAutoAnalyzed.current && brand?.website && brand?.id) {
			hasAutoAnalyzed.current = true;
			handleAnalyze();
		}
	}, [brand?.website, brand?.id, phase, handleAnalyze]);

	// Update phase state to respect isAnalyzingBrand
	useEffect(() => {
		if (isAnalyzingBrand) setPhase("analyzing");
	}, [isAnalyzingBrand]);

	// Give up on a stuck analysis instead of polling forever.
	useEffect(() => {
		if (phase !== "analyzing") return;
		const timer = window.setTimeout(
			() => stopAnalyzing("Brand analysis timed out. Please try again."),
			ANALYZE_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [phase, stopAnalyzing]);

	const updateBrandName = useCallback((brandName: string) => setData((p) => ({ ...p, brandName })), []);
	const updateWebsite = useCallback((website: string) => setData((p) => ({ ...p, website })), []);
	const updateAliases = useCallback((aliases: string[]) => setData((p) => ({ ...p, aliases })), []);
	const updateAdditionalDomains = useCallback(
		(additionalDomains: string[]) => setData((p) => ({ ...p, additionalDomains })),
		[],
	);
	const updateCompetitors = useCallback(
		(competitors: CompetitorEntry[]) => setData((p) => ({ ...p, competitors })),
		[],
	);
	const updatePrompts = useCallback(
		(prompts: EditablePrompt[]) => setData((p) => ({ ...p, prompts })),
		[],
	);
	const updateShortDescription = useCallback((shortDescription: string) => setData((p) => ({ ...p, shortDescription })), []);
	const updateProductsAndServices = useCallback(
		(productsAndServices: string[]) => setData((p) => ({ ...p, productsAndServices })),
		[],
	);
	const updateKeywords = useCallback(
		(keywords: string[]) => setData((p) => ({ ...p, keywords })),
		[],
	);

	const previewCounts = useMemo(() => {
		const enabled = data.prompts.filter((p) => p.enabled && p.value.trim().length > 0).length;
		return { totalNew: enabled };
	}, [data.prompts]);

	const handleSubmit = useCallback(async () => {
		if (!brand?.id) return;
		setSubmitError(null);
		setIsSaving(true);
		try {
			const competitorsPayload = data.competitors
				.filter((c) => c.name.trim() && c.domains.some((d) => d.trim()))
				.map((c) => ({
					name: c.name.trim(),
					domains: c.domains.filter((d) => d.trim()),
					aliases: c.aliases,
				}));

			const promptsPayload = data.prompts
				.filter((p) => p.enabled && p.value.trim())
				.map((p) => ({ value: p.value.trim(), tags: p.tags, enabled: true }));

			await updateOnboardedBrandFn({
				data: {
					brandId: brand.id,
					brandName: data.brandName.trim() || brand.name,
					website: data.website.trim() || brand.website,
					additionalDomains: data.additionalDomains,
					aliases: data.aliases,
					competitors: competitorsPayload,
					prompts: promptsPayload,
					shortDescription: data.shortDescription,
					productsAndServices: data.productsAndServices,
					keywords: data.keywords,
				},
			});

			trackEvent("wizard_completed", {
				prompts_created: promptsPayload.length,
				competitors_created: competitorsPayload.length,
				skipped: false,
			});

			// Deployments without an onboardingRedirectUrlTemplate (e.g. local mode) skip the full reload, so caches fetched while !onboarded must be busted explicitly.
			queryClient.invalidateQueries({ queryKey: brandKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: promptsSummaryKeys.all });
			// The $brand route loader feeds `brand` into AppSidebar; invalidate it so the sidebar picks up onboarded=true.
			await router.invalidate();

			if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
			onComplete();
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setIsSaving(false);
		}
	}, [brand, data, queryClient, router, onComplete]);

	if (phase === "idle" || phase === "analyzing") {
		return (
			<div className="max-w-2xl mx-auto space-y-6">
				<div className="space-y-2">
					<h2 className="text-2xl font-bold">Analyzing {brand?.name || "Brand"}</h2>
					<p className="text-muted-foreground text-balance">
						Please wait while we analyze {brand?.website} to find competitors, additional domains, and the best generative AI prompts to track. This process may take a couple of minutes.
					</p>
				</div>
				
				{error ? (
					<div className="space-y-4">
						<div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
							<AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
							<span>{error}</span>
						</div>
						<Button
							onClick={handleAnalyze}
							className="flex items-center gap-2 cursor-pointer"
						>
							<Play className="h-4 w-4" /> Retry Analysis
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" /> 
						<span className="font-medium text-foreground">Analyzing brand data...</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="space-y-2">
				<div className="flex items-center gap-4">
					<WebLogo domain={data.website} size={48} />
					<div>
						<h2 className="text-2xl font-bold">Brand details</h2>
						<p className="text-muted-foreground">
							Confirm the brand identity, additional domains, and aliases used for tracking.
						</p>
					</div>
				</div>
				<div className="space-y-3 mt-4">
					<div>
						<p className="text-xs text-muted-foreground">Brand name</p>
						<Input
							value={data.brandName}
							onChange={(e) => updateBrandName(e.target.value)}
							placeholder="Brand name"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Website URL</p>
						<Input
							type="url"
							value={data.website}
							onChange={(e) => updateWebsite(e.target.value)}
							placeholder="https://example.com"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Additional domains</p>
						<EditableTagsInput
							items={data.additionalDomains}
							onValueChange={updateAdditionalDomains}
							placeholder="Add domain..."
							maxItems={10}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Aliases</p>
						<EditableTagsInput
							items={data.aliases}
							onValueChange={updateAliases}
							placeholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>
				<div className="space-y-3 mt-3">
					<div>
						<p className="text-xs text-muted-foreground">Short description</p>
						<Input
							value={data.shortDescription || ""}
							onChange={(e) => updateShortDescription(e.target.value)}
							placeholder="Brief summary of the brand..."
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Products and services</p>
						<EditableTagsInput
							items={data.productsAndServices || []}
							onValueChange={updateProductsAndServices}
							placeholder="Add product or service..."
							maxItems={20}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Keywords</p>
						<EditableTagsInput
							items={data.keywords || []}
							onValueChange={updateKeywords}
							placeholder="Add keyword..."
							maxItems={20}
						/>
					</div>
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold">Competitors</h2>
						<p className="text-sm text-muted-foreground">Companies you want tracked alongside your brand.</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={handleAnalyzeCompetitors}
						disabled={isAnalyzingCompetitors || isSaving}
					>
						{isAnalyzingCompetitors ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" /> Finding…
							</>
						) : (
							"Find Competitors"
						)}
					</Button>
				</div>
				<CompetitorsEditor competitors={data.competitors} onChange={updateCompetitors} disabled={isSaving} />
			</div>

			<Separator />

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold">Prompts</h2>
						<p className="text-sm text-muted-foreground">
							Pick which AI tracking prompts to start with. <br /> Untick any you don't want, edit tags, or add your own at the bottom.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={handleAnalyzePrompts}
						disabled={isAnalyzingPrompts || isSaving}
					>
						{isAnalyzingPrompts ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" /> Suggesting…
							</>
						) : (
							"Suggest Prompts"
						)}
					</Button>
				</div>
				<PromptsListEditor prompts={data.prompts} onChange={updatePrompts} showSystemTags={false} />
			</div>

			{submitError && (
				<div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					<AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
					<div className="text-sm">{submitError}</div>
				</div>
			)}

			<Button
				onClick={handleSubmit}
				disabled={isSaving || previewCounts.totalNew === 0}
				className="flex items-center gap-2 cursor-pointer"
			>
				{isSaving ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> Saving…
					</>
				) : (
					<>
						<Rocket className="h-4 w-4" /> Start tracking ({previewCounts.totalNew} new prompts)
					</>
				)}
			</Button>
		</div>
	);
}

