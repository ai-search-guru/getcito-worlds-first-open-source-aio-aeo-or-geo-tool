/**
 * /admin/tools — Admin utility for running the onboarding analysis against an
 * arbitrary website without going through the wizard.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getAppName } from "@/lib/route-head";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Sparkles, Loader2, Copy, Check } from "lucide-react";
import { adminAnalyzeBrandFn } from "@/server/admin";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";

function AnalyzeBrandDialog() {
	const [open, setOpen] = useState(false);
	const [website, setWebsite] = useState("");
	const [brandName, setBrandName] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<OnboardingSuggestion | null>(null);
	const [copied, setCopied] = useState(false);

	const handleAnalyze = async () => {
		if (!website.trim()) {
			setError("Please enter a website URL");
			return;
		}
		setError(null);
		setResult(null);
		setIsLoading(true);
		try {
			const data = await adminAnalyzeBrandFn({
				data: {
					website: website.trim(),
					brandName: brandName.trim() || undefined,
				},
			});
			setResult(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const handleCopy = async () => {
		if (!result) return;
		await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleCopyPrompts = async () => {
		if (!result) return;
		await navigator.clipboard.writeText(result.suggestedPrompts.map((p) => p.prompt).join("\n"));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleClose = () => {
		setOpen(false);
		setWebsite("");
		setBrandName("");
		setResult(null);
		setError(null);
	};

	return (
		<Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
			<DialogTrigger asChild>
				<Button variant="outline" className="cursor-pointer w-full">
					<Sparkles className="h-4 w-4 mr-2" />
					Analyze brand
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Analyze brand</DialogTitle>
					<DialogDescription>
						Run the onboarding analysis for any website.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="analyze-website">Website URL</Label>
							<Input
								id="analyze-website"
								placeholder="https://example.com"
								value={website}
								onChange={(e) => setWebsite(e.target.value)}
								disabled={isLoading}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="analyze-brand">Brand name (optional)</Label>
							<Input
								id="analyze-brand"
								placeholder="Auto-detected from URL"
								value={brandName}
								onChange={(e) => setBrandName(e.target.value)}
								disabled={isLoading}
							/>
						</div>
					</div>

					<Button onClick={handleAnalyze} disabled={isLoading} className="cursor-pointer w-full">
						{isLoading ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Analyzing… (this may take a minute)
							</>
						) : (
							"Analyze"
						)}
					</Button>

					{error && <p className="text-sm text-destructive">{error}</p>}

					{result && (
						<div className="space-y-4">
							<div className="flex items-center justify-between">
								<h4 className="font-semibold">{result.brandName}</h4>
								<div className="flex gap-2">
									<Button variant="ghost" size="sm" onClick={handleCopyPrompts} className="cursor-pointer">
										{copied ? (
											<>
												<Check className="h-4 w-4 mr-1" /> Copied
											</>
										) : (
											<>
												<Copy className="h-4 w-4 mr-1" /> Copy prompts
											</>
										)}
									</Button>
									<Button variant="ghost" size="sm" onClick={handleCopy} className="cursor-pointer">
										<Copy className="h-4 w-4 mr-1" /> Copy JSON
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4 text-sm">
								<Stat label="Competitors" value={result.competitors.length} />
								<Stat label="Prompts" value={result.suggestedPrompts.length} />
							</div>

							{result.additionalDomains.length > 0 && (
								<TagSection title="Additional domains" items={result.additionalDomains} />
							)}
							{result.aliases.length > 0 && <TagSection title="Aliases" items={result.aliases} />}

							{result.competitors.length > 0 && (
								<div className="space-y-2">
									<Label className="text-muted-foreground">Competitors</Label>
									<div className="space-y-1 text-sm">
										{result.competitors.map((c) => (
											<div key={c.name} className="flex items-center gap-2">
												<span className="font-medium">{c.name}</span>
												<span className="text-muted-foreground">({c.domains.join(", ") || "—"})</span>
											</div>
										))}
									</div>
								</div>
							)}

							{result.suggestedPrompts.length > 0 && (
								<div className="space-y-2">
									<Label className="text-muted-foreground">Prompts</Label>
									<div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-1 text-sm">
										{result.suggestedPrompts.map((p, i) => (
											<div key={p.prompt} className="flex items-start gap-2 py-1 border-b last:border-0">
												<span className="text-muted-foreground w-6 flex-shrink-0">{i + 1}.</span>
												<span className="flex-1">{p.prompt}</span>
												<div className="flex flex-wrap gap-1 flex-shrink-0">
													{p.tags.map((tag) => (
														<Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
															{tag}
														</Badge>
													))}
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<Label className="text-muted-foreground">{label}</Label>
			<p className="font-medium">{value.toLocaleString()}</p>
		</div>
	);
}

function TagSection({ title, items }: { title: string; items: string[] }) {
	return (
		<div className="space-y-1">
			<Label className="text-muted-foreground">{title}</Label>
			<div className="flex flex-wrap gap-1">
				{items.map((it) => (
					<Badge key={it} variant="secondary">
						{it}
					</Badge>
				))}
			</div>
		</div>
	);
}

export const Route = createFileRoute("/_authed/admin/tools")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: `Tools · ${appName}` },
				{ name: "description", content: "Brand onboarding analysis." },
			],
		};
	},
	component: ToolsPage,
});

function ToolsPage() {
	return (
		<div className="space-y-8">
			<div className="space-y-2">
				<h1 className="text-3xl font-bold tracking-tight">Tools</h1>
				<p className="text-muted-foreground">
					Run the onboarding analysis for any brand without creating it. Same pipeline as the wizard and
					<code className="mx-1 rounded bg-muted px-1">POST /api/v1/tools/analyze</code>.
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Sparkles className="h-5 w-5" />
							Brand analysis
						</CardTitle>
						<CardDescription>
							Analyze a website to discover its competitors, additional brand domains, aliases, and
							suggested AI tracking prompts. Works with any configured LLM provider.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<AnalyzeBrandDialog />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
