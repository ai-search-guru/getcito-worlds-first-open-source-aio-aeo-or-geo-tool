/**
 * /admin - Admin dashboard with brand statistics and charts
 */
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { getAppName } from "@/lib/route-head";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@workspace/ui/components/chart";
import { Settings, TrendingUp, TrendingDown } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { getAdminStatsFn, updateDelayOverrideFn } from "@/server/admin";

interface BrandStats {
	id: string;
	name: string;
	website: string;
	creatorName: string | null;
	creatorEmail: string | null;
	enabled: boolean;
	onboarded: boolean;
	delayOverrideHours: number | null;
	createdAt: string;
	updatedAt: string;
	totalPrompts: number;
	activePrompts: number;
	promptRuns7Days: number;
	promptRuns30Days: number;
	lastPromptRunAt: string | null;
	promptsAddedLast7Days: number;
	promptsRemovedLast7Days: number;
	promptsAddedLast30Days: number;
	promptsRemovedLast30Days: number;
}

function useDefaultDelayHours(): number {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	return context.clientConfig?.defaultDelayHours ?? 24;
}

function formatDelayHours(hours: number): string {
	const weeks = Math.floor(hours / (7 * 24));
	const days = Math.floor((hours % (7 * 24)) / 24);
	const remainingHours = hours % 24;
	const parts: string[] = [];
	if (weeks > 0) parts.push(`${weeks}w`);
	if (days > 0) parts.push(`${days}d`);
	if (remainingHours > 0) parts.push(`${remainingHours}h`);
	return parts.length > 0 ? parts.join(" ") : "0h";
}

function hoursToTimeUnits(hours: number) {
	return {
		weeks: Math.floor(hours / (7 * 24)),
		days: Math.floor((hours % (7 * 24)) / 24),
		hours: hours % 24,
	};
}

function timeUnitsToHours(units: { weeks: number; days: number; hours: number }) {
	return units.weeks * 7 * 24 + units.days * 24 + units.hours;
}

