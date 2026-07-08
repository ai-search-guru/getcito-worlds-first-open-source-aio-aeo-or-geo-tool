/**
 * /app/new - Create a new brand (local mode only).
 *
 * Provisions a new organization + admin membership for the current user
 * and seeds the brand row with the supplied name + website. Whitelabel and
 * demo are blocked at both the loader (redirect to /app) and the server
 * function (canCreateBrands policy).
 */
import { useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import FullPageCard from "@/components/full-page-card";
import { trackEvent } from "@/lib/posthog";
import { createBrandWithOrgFn } from "@/server/brands";
import { getDeployment } from "@/lib/config/server";
import { DATAFORSEO_LOCATIONS } from "@workspace/lib/locations";
import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";

const getCanCreateBrands = createServerFn({ method: "GET" }).handler(async () => {
	return { canCreateBrands: getDeployment().features.canCreateBrands };
});

export const Route = createFileRoute("/_authed/app/new")({
	loader: async () => {
		const { canCreateBrands } = await getCanCreateBrands();
		if (!canCreateBrands) {
			throw redirect({ to: "/app" });
		}
		return { canCreateBrands };
	},
	component: NewBrandPage,
});

function NewBrandPage() {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [targetMarket, setTargetMarket] = useState<string>("");
	const [targetLanguage, setTargetLanguage] = useState<string>("");
	const navigate = useNavigate();
	const router = useRouter();

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

	const handleSubmit = async (formData: FormData) => {
		setIsLoading(true);
		setError("");

		try {
			const brandName = (formData.get("brandName") as string)?.trim() ?? "";
			const website = (formData.get("website") as string)?.trim() ?? "";
			const targetMarket = (formData.get("targetMarket") as string)?.trim() ?? undefined;
			const targetLanguage = (formData.get("targetLanguage") as string)?.trim() ?? undefined;

			const { brandId } = await createBrandWithOrgFn({
				data: { brandName, website, targetMarket, targetLanguage },
			});
			trackEvent("brand_created", { has_website: Boolean(website) });

			await router.invalidate();
			await navigate({ to: "/app/$brand", params: { brand: brandId } });
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<FullPageCard title="Create a new brand" subtitle="Set up a brand to start tracking" showBackButton>
			<form action={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="brandName">Brand name</Label>
					<Input id="brandName" name="brandName" type="text" placeholder="Acme" required disabled={isLoading} />
				</div>

				<div className="space-y-2">
					<Label htmlFor="website">Website</Label>
					<Input id="website" name="website" type="text" placeholder="example.com" required disabled={isLoading} />
				</div>

				<div className="space-y-2">
					<Label htmlFor="targetMarket">Target Market (Optional)</Label>
					<Select name="targetMarket" value={targetMarket} onValueChange={handleTargetMarketChange} disabled={isLoading}>
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
				</div>

				<div className="space-y-2">
					<Label htmlFor="targetLanguage">Target Language (Optional)</Label>
					<Select name="targetLanguage" value={targetLanguage} onValueChange={setTargetLanguage} disabled={isLoading || !targetMarket}>
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
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<Button type="submit" className="w-full" disabled={isLoading}>
					{isLoading ? "Creating..." : "Create brand"}
				</Button>
			</form>
		</FullPageCard>
	);
}
