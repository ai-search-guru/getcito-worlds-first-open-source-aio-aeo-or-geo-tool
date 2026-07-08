import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";

function StatCard({
	title,
	tooltip,
	value,
}: {
	title: string;
	tooltip: React.ReactNode;
	value: React.ReactNode;
}) {
	return (
		<Card className="flex flex-col">
			<CardHeader className="gap-0">
				<CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
					{title}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 flex items-center">
				<div className="text-2xl sm:text-3xl lg:text-4xl font-bold">{value}</div>
			</CardContent>
		</Card>
	);
}

export function CitationStatsCards({
	brandShare,
	uniqueDomains,
	totalCitations,
}: {
	brandShare: number;
	uniqueDomains: number;
	totalCitations: number;
}) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<StatCard
				title="Brand Citation Share"
				tooltip="The percentage of all citations that link to your brand's domain. A higher share means AI models are more likely to reference your content."
				value={`${brandShare}%`}
			/>
			<StatCard
				title="Unique Domains"
				tooltip="The number of distinct domains cited across all prompt evaluations in this period."
				value={uniqueDomains.toLocaleString()}
			/>
			{/* Kept deliberately simple: the user doesn't need the Google AI Mode
			    search/shopping nuance. Those surfaces aren't citations in the
			    traditional sense (they point back into Google's own product/search
			    results, not an external domain w.r.t. the model), so they're
			    excluded from this count and broken out in the Google Shopping card. */}
			<StatCard
				title="Total Citations"
				tooltip="The total external websites cited by AI models across prompt evaluations."
				value={totalCitations.toLocaleString()}
			/>
		</div>
	);
}