function DelayOverrideDialog({ brand, onUpdate }: { brand: BrandStats; onUpdate: () => void }) {
	const defaultDelayHours = useDefaultDelayHours();
	const [open, setOpen] = useState(false);
	const [timeUnits, setTimeUnits] = useState({ weeks: 0, days: 0, hours: 0 });
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const currentDelay = brand.delayOverrideHours ?? defaultDelayHours;

	useEffect(() => {
		if (open) {
			setTimeUnits(hoursToTimeUnits(currentDelay));
			setError(null);
		}
	}, [open, currentDelay]);

	const handleUpdateUnit = (unit: keyof typeof timeUnits, value: string) => {
		const numValue = value === "" ? 0 : Math.max(0, parseInt(value) || 0);
		setTimeUnits({ ...timeUnits, [unit]: numValue });
	};

	const handleUpdate = async () => {
		setError(null);
		const totalHours = timeUnitsToHours(timeUnits);
		if (totalHours === 0) { setError("Please enter a delay value"); return; }
		if (totalHours < 1) { setError("Delay must be at least 1 hour"); return; }
		setIsUpdating(true);
		try {
			await updateDelayOverrideFn({ data: { brandId: brand.id, delayOverrideHours: totalHours } });
			onUpdate();
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update");
		} finally {
			setIsUpdating(false);
		}
	};

	const handleClearOverride = async () => {
		setIsUpdating(true);
		setError(null);
		try {
			await updateDelayOverrideFn({ data: { brandId: brand.id, delayOverrideHours: null } });
			onUpdate();
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to clear override");
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" className="cursor-pointer"><Settings className="h-4 w-4" /></Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Configure Job Delay for {brand.name}</DialogTitle>
					<DialogDescription>Set a custom delay for how often prompt jobs run. Default is {formatDelayHours(defaultDelayHours)}.</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-3">
						<Label>Custom Delay</Label>
						<div className="grid grid-cols-3 gap-4">
							<div className="space-y-2">
								<Label htmlFor="weeks" className="text-xs text-muted-foreground">Weeks</Label>
								<Input id="weeks" type="number" min="0" value={timeUnits.weeks || ""} onChange={(e) => handleUpdateUnit("weeks", e.target.value)} disabled={isUpdating} placeholder="0" />
							</div>
							<div className="space-y-2">
								<Label htmlFor="days" className="text-xs text-muted-foreground">Days</Label>
								<Input id="days" type="number" min="0" value={timeUnits.days || ""} onChange={(e) => handleUpdateUnit("days", e.target.value)} disabled={isUpdating} placeholder="0" />
							</div>
							<div className="space-y-2">
								<Label htmlFor="hours" className="text-xs text-muted-foreground">Hours</Label>
								<Input id="hours" type="number" min="0" value={timeUnits.hours || ""} onChange={(e) => handleUpdateUnit("hours", e.target.value)} disabled={isUpdating} placeholder="0" />
							</div>
						</div>
						<p className="text-sm text-muted-foreground">
							Current: <strong>{formatDelayHours(currentDelay)}</strong>
							{brand.delayOverrideHours !== null && " (custom)"}
							{brand.delayOverrideHours === null && " (default)"}
						</p>
						<p className="text-sm text-muted-foreground">Total: <strong>{formatDelayHours(timeUnitsToHours(timeUnits))}</strong></p>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<div className="flex justify-between w-full">
						{brand.delayOverrideHours !== null && (
							<Button variant="outline" onClick={handleClearOverride} disabled={isUpdating} className="cursor-pointer">Clear Override</Button>
						)}
						<div className="flex gap-2 ml-auto">
							<Button variant="outline" onClick={() => setOpen(false)} disabled={isUpdating} className="cursor-pointer">Cancel</Button>
							<Button onClick={handleUpdate} disabled={isUpdating} className="cursor-pointer">{isUpdating ? "Updating..." : "Update"}</Button>
						</div>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ActivityIndicator({ added, removed }: { added: number; removed: number }) {
	if (added === 0 && removed === 0) {
		return <div className="flex items-center text-muted-foreground"><span className="w-4 mr-1" /><span>0</span></div>;
	}
	return (
		<div className="flex items-center gap-2">
			{added > 0 && <div className="flex items-center text-green-600"><TrendingUp className="h-4 w-4 mr-1" /><span>+{added}</span></div>}
			{removed > 0 && <div className="flex items-center text-red-600"><TrendingDown className="h-4 w-4 mr-1" /><span>-{removed}</span></div>}
		</div>
	);
}

export const Route = createFileRoute("/_authed/admin/")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: `Admin · ${appName}` },
				{ name: "description", content: "Monitor and manage brands, prompts, and scheduling." },
			],
		};
	},
	component: AdminDashboard,
});

