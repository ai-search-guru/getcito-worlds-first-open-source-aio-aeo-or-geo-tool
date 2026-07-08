/**
 * /reports - Reports list page
 *
 * Requires admin OR report generator access.
 * Replicates: apps/web/src/app/reports/page.tsx + reports-content.tsx
 */
import { useState } from "react";
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { getAppName } from "@/lib/route-head";
import { createServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SidebarProvider, SidebarInset } from "@workspace/ui/components/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { trackEvent } from "@/lib/posthog";
import { ExternalLink, Trash2 } from "lucide-react";
import { requireAuthSession, isAdmin, hasReportAccess } from "@/lib/auth/helpers";
import { getReportsFn, createReportFn, deleteReportFn } from "@/server/reports";
import { useBrands } from "@/hooks/use-brands";

const checkReportAccess = createServerFn({ method: "GET" }).handler(async (): Promise<{
	hasAccess: boolean;
	isAdmin: boolean;
	hasReportAccess: boolean;
}> => {
	const session = await requireAuthSession();
	const admin = isAdmin(session);
	const reportAccess = hasReportAccess(session);
	return {
		hasAccess: admin || reportAccess,
		isAdmin: admin,
		hasReportAccess: reportAccess,
	};
});

export const Route = createFileRoute("/_authed/reports/")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: `Reports · ${appName}` },
				{ name: "description", content: "Generate and view one-time brand reports." },
			],
		};
	},
	beforeLoad: async () => {
		const { hasAccess, isAdmin, hasReportAccess } = await checkReportAccess();
		if (!hasAccess) throw notFound();
		return { isAdmin, hasReportAccess };
	},
	component: ReportsPage,
});

