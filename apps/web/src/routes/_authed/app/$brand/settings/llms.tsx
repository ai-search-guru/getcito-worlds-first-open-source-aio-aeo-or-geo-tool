/**
 * /app/$brand/settings/llms - LLM configuration page
 *
 * Lists the AI models this brand is tracked against, data-driven from the
 * deployment's `SCRAPE_TARGETS` + `brand.enabledModels`. Each card renders
 * from `brand.effectiveModelConfigs` rather than a hardcoded model list so
 * any deployment-configured model shows up automatically.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useBrand } from "@/hooks/use-brands";
import { iconForModel } from "@/components/filter-bar";
import { Button } from "@workspace/ui/components/button";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authed/app/$brand/settings/llms")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("LLMs", { appName, brandName }) },
				{ name: "description", content: "View tracked AI models and configuration." },
			],
		};
	},
	component: LlmsSettingsPage,
});

function LlmsSettingsPage() {
	const { brand, isLoading } = useBrand();
	const configs = brand?.effectiveModelConfigs ?? [];
	const [chatGptStatus, setChatGptStatus] = useState<{ connected: boolean; email?: string } | null>(null);
	const [chatGptError, setChatGptError] = useState("");
	const [disconnecting, setDisconnecting] = useState(false);

	useEffect(() => {
		if (!brand || !configs.some((config) => config.provider === "openai-api")) return;
		fetch("/api/openai/chatgpt/status", { cache: "no-store" })
			.then(async (response) => {
				const value = await response.json();
				if (!response.ok) throw new Error(value.error ?? "Could not read ChatGPT connection status.");
				setChatGptStatus(value);
			})
			.catch((error: unknown) => setChatGptError(error instanceof Error ? error.message : "Could not read ChatGPT connection status."));
		const authResult = new URLSearchParams(window.location.search).get("chatgptAuth");
		if (authResult === "connected") setChatGptError("");
		if (authResult === "cancelled") setChatGptError("ChatGPT sign-in was cancelled.");
		if (authResult === "failed") setChatGptError("ChatGPT sign-in did not complete. Please try again.");
	}, [brand, configs]);

	const disconnectChatGpt = async () => {
		setDisconnecting(true);
		setChatGptError("");
		try {
			const response = await fetch("/api/openai/chatgpt/status", { method: "POST" });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? "Could not disconnect ChatGPT.");
			setChatGptStatus({ connected: false });
			if (!result.revoked) setChatGptError("Local credentials were cleared, but OpenAI did not confirm token revocation. You can remove GetCito from ChatGPT Settings.");
		} catch (error) {
			setChatGptError(error instanceof Error ? error.message : "Could not disconnect ChatGPT.");
		} finally {
			setDisconnecting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-6xl">
			<div>
				<h1 className="text-3xl font-bold">LLMs</h1>
				<p className="text-muted-foreground">
					Your prompts are evaluated against these AI models to track how your brand appears across different types of AI
					search.
				</p>
			</div>

			{brand && configs.some((config) => config.provider === "openai-api") && (
				<Card>
					<CardHeader>
						<h2 className="text-lg font-semibold">OpenAI access</h2>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="text-sm text-muted-foreground">
							Connect a ChatGPT plan for the OpenAI provider, or configure an OpenAI API key on the server.
						</p>
						{chatGptStatus?.connected ? (
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-sm">
									Connected with ChatGPT as <span className="font-medium">{chatGptStatus.email}</span>
									<span className="mx-2 text-muted-foreground">·</span>
									<a className="underline underline-offset-4" href="https://chatgpt.com/#settings/usage" target="_blank" rel="noreferrer">Manage plan usage</a>
								</p>
								<Button type="button" variant="outline" disabled={disconnecting} onClick={disconnectChatGpt}>
									{disconnecting ? "Disconnecting…" : "Disconnect"}
								</Button>
							</div>
						) : (
							<Button asChild>
								<a href={`/api/openai/chatgpt/start?brand=${encodeURIComponent(brand.id)}`}>Continue with ChatGPT</a>
							</Button>
						)}
						{chatGptError && <p role="alert" className="text-sm text-destructive">{chatGptError}</p>}
					</CardContent>
				</Card>
			)}

			{isLoading && !brand ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Card key={i} className="h-full">
							<CardHeader className="py-2 border-b">
								<Skeleton className="h-6 w-6 rounded" />
							</CardHeader>
							<CardContent className="pt-2 space-y-2">
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-4 w-2/3" />
							</CardContent>
						</Card>
					))}
				</div>
			) : configs.length === 0 ? (
				<Card>
					<CardContent className="pt-6 text-sm text-muted-foreground">
						No models are configured for this brand. Set <code className="font-mono text-xs">SCRAPE_TARGETS</code> at the
						deployment level, or adjust this brand&apos;s <code className="font-mono text-xs">enabledModels</code>.
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{configs.map((config) => (
						<Card key={config.model} className="h-full">
							<CardHeader className="py-2 border-b">
								{iconForModel(config.model, "h-6 w-6")}
							</CardHeader>
							<CardContent className="pt-2">
								<div className="divide-y text-sm">
									<ConfigRow label="Model" tooltip="Which AI model this card covers.">
										<span className="font-mono text-xs text-foreground">{config.model}</span>
									</ConfigRow>
									<ConfigRow label="Provider" tooltip="How this deployment reaches the model — direct API, a scraping proxy, etc.">
										<span className="font-mono text-xs text-foreground">{config.provider}</span>
									</ConfigRow>
									<ConfigRow label="Version" tooltip="Exact upstream model version requested from the provider.">
										<span className="font-mono text-xs text-foreground">{config.version ?? "—"}</span>
									</ConfigRow>
									<ConfigRow label="Web search" tooltip="Is web search used to answer prompts?">
										{config.webSearch ? (
											<IconCircleCheck className="h-4 w-4 text-emerald-600" />
										) : (
											<IconCircleX className="h-4 w-4 text-muted-foreground" />
										)}
										<span className="sr-only">{config.webSearch ? "Enabled" : "Disabled"}</span>
									</ConfigRow>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}

function ConfigRow({
	label,
	tooltip,
	children,
}: {
	label: string;
	tooltip?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between py-2">
			<div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
				<span>{label}</span>
				{tooltip && (
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-xs font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				)}
			</div>
			<div className="flex items-center gap-2">{children}</div>
		</div>
	);
}