function AdminDashboard() {
	const defaultDelayHours = useDefaultDelayHours();
	const [brands, setBrands] = useState<BrandStats[]>([]);
	const [brandsOverTime, setBrandsOverTime] = useState<{ date: string; count: number }[]>([]);
	const [activeBrandsOverTime, setActiveBrandsOverTime] = useState<{ date: string; count: number }[]>([]);
	const [promptsOverTime, setPromptsOverTime] = useState<{ date: string; enabled: number; disabled: number }[]>([]);
	const [runsOverTime, setRunsOverTime] = useState<{ date: string; count: number }[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchBrandStats = async () => {
		try {
			const data = await getAdminStatsFn();
			setBrands(data.brands as any);
			setBrandsOverTime(data.brandsOverTime || []);
			setActiveBrandsOverTime(data.activeBrandsOverTime || []);
			setPromptsOverTime(data.promptsOverTime || []);
			setRunsOverTime(data.runsOverTime || []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => { fetchBrandStats(); }, []);

	if (loading) {
		return (
			<div className="space-y-8">
				<div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-96" /></div>
				<Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent><div className="space-y-4">{[0, 1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-16 w-full" />)}</div></CardContent></Card>
			</div>
		);
	}

	if (error) {
		return <Card><CardHeader><CardTitle className="text-destructive">Error</CardTitle></CardHeader><CardContent><p>{error}</p></CardContent></Card>;
	}

	const totals = brands.reduce(
		(acc, brand) => ({
			totalBrands: acc.totalBrands + 1,
			totalPrompts: acc.totalPrompts + (brand.totalPrompts || 0),
			activePrompts: acc.activePrompts + (brand.activePrompts || 0),
			promptRuns7Days: acc.promptRuns7Days + (brand.promptRuns7Days || 0),
			promptRuns30Days: acc.promptRuns30Days + (brand.promptRuns30Days || 0),
		}),
		{ totalBrands: 0, totalPrompts: 0, activePrompts: 0, promptRuns7Days: 0, promptRuns30Days: 0 },
	);

	const brandsYAxisMax = Math.max(...brandsOverTime.map((d) => d.count), ...activeBrandsOverTime.map((d) => d.count), 0);

	const dateFormatter = (value: string) => {
		const date = new Date(value);
		return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	};

	const tooltipLabelFormatter = (value: ReactNode) => {
		const date = new Date(String(value));
		return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
	};

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
					<p className="text-muted-foreground">Monitor and manage brands, prompts, and job scheduling</p>
				</div>
			</div>

			{/* Summary Cards with Charts */}
			<div className="grid gap-4 sm:grid-cols-2">
				<Card>
					<CardHeader><CardTitle>All Brands</CardTitle><CardDescription>Total: {totals.totalBrands} brands</CardDescription></CardHeader>
					<CardContent className="p-0 pb-4">
						<ChartContainer config={{ count: { label: "Total Brands", color: "#3b82f6" } }} className="h-[120px] w-full px-4">
							<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
								<AreaChart data={brandsOverTime}>
									<defs><linearGradient id="fillBrands" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} /></linearGradient></defs>
									<CartesianGrid strokeDasharray="3 3" vertical={false} />
									<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={30} tickFormatter={dateFormatter} />
									<YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} domain={[0, brandsYAxisMax]} />
									<ChartTooltip isAnimationActive={false} content={<ChartTooltipContent className="min-w-[180px]" labelFormatter={tooltipLabelFormatter} />} />
									<Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#fillBrands)" strokeWidth={2} />
								</AreaChart>
							</ResponsiveContainer>
						</ChartContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Active Brands</CardTitle><CardDescription>With runs in last 30 days: {activeBrandsOverTime[activeBrandsOverTime.length - 1]?.count ?? 0}</CardDescription></CardHeader>
					<CardContent className="p-0 pb-4">
						<ChartContainer config={{ count: { label: "Active Brands", color: "#22c55e" } }} className="h-[120px] w-full px-4">
							<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
								<AreaChart data={activeBrandsOverTime}>
									<defs><linearGradient id="fillActiveBrands" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} /></linearGradient></defs>
									<CartesianGrid strokeDasharray="3 3" vertical={false} />
									<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={30} tickFormatter={dateFormatter} />
									<YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} domain={[0, brandsYAxisMax]} />
									<ChartTooltip isAnimationActive={false} content={<ChartTooltipContent className="min-w-[180px]" labelFormatter={tooltipLabelFormatter} />} />
									<Area type="monotone" dataKey="count" stroke="#22c55e" fill="url(#fillActiveBrands)" strokeWidth={2} />
								</AreaChart>
							</ResponsiveContainer>
						</ChartContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Prompts</CardTitle><CardDescription>Active: {totals.activePrompts} | Total: {totals.totalPrompts}</CardDescription></CardHeader>
					<CardContent className="p-0 pb-4">
						<ChartContainer config={{ enabled: { label: "Enabled", color: "#10b981" }, disabled: { label: "Disabled", color: "#ef4444" } }} className="h-[120px] w-full px-4">
							<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
								<AreaChart data={promptsOverTime}>
									<defs>
										<linearGradient id="fillEnabled" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.8} /><stop offset="95%" stopColor="#10b981" stopOpacity={0.1} /></linearGradient>
										<linearGradient id="fillDisabled" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} /></linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" vertical={false} />
									<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={30} tickFormatter={dateFormatter} />
									<YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
									<ChartTooltip isAnimationActive={false} content={(props) => {
										if (!props.active || !props.payload) return null;
										const reversedPayload = [...props.payload].reverse();
										return <ChartTooltipContent className="min-w-[180px]" active={props.active} payload={reversedPayload} label={props.label} labelFormatter={tooltipLabelFormatter} />;
									}} />
									<Area type="monotone" dataKey="disabled" stackId="a" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} strokeWidth={2} />
									<Area type="monotone" dataKey="enabled" stackId="a" stroke="#10b981" fill="#10b981" fillOpacity={0.6} strokeWidth={2} />
								</AreaChart>
							</ResponsiveContainer>
						</ChartContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Runs</CardTitle><CardDescription>7d: {totals.promptRuns7Days.toLocaleString()} | 30d: {totals.promptRuns30Days.toLocaleString()}</CardDescription></CardHeader>
					<CardContent className="p-0 pb-4">
						<ChartContainer config={{ count: { label: "Runs", color: "#8b5cf6" } }} className="h-[120px] w-full px-4">
							<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
								<BarChart data={runsOverTime}>
									<CartesianGrid strokeDasharray="3 3" vertical={false} />
									<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={30} tickFormatter={dateFormatter} />
									<YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
									<ChartTooltip isAnimationActive={false} content={<ChartTooltipContent className="min-w-[180px]" labelFormatter={tooltipLabelFormatter} />} />
									<Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
								</BarChart>
							</ResponsiveContainer>
						</ChartContainer>
					</CardContent>
				</Card>
			</div>

			{/* Brand Statistics Table */}
			<Card>
				<CardHeader>
					<CardTitle>Brand Statistics</CardTitle>
					<CardDescription>Detailed statistics and configuration for each brand</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Brand</TableHead>
									<TableHead>Creator</TableHead>
									<TableHead className="text-right">Prompts</TableHead>
									<TableHead className="text-right">Prompts (7d)</TableHead>
									<TableHead className="text-right">Prompts (30d)</TableHead>
									<TableHead className="text-right">Runs (7d)</TableHead>
									<TableHead className="text-right">Runs (30d)</TableHead>
									<TableHead>Last Run</TableHead>
									<TableHead>Run Delay</TableHead>
									<TableHead>Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{brands.map((brand) => {
									const currentDelayHours = brand.delayOverrideHours ?? defaultDelayHours;
									const currentDelayMs = currentDelayHours * 60 * 60 * 1000;
									const isOverdue = brand.lastPromptRunAt && brand.activePrompts > 0
										? new Date().getTime() - new Date(brand.lastPromptRunAt).getTime() > currentDelayMs
										: false;

									return (
										<TableRow key={brand.id}>
											<TableCell className="font-medium">
												<div className="space-y-1">
													<Link to="/app/$brand" params={{ brand: brand.id }} className="hover:underline text-primary">{brand.name}</Link>
													<div className="text-xs text-muted-foreground">{brand.website}</div>
												</div>
											</TableCell>
											<TableCell>
												{brand.creatorEmail ? (
													<div className="space-y-1">
														<div className="text-sm">{brand.creatorName || "Unknown"}</div>
														<div className="text-xs text-muted-foreground">{brand.creatorEmail}</div>
													</div>
												) : (
													<span className="text-xs text-muted-foreground">None</span>
												)}
											</TableCell>
											<TableCell className="text-right"><div className="font-medium">{brand.activePrompts}</div></TableCell>
											<TableCell><div className="flex justify-end"><ActivityIndicator added={brand.promptsAddedLast7Days || 0} removed={brand.promptsRemovedLast7Days || 0} /></div></TableCell>
											<TableCell><div className="flex justify-end"><ActivityIndicator added={brand.promptsAddedLast30Days || 0} removed={brand.promptsRemovedLast30Days || 0} /></div></TableCell>
											<TableCell className="text-right">{brand.promptRuns7Days?.toLocaleString() || 0}</TableCell>
											<TableCell className="text-right">{brand.promptRuns30Days?.toLocaleString() || 0}</TableCell>
											<TableCell>
												{brand.lastPromptRunAt ? (
													<span className={`text-sm ${isOverdue ? "text-red-600 font-semibold" : ""}`}>{new Date(brand.lastPromptRunAt).toLocaleDateString()}</span>
												) : (
													<span className="text-muted-foreground">Never</span>
												)}
											</TableCell>
											<TableCell>
												<div className="space-y-1">
													<div className="font-medium">{formatDelayHours(currentDelayHours)}</div>
													<span className="text-xs text-muted-foreground">{brand.delayOverrideHours !== null ? "Custom" : "Default"}</span>
												</div>
											</TableCell>
											<TableCell><DelayOverrideDialog brand={brand} onUpdate={fetchBrandStats} /></TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