function ReportsPage() {
	const { isAdmin, hasReportAccess } = Route.useRouteContext();
	const queryClient = useQueryClient();

	const {
		data: reports = [],
		error,
		isLoading,
	} = useQuery({
		queryKey: ["reports"],
		queryFn: () => getReportsFn(),
		refetchInterval: 5000,
		staleTime: 2000,
	});

	const { brands, isLoading: brandsLoading } = useBrands();

	const [formData, setFormData] = useState({
		brandName: "",
		brandWebsite: "",
		manualPrompts: "",
	});
	const [selectedBrandId, setSelectedBrandId] = useState<string>("custom");
	const [submitError, setSubmitError] = useState("");
	const [success, setSuccess] = useState("");

	const createMutation = useMutation({
		mutationFn: (data: typeof formData) => createReportFn({ data }),
		onSuccess: (_data, variables) => {
			trackEvent("report_created", { has_manual_prompts: Boolean(variables.manualPrompts) });
			setSuccess("Report request submitted successfully!");
			setFormData({ brandName: "", brandWebsite: "", manualPrompts: "" });
			setSelectedBrandId("custom");
			queryClient.invalidateQueries({ queryKey: ["reports"] });
		},
		onError: (err: Error) => {
			setSubmitError(err.message || "An error occurred");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (reportId: string) => deleteReportFn({ data: { reportId } }),
		onSuccess: () => {
			trackEvent("report_deleted");
			queryClient.invalidateQueries({ queryKey: ["reports"] });
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitError("");
		setSuccess("");
		createMutation.mutate(formData);
	};

	const getStatusBadgeVariant = (status: string) => {
		switch (status) {
			case "completed":
				return "default" as const;
			case "processing":
				return "secondary" as const;
			case "failed":
				return "destructive" as const;
			default:
				return "outline" as const;
		}
	};

	const extractDomain = (url: string) => {
		try {
			return new URL(url).hostname.replace("www.", "");
		} catch {
			return url;
		}
	};

	return (
		<SidebarProvider>
			<AppSidebar isAdmin={isAdmin} hasReportAccess={hasReportAccess} adminOnly />
			<SidebarInset className="md:border md:border-border/60 md:rounded-xl overflow-hidden">
				<SiteHeader />
				<div className="flex flex-1 flex-col">
					<div className="@container/main flex flex-1 flex-col gap-2">
						<div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
							<div className="space-y-8">
								<div className="space-y-2">
									<h1 className="text-3xl font-bold tracking-tight">Reports</h1>
									<p className="text-muted-foreground">Generate one-time brand reports.</p>
								</div>
								<div className="space-y-6 max-w-4xl">
									{/* Report Creation Form */}
									<div className="space-y-4">
										<h2 className="text-2xl font-semibold">Create New Report</h2>

										<form onSubmit={handleSubmit} className="space-y-4">
											<div className="space-y-2">
												<Label>Pre-fill from existing brand</Label>
												<Select 
													value={selectedBrandId} 
													onValueChange={(val) => {
														setSelectedBrandId(val);
														if (val === "custom") {
															setFormData({ brandName: "", brandWebsite: "", manualPrompts: "" });
														} else {
															const brand = brands?.find(b => b.id === val);
															if (brand) {
																const activePrompts = brand.prompts?.filter(p => p.enabled).map(p => p.value).join("\n") || "";
																setFormData({
																	brandName: brand.name,
																	brandWebsite: brand.website || "",
																	manualPrompts: activePrompts
																});
															}
														}
													}}
													disabled={createMutation.isPending || brandsLoading}
												>
													<SelectTrigger>
														<SelectValue placeholder="Custom / New Prospect" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="custom">-- Custom / New Prospect --</SelectItem>
														{brands?.map(brand => (
															<SelectItem key={brand.id} value={brand.id}>
																{brand.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>

											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<div className="space-y-2">
													<Label htmlFor="brandName">Brand Name</Label>
													<Input
														id="brandName"
														type="text"
														placeholder="Enter brand name"
														value={formData.brandName}
														onChange={(e) =>
															setFormData({ ...formData, brandName: e.target.value })
														}
														required
														disabled={createMutation.isPending}
													/>
												</div>
												<div className="space-y-2">
													<Label htmlFor="brandWebsite">Brand Website</Label>
													<Input
														id="brandWebsite"
														type="url"
														placeholder="https://example.com"
														value={formData.brandWebsite}
														onChange={(e) =>
															setFormData({ ...formData, brandWebsite: e.target.value })
														}
														required
														disabled={createMutation.isPending}
													/>
												</div>
											</div>

											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<Label htmlFor="manualPrompts">
														Manual Prompts{" "}
														<span className="text-muted-foreground font-normal">(Optional)</span>
													</Label>
													{formData.manualPrompts && (
														<Button 
															type="button" 
															variant="outline" 
															size="sm"
															className="h-7 text-xs"
															onClick={() => setFormData({ ...formData, manualPrompts: "" })}
														>
															Clear & Use AI Generation
														</Button>
													)}
												</div>
												<Textarea
													id="manualPrompts"
													placeholder="Enter one prompt per line, up to 50"
													value={formData.manualPrompts}
													onChange={(e) =>
														setFormData({ ...formData, manualPrompts: e.target.value })
													}
													disabled={createMutation.isPending}
													rows={6}
													className="font-mono text-sm"
												/>
												<p className="text-xs text-muted-foreground">
													{formData.manualPrompts.trim() ? (
														<>
															<strong>Note:</strong> Prompts will NOT be auto-generated.
															Using your{" "}
															{
																formData.manualPrompts
																	.trim()
																	.split("\n")
																	.filter((line) => line.trim()).length
															}{" "}
															manual prompt
															{formData.manualPrompts
																.trim()
																.split("\n")
																.filter((line) => line.trim()).length !== 1
																? "s"
																: ""}
															.
														</>
													) : (
														"Leave empty to auto-generate prompts based on website analysis, competitors, and keywords."
													)}
												</p>
											</div>

											{submitError && (
												<p className="text-sm text-destructive">{submitError}</p>
											)}
											{success && <p className="text-sm text-green-600">{success}</p>}

											<Button
												type="submit"
												disabled={createMutation.isPending}
												className="cursor-pointer"
											>
												{createMutation.isPending
													? "Creating Report..."
													: "Create Report"}
											</Button>
										</form>
									</div>

									{/* Reports List */}
									<div className="space-y-4">
										<h2 className="text-2xl font-semibold">Report History</h2>

										{error && (
											<Card>
												<CardContent className="py-8 text-center">
													<p className="text-destructive">
														{error instanceof Error
															? error.message
															: "Failed to load reports"}
													</p>
												</CardContent>
											</Card>
										)}

										{isLoading ? (
											<div className="flex items-center justify-center py-8">
												<div className="flex items-center space-x-2">
													<div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
													<span>Loading reports...</span>
												</div>
											</div>
										) : !error && reports.length === 0 ? (
											<Card>
												<CardContent className="py-8 text-center">
													<p className="text-muted-foreground">No reports found.</p>
												</CardContent>
											</Card>
										) : (
											!error && (
												<div className="space-y-3">
													{reports.map((report: any) => (
														<div
															key={report.id}
															className="bg-gray-50 border border-gray-200 rounded-lg p-4"
														>
															<div className="flex items-center justify-between">
																<div className="flex-1 min-w-0">
																	<h3 className="font-semibold text-lg">
																		{report.brandName}{" "}
																		<span className="text-gray-600 font-normal">
																			(
																			{extractDomain(
																				report.brandWebsite,
																			)}
																			)
																		</span>
																	</h3>
																</div>
																<div className="ml-4 flex items-center space-x-2">
																	{report.status === "completed" ? (
																		<Link
																			to="/reports/render/$reportId"
																			params={{
																				reportId: report.id,
																			}}
																			target="_blank"
																		>
																			<Button
																				variant="default"
																				size="sm"
																				className="cursor-pointer h-6 px-2 text-xs"
																			>
																				<ExternalLink className="size-3 mr-0.5" />
																				View Report
																			</Button>
																		</Link>
																	) : (
																		<Badge
																			variant={getStatusBadgeVariant(
																				report.status,
																			)}
																			className="text-xs"
																		>
																			{report.status
																				.charAt(0)
																				.toUpperCase() +
																				report.status.slice(1)}
																		</Badge>
																	)}
																	<Button
																		variant="outline"
																		size="sm"
																		title="Delete report"
																		className="cursor-pointer h-6 w-6 p-0 text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
																		onClick={() => {
																			if (window.confirm("Are you sure you want to delete this report?")) {
																				deleteMutation.mutate(report.id);
																			}
																		}}
																		disabled={deleteMutation.isPending}
																	>
																		<Trash2 className="size-3" />
																	</Button>
																</div>
															</div>
														</div>
													))}
												</div>
											)
										)}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
