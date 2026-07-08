import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd } from "@/lib/seo";
import { getStatusData, type TargetStatus, type StatusEntry } from "@/lib/status";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "@workspace/ui/components/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	ResponsiveContainer,
} from "recharts";

const title = "Provider Status · Getcito";
const description =
	"Real-time status and performance monitoring for AI search provider integrations.";

export const Route = createFileRoute("/status")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/status" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/status") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Status", path: "/status" },
			]),
		],
	}),
	loader: () => getStatusData(),
	component: StatusPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseTarget(target: string) {
	const parts = target.split(":");
	const model = parts[0];
	const provider = parts[1];
	const rest = parts.slice(2).join(":");
	return { model, provider, rest };
}

function formatModel(model: string) {
	const names: Record<string, string> = {
		chatgpt: "ChatGPT",
		claude: "Claude",
		gemini: "Gemini",
		grok: "Grok",
		perplexity: "Perplexity",
		copilot: "Copilot",
		deepseek: "DeepSeek",
		mistral: "Mistral",
		"google-ai-mode": "Google AI Mode",
		"google-ai-overview": "Google AI Overview",
	};
	return names[model] || model;
}

function formatProvider(provider: string) {
	const names: Record<string, string> = {
		olostep: "Olostep",
		brightdata: "BrightData",
		oxylabs: "Oxylabs",
		dataforseo: "DataForSEO",
		"openai-api": "OpenAI API",
		"anthropic-api": "Anthropic API",
		"mistral-api": "Mistral API",
		openrouter: "OpenRouter",
	};
	return names[provider] || provider;
}

