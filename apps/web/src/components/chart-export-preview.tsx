import { Badge } from "@workspace/ui/components/badge";
import { BaseChart } from "./base-chart";
import { DEFAULT_APP_ICON, DEFAULT_APP_NAME } from "@workspace/config/constants";
import type { Brand, Competitor } from "@workspace/lib/db/schema";
import type { ChartDataPoint, LookbackPeriod } from "@/lib/chart-utils";
import { getBadgeVariant, getBadgeClassName } from "@/lib/chart-utils";

export interface ChartExportBranding {
	name?: string;
	icon?: string;
	parentUrl?: string;
	isWhitelabel: boolean;
	chartColors: string[];
}

export interface ChartExportPreviewProps {
	promptName: string;
	visibility: number | null;
	data: ChartDataPoint[];
	lookback: LookbackPeriod;
	brand: Brand;
	competitors: Competitor[];
	branding: ChartExportBranding;
}

export const EXPORT_W = 1200;
export const EXPORT_H = 628;

const HEADER_H = 56;
const HEADER_TOP = 16;
const GAP_HEADER_CARD = 16;
const CARD_PADDING_Y = 24;
const FOOTER_REGION = 80;
const CHART_H = EXPORT_H - HEADER_TOP - HEADER_H - GAP_HEADER_CARD - CARD_PADDING_Y - FOOTER_REGION;

export function ChartExportPreview({
	promptName,
	visibility,
	data,
	lookback,
	brand,
	competitors,
	branding,
}: ChartExportPreviewProps) {
	const name = branding.name || DEFAULT_APP_NAME;
	const isWhitelabel = branding.isWhitelabel && branding.name !== DEFAULT_APP_NAME;
	const domain = isWhitelabel
		? branding.parentUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") || ""
		: "Getcitohq.com";
	const hasCustomIcon = branding.icon && branding.icon !== DEFAULT_APP_ICON;

	return (
		<div
			style={{ width: EXPORT_W, height: EXPORT_H, paddingTop: HEADER_TOP, fontSize: 16 }}
			className="bg-white overflow-hidden flex flex-col"
		>
			{/* Title bar */}
			<div
				style={{ height: HEADER_H, marginBottom: GAP_HEADER_CARD }}
				className="flex items-center justify-between px-10 gap-6 shrink-0"
			>
				<h2
					className="font-semibold text-gray-900 truncate flex-1 min-w-0"
					style={{ fontSize: 22 }}
					title={promptName}
				>
					{promptName}
				</h2>
				{visibility !== null && (
					<Badge
						variant={getBadgeVariant(visibility)}
						className={`${getBadgeClassName(visibility)} shrink-0`}
						style={{ fontSize: 16, padding: "4px 14px" }}
					>
						{visibility}% Visibility
					</Badge>
				)}
			</div>

			{/* Chart card */}
			<div className="px-8 shrink-0">
				<div
					className="rounded-xl border border-gray-200 overflow-hidden pl-0"
					style={{ paddingRight: 12, paddingTop: 12, paddingBottom: 8 }}
				>
					<BaseChart
						data={data}
						lookback={lookback}
						brand={brand}
						competitors={competitors}
						isAnimationActive={false}
						chartType="line"
						chartColors={branding.chartColors}
						chartHeight={`${CHART_H}px`}
					/>
				</div>
			</div>

			{/* Branding footer — fills remaining space, content vertically centered */}
			<div className="flex-1 flex items-center justify-between px-10 min-h-0">
				<div className="flex items-center gap-3">
					{isWhitelabel && hasCustomIcon && (
						<img
							src={branding.icon}
							alt={`${name} logo`}
							style={{ width: 28, height: 28 }}
							className="object-contain"
							crossOrigin="anonymous"
						/>
					)}
					{isWhitelabel ? (
						<span style={{ fontSize: 18 }} className="text-gray-500 font-semibold">{name}</span>
					) : (
						<span className="font-titan-one font-normal lowercase text-blue-600" style={{ fontSize: 24 }}>
							Getcito
						</span>
					)}
				</div>
				<span style={{ fontSize: 18 }} className="text-gray-400 font-medium">{domain}</span>
			</div>
		</div>
	);
}
