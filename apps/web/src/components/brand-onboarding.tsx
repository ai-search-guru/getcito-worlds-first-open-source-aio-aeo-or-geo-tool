
import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

import { useNavigate, useRouter } from "@tanstack/react-router";
import FullPageCard from "@/components/full-page-card";
import { createBrandFn } from "@/server/brands";
import { trackEvent } from "@/lib/posthog";

interface BrandOnboardingProps {
	brandId: string;
	brandName: string;
}

export default function BrandOnboarding({ brandId, brandName }: BrandOnboardingProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const navigate = useNavigate();
	const router = useRouter();

	const handleSubmit = async (formData: FormData) => {
		setIsLoading(true);
		setError("");

		try {
			const website = formData.get("website") as string;
			await createBrandFn({
				data: { brandId, brandName, website },
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
		<FullPageCard title={`Setup ${brandName}`} subtitle="Configure your brand to get started" showBackButton={true}>
			<form action={handleSubmit} className="space-y-4">
				<input type="hidden" name="brandId" value={brandId} />
				<input type="hidden" name="brandName" value={brandName} />

				<div className="space-y-2">
					<Label htmlFor="website">Website</Label>
					<Input
						id="website"
						name="website"
						type="text"
						placeholder="example.com"
						required
						disabled={isLoading}
					/>
					<p className="text-xs text-muted-foreground">Enter your brand's website</p>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<Button type="submit" className="w-full" disabled={isLoading}>
					{isLoading ? "Setting up..." : "Complete Setup"}
				</Button>
			</form>
		</FullPageCard>
	);
}