function formatLatency(ms: number) {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}m${(s % 60).toString().padStart(2, "0")}s` : `${s}s`;
}

function getUptime(entries: StatusEntry[]) {
	if (entries.length === 0) return null;
	const passes = entries.filter((e) => e.status === "pass").length;
	return (passes / entries.length) * 100;
}

function getLatest(entries: StatusEntry[]): StatusEntry | null {
	if (entries.length === 0) return null;
	return entries[entries.length - 1];
}

// Group targets by model for display
function groupByModel(data: TargetStatus[]) {
	const groups: Record<string, TargetStatus[]> = {};
	for (const d of data) {
		const { model } = parseTarget(d.target);
		if (!groups[model]) groups[model] = [];
		groups[model].push(d);
	}
	return groups;
}

// Deduplicate entries that are within 5 minutes of each other (same run)
function dedupeEntries(entries: StatusEntry[]): StatusEntry[] {
	if (entries.length === 0) return [];
	const result: StatusEntry[] = [entries[0]];
	for (let i = 1; i < entries.length; i++) {
		const prev = new Date(result[result.length - 1].ts).getTime();
		const curr = new Date(entries[i].ts).getTime();
		if (curr - prev > 5 * 60 * 1000) {
			result.push(entries[i]);
		}
	}
	return result;
}

// ─── Components ───────────────────────────────────────────────────────────

function UptimeBadge({ entries }: { entries: StatusEntry[] }) {
	if (entries.length === 0) return <Badge variant="outline">No data</Badge>;
	const latest = entries[entries.length - 1];
	if (latest.status === "fail") return <Badge className="bg-red-600 text-white">Failing</Badge>;
	return <Badge className="bg-green-600 text-white">Operational</Badge>;
}

function UptimeBar({ entries }: { entries: StatusEntry[] }) {
	const deduped = dedupeEntries(entries);
	if (deduped.length === 0) return null;

	// Show last 7 days as a horizontal bar of pass/fail dots
	const now = Date.now();
	const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

	// Bucket into 6-hour windows (28 buckets for 7 days)
	// Track both the latest status and whether there was a mix of pass/fail
	const buckets: { latest: "pass" | "fail" | "none"; hadFail: boolean }[] =
		Array.from({ length: 28 }, () => ({ latest: "none", hadFail: false }));
	for (const entry of deduped) {
		const t = new Date(entry.ts).getTime();
		if (t < sevenDaysAgo) continue;
		const idx = Math.floor(((t - sevenDaysAgo) / (7 * 24 * 60 * 60 * 1000)) * 28);
		const bi = Math.min(idx, 27);
		if (entry.status === "fail") buckets[bi].hadFail = true;
		buckets[bi].latest = entry.status;
	}

	return (
		<div className="flex gap-0.5">
			{buckets.map((b, i) => (
				<div
					key={i}
					className={`h-6 flex-1 rounded-sm ${
						b.latest === "none"
							? "bg-zinc-100"
							: b.latest === "fail"
								? "bg-red-500"
								: b.hadFail
									? "bg-orange-400"
									: "bg-green-500"
					}`}
				/>
			))}
		</div>
	);
}

function LatencyChart({ data }: { data: TargetStatus[] }) {
	// Merge all targets into a time-series chart
	// Bucket by ~6 hours for a clean chart
	const allTimestamps = new Set<string>();
	const targetNames = data.map((d) => {
		const { model, provider } = parseTarget(d.target);
		return `${formatModel(model)} (${formatProvider(provider)})`;
	});

	// Build chart data: each row is a time bucket, columns are targets
	const bucketMs = 6 * 60 * 60 * 1000;
	const now = Date.now();
	const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

	const bucketMap: Record<number, Record<string, number[]>> = {};

	for (let i = 0; i < data.length; i++) {
		const deduped = dedupeEntries(data[i].entries);
		const name = targetNames[i];
		for (const entry of deduped) {
			if (entry.status !== "pass") continue;
			const t = new Date(entry.ts).getTime();
			if (t < sevenDaysAgo) continue;
			const bucket = Math.floor(t / bucketMs) * bucketMs;
			if (!bucketMap[bucket]) bucketMap[bucket] = {};
			if (!bucketMap[bucket][name]) bucketMap[bucket][name] = [];
			bucketMap[bucket][name].push(entry.latency);
		}
	}

	const chartData = Object.entries(bucketMap)
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([ts, values]) => {
			const row: Record<string, any> = {
				time: new Date(Number(ts)).toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
					hour: "numeric",
				}),
			};
			for (const [name, latencies] of Object.entries(values)) {
				// Use median to smooth outliers
				latencies.sort((a, b) => a - b);
				row[name] = latencies[Math.floor(latencies.length / 2)];
			}
			return row;
		});

	if (chartData.length === 0) {
		return (
			<div className="py-12 text-center text-sm text-zinc-600">
				No latency data available yet. Data will appear after the first scheduled run.
			</div>
		);
	}

	const colors = [
		"hsl(221, 83%, 53%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)",
		"hsl(0, 84%, 60%)", "hsl(262, 83%, 58%)", "hsl(174, 72%, 40%)",
		"hsl(330, 81%, 60%)", "hsl(200, 98%, 39%)", "hsl(47, 95%, 53%)",
		"hsl(15, 75%, 55%)",
	];

	const config: ChartConfig = {};
	const uniqueNames = [...new Set(targetNames)];
	uniqueNames.forEach((name, i) => {
		config[name] = { label: name, color: colors[i % colors.length] };
	});

	return (
		<ChartContainer config={config} className="h-[400px] w-full">
			<LineChart data={chartData}>
				<CartesianGrid strokeDasharray="3 3" />
				<XAxis dataKey="time" tick={{ fontSize: 11 }} />
				<YAxis
					tick={{ fontSize: 11 }}
					tickFormatter={(v) => formatLatency(v)}
					label={{ value: "Latency", angle: -90, position: "insideLeft", style: { fontSize: 12 } }}
				/>
				<ChartTooltip
					content={({ active, payload, label }: any) => {
						if (!active || !payload?.length) return null;
						const sorted = [...payload].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));
						return (
							<div className="border-border/50 bg-background min-w-[10rem] rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
								<div className="font-medium mb-1.5">{label}</div>
								<div className="grid gap-1.5">
									{sorted.map((item: any) => (
										<div key={item.dataKey} className="flex items-center gap-2">
											<div className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
											<span className="flex-1 text-zinc-600">{item.name}</span>
											<span className="font-mono font-medium tabular-nums">{formatLatency(item.value as number)}</span>
										</div>
									))}
								</div>
							</div>
						);
					}}
				/>
				{uniqueNames.map((name, i) => (
					<Line
						key={name}
						type="monotone"
						dataKey={name}
						stroke={colors[i % colors.length]}
						strokeWidth={2}
						dot={false}
						connectNulls
					/>
				))}
			</LineChart>
		</ChartContainer>
	);
}


function StatWithSparkline({
	label,
	value,
	sparkData,
	timestamps,
	sparkColor = "hsl(221, 83%, 53%)",
	formatFn,
}: {
	label: string;
	value: string;
	sparkData: number[];
	timestamps: string[];
	sparkColor?: string;
	formatFn?: (v: number) => string;
}) {
	const [show, setShow] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [pos, setPos] = useState({ x: 0, y: 0 });

	useEffect(() => {
		if (show && triggerRef.current) {
			const rect = triggerRef.current.getBoundingClientRect();
			setPos({ x: rect.left + rect.width / 2, y: rect.top });
		}
	}, [show]);

	if (sparkData.length === 0) {
		return <span>{label}: {value}</span>;
	}

	const isInteger = sparkData.every((v) => Number.isInteger(v));
	const yTickFmt = (v: number) => {
		if (formatFn) return formatFn(v);
		if (isInteger) return String(Math.round(v));
		return String(v);
	};

	// For a single data point, pad with a synthetic earlier point to create a dotted line
	let chartData: { ts: string; v: number; synthetic?: boolean }[];
	if (sparkData.length === 1) {
		const realTs = timestamps[0];
		const syntheticTs = new Date(new Date(realTs).getTime() - 24 * 60 * 60 * 1000).toISOString();
		chartData = [
			{ ts: syntheticTs, v: sparkData[0], synthetic: true },
			{ ts: realTs, v: sparkData[0] },
		];
	} else {
		chartData = sparkData.map((v, i) => ({ ts: timestamps[i], v }));
	}

	// Y-axis: representative range with some padding
	const vals = sparkData;
	const min = Math.min(...vals);
	const max = Math.max(...vals);
	const padding = max === min ? Math.max(1, max * 0.2) : (max - min) * 0.1;
	const yMin = Math.max(0, min - padding);
	const yMax = max + padding;

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className="cursor-default underline decoration-dotted underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
				onMouseEnter={() => setShow(true)}
				onMouseLeave={() => setShow(false)}
			>
				{label}: {value}
			</button>
			{show && createPortal(
				<div
					className="pointer-events-none fixed z-50 rounded-md border border-zinc-200 bg-white px-2 pt-3 pb-1 text-zinc-950 shadow-lg"
					style={{ left: pos.x, top: pos.y, transform: "translate(-50%, calc(-100% - 6px))" }}
				>
					<div style={{ width: 220, height: 90 }}>
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={chartData} margin={{ top: 4, right: 30, bottom: 2, left: 4 }}>
								<CartesianGrid strokeDasharray="3 3" vertical={false} />
								<XAxis
									dataKey="ts"
									ticks={[chartData[0].ts, chartData[chartData.length - 1].ts]}
									interval={0}
									tick={(props: any) => {
										const { x, y, payload } = props;
										const d = new Date(payload.value);
										const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
										const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
										return (
											<g transform={`translate(${x},${y})`}>
												<text x={0} y={0} dy={11} textAnchor="middle" fontSize={10} fill="currentColor" className="fill-muted-foreground">{date}</text>
												<text x={0} y={0} dy={22} textAnchor="middle" fontSize={9} fill="currentColor" className="fill-muted-foreground">{time}</text>
											</g>
										);
									}}
									height={32}
								/>
								<YAxis
									tick={{ fontSize: 9 }}
									tickFormatter={yTickFmt}
									width={40}
									domain={[isInteger ? Math.floor(yMin) : yMin, isInteger ? Math.ceil(yMax) : yMax]}
									allowDecimals={!isInteger}
								/>
								<Line
									type="monotone"
									dataKey="v"
									stroke={sparkColor}
									strokeWidth={1.5}
									dot={sparkData.length <= 3}
									connectNulls
									isAnimationActive={false}
									strokeDasharray={sparkData.length === 1 ? "4 3" : undefined}
								/>
							</LineChart>
						</ResponsiveContainer>
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}

function ProviderRow({ data }: { data: TargetStatus }) {
	const { model, provider, rest } = parseTarget(data.target);
	const deduped = dedupeEntries(data.entries);
	const latest = getLatest(deduped);
	const uptime = getUptime(deduped);

	// Build sparkline data from all deduped entries
	const allTimestamps = deduped.map((e) => e.ts);
	const latencyData = deduped.map((e) => e.latency);
	const citationData = deduped.map((e) => e.citations);
	const webQueryData = deduped.map((e) => e.webQueries);
	const textData = deduped.map((e) => e.textLength);
	const retryData = deduped.map((e) => e.retries);


	return (
		<div className="space-y-2 rounded-md border border-zinc-200 bg-white p-4">
			<div className="flex items-center justify-between">
				<div>
					<span className="font-medium text-zinc-950">{formatProvider(provider)}</span>
					{rest && <span className="text-zinc-500"> ({["openrouter", "openai-api", "anthropic-api", "mistral-api"].includes(provider) ? rest : rest.replace(/online/g, "web search")})</span>}
				</div>
				<UptimeBadge entries={deduped} />
			</div>
			<UptimeBar entries={deduped} />
			<div className="flex flex-wrap gap-4 text-xs text-zinc-600">
				{latest && (
					<>
						<span>Success: {uptime !== null ? `${uptime.toFixed(1)}%` : "—"}</span>
						<StatWithSparkline
							label="Latency"
							value={formatLatency(latest.latency)}
							sparkData={latencyData}
							timestamps={allTimestamps}
							sparkColor="hsl(221, 83%, 53%)"
							formatFn={formatLatency}
						/>
						<StatWithSparkline
							label="Citations"
							value={String(latest.citations)}
							sparkData={citationData}
							timestamps={allTimestamps}
							sparkColor="hsl(262, 83%, 58%)"
						/>
						<StatWithSparkline
							label="Web Queries"
							value={String(latest.webQueries)}
							sparkData={webQueryData}
							timestamps={allTimestamps}
							sparkColor="hsl(174, 72%, 40%)"
						/>
						<StatWithSparkline
							label="Text"
							value={`${latest.textLength} chars`}
							sparkData={textData}
							timestamps={allTimestamps}
							sparkColor="hsl(38, 92%, 50%)"
							formatFn={(v) => `${v}`}
						/>
						<StatWithSparkline
							label="Retries"
							value={String(latest.retries)}
							sparkData={retryData}
							timestamps={allTimestamps}
							sparkColor="hsl(0, 84%, 60%)"
						/>
					</>
				)}
				{!latest && <span>No data yet</span>}
			</div>
			{latest?.error && (
				<div className="text-xs text-red-500">Error: {latest.error.slice(0, 120)}</div>
			)}
		</div>
	);
}

// ─── Page ─────────────────────────────────────────────────────────────────

function StatusPage() {
	const data = Route.useLoaderData();
	const groups = groupByModel(data);

	// Overall stats
	const allLatest = data
		.map((d) => getLatest(dedupeEntries(d.entries)))
		.filter((e): e is StatusEntry => e !== null);
	const allOperational = allLatest.length > 0 && allLatest.every((e) => e.status === "pass");
	const failCount = allLatest.filter((e) => e.status === "fail").length;

	return (
		<div className="min-h-screen">
			<Navbar />
			<main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
				<div className="mb-8">
					<p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ STATUS
					</p>
					<h1 className="font-heading text-3xl text-zinc-950 md:text-4xl">Provider Status</h1>
					<p className="mt-2 text-zinc-600">
						Status of the third-party AI providers and scraping services Getcito
						uses to track your brand's visibility and citations. Tests run
						automatically 4 times per day. Latencies shown are for individual
						prompt evaluations; batches can vary significantly.
					</p>
				</div>

				{/* Overall status banner */}
				<Card className={`mb-8 border-2 ${allOperational ? "border-green-500/30" : failCount > 0 ? "border-red-500/30" : "border-zinc-200"}`}>
					<CardContent className="flex items-center gap-5 py-8">
						<div className="relative flex items-center justify-center">
							<div
								className={`size-5 rounded-full ${allOperational ? "bg-green-500" : failCount > 0 ? "bg-red-500" : "bg-zinc-200"}`}
							/>
							{(allOperational || failCount > 0) && (
								<div
									className={`absolute size-5 animate-ping rounded-full opacity-30 ${allOperational ? "bg-green-500" : "bg-red-500"}`}
								/>
							)}
						</div>
						<div>
							<p className="text-xl font-semibold text-zinc-950">
								{allLatest.length === 0
									? "Waiting for data"
									: allOperational
										? "All Systems Operational"
										: `${failCount} provider${failCount !== 1 ? "s" : ""} experiencing issues`}
							</p>
							{allLatest.length > 0 && (
								<p className="mt-1 text-sm text-zinc-500">
									Last checked{" "}
									{new Date(
										Math.max(...allLatest.map((e) => new Date(e.ts).getTime())),
									).toLocaleString()}
								</p>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Provider status rows grouped by model */}
				<div className="space-y-8">
					{Object.entries(groups)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([model, targets]) => (
							<div key={model}>
								<h2 className="mb-3 text-lg font-semibold text-zinc-950">{formatModel(model)}</h2>
								<div className="space-y-2">
									{targets.map((t) => (
										<ProviderRow key={t.target} data={t} />
									))}
								</div>
							</div>
						))}
				</div>

				{/* Latency chart */}
				<Card className="mt-10">
					<CardHeader>
						<CardTitle>Evaluation Latency</CardTitle>
					</CardHeader>
					<CardContent>
						<LatencyChart data={data} />
					</CardContent>
				</Card>

				<p className="mt-8 text-center text-xs text-zinc-500">
					Provider tests run every 6 hours via GitHub Actions.
					Each test sends a real query and validates the response.
				</p>
			</main>
			<Footer />
		</div>
	);
}
