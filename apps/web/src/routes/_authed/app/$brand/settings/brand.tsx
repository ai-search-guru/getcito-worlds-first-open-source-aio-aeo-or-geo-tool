/**
 * /app/$brand/settings/brand - Brand settings page
 *
 * Form to edit brand name, website, additional domains, and aliases.
 */
import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useBrand } from "@/hooks/use-brands";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { updateBrandFn, deleteBrandFn } from "@/server/brands";
import { useNavigate } from "@tanstack/react-router";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { DATAFORSEO_LOCATIONS } from "@workspace/lib/locations";
import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";

export const Route = createFileRoute("/_authed/app/$brand/settings/brand")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Brand Settings", { appName, brandName }) },
				{ name: "description", content: "Manage your brand name and website." },
			],
		};
	},
	component: BrandSettingsPage,
});

function BrandSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const queryClient = useQueryClient();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [additionalDomains, setAdditionalDomains] = useState<string[]>([]);
	const [aliases, setAliases] = useState<string[]>([]);
	const [targetMarket, setTargetMarket] = useState<string>("");
	const [targetLanguage, setTargetLanguage] = useState<string>("");
	const [isDeleting, setIsDeleting] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		if (brand) {
			setAdditionalDomains(brand.additionalDomains || []);
			setAliases(brand.aliases || []);
			setTargetMarket(brand.targetMarket || "");
			setTargetLanguage(brand.targetLanguage || "");
		}
	}, [brand?.updatedAt]);

	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return `"${val}" is not a valid domain`;
		return true;
	}, []);
	const handleAliasesChange = useCallback((values: string[]) => setAliases(values), []);

	const handleTargetMarketChange = (val: string) => {
		setTargetMarket(val);
		if (targetLanguage) {
			const validLangs = DATAFORSEO_LOCATION_LANGUAGES[val] || DATAFORSEO_LANGUAGES;
			if (!validLangs.some(l => l.name === targetLanguage)) {
				setTargetLanguage("");
			}
		}
	};

	const availableLanguages = targetMarket && DATAFORSEO_LOCATION_LANGUAGES[targetMarket] 
		? DATAFORSEO_LOCATION_LANGUAGES[targetMarket] 
		: DATAFORSEO_LANGUAGES;

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-destructive">Brand not found</p>
				</div>
			</div>
		);
	}

	const handleSubmit = async (formData: FormData) => {
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const name = formData.get("name") as string;
			const website = formData.get("website") as string;

			await updateBrandFn({
				data: {
					brandId: brand.id,
					name,
					website,
					targetMarket: targetMarket || undefined,
					targetLanguage: targetLanguage || undefined,
					additionalDomains,
					aliases,
				},
			});

			// Domain/alias changes affect citation categorization and mention detection
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess("Brand details updated successfully!");
			await revalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDelete = async () => {
		if (!confirm(`Are you sure you want to permanently delete "${brand.name}" and all of its data? This cannot be undone.`)) {
			return;
		}

		setIsDeleting(true);
		setError("");
		
		try {
			await deleteBrandFn({ data: { brandId: brand.id } });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			await navigate({ to: "/app" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete brand");
			setIsDeleting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h1 className="text-3xl font-bold">Brand</h1>
				<p className="text-muted-foreground">Manage your brand name and website</p>
			</div>

			<form action={handleSubmit} className="space-y-6">
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Brand Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="Brand Name"
							defaultValue={brand.name}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Enter your brand&apos;s name</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">Website</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							defaultValue={brand.website}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Your brand&apos;s primary website</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="targetMarket">Target Market</Label>
						<Select value={targetMarket} onValueChange={handleTargetMarketChange} disabled={isSubmitting}>
							<SelectTrigger id="targetMarket">
								<SelectValue placeholder="Select target market (e.g. United States)" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{DATAFORSEO_LOCATIONS.map((location) => (
										<SelectItem key={location} value={location}>
											{location}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">The location you want the LLM scraper to target.</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="targetLanguage">Target Language</Label>
						<Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={isSubmitting || !targetMarket}>
							<SelectTrigger id="targetLanguage">
								<SelectValue placeholder={targetMarket ? "Select target language" : "Select a market first"} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{availableLanguages.map((lang) => (
										<SelectItem key={lang.name} value={lang.name}>
											{lang.name}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">The language you want the LLM scraper to use.</p>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Additional Domains
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Other domains your brand owns (e.g. blog.example.com, shop.example.com). Citations from these domains will be counted as your brand&apos;s citations. <strong>Updates retroactively</strong> &mdash; existing citations will be reclassified immediately.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={additionalDomains}
							onValueChange={setAdditionalDomains}
							placeholder="Add domain..."
							searchPlaceholder="Add domain..."
							maxItems={10}
							normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
							onValidate={validateDomain}
						/>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Brand Aliases
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Alternative names for your brand (sub-brands, product lines, abbreviations). Used for mention detection in <strong>future</strong> prompt runs only &mdash; does not apply retroactively to past results.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={aliases}
							onValueChange={handleAliasesChange}
							placeholder="Add alias..."
							searchPlaceholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>

				{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
				{success && <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">{success}</div>}

				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting || isDeleting} className="cursor-pointer">
						{isSubmitting ? "Saving..." : "Save Changes"}
					</Button>
				</div>
			</form>

			<div className="mt-12 pt-6 border-t border-border">
				<h3 className="text-lg font-medium text-destructive mb-2">Danger Zone</h3>
				<p className="text-sm text-muted-foreground mb-4">
					Permanently delete this brand and all of its associated data, including prompts and run history. This action cannot be undone.
				</p>
				<Button 
					variant="destructive" 
					onClick={handleDelete}
					disabled={isSubmitting || isDeleting}
				>
					{isDeleting ? "Deleting..." : "Delete Brand"}
				</Button>
			</div>
		</div>
	);
}
