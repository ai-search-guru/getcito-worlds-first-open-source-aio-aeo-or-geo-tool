import React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { getModelMeta, KNOWN_MODELS } from "@workspace/lib/providers/models";

export type ProgressBarItem = {
	/** The label to display */
	label: string;
	/** The count/value to display */
	count: number;
	/** Optional subtitle shown below the label */
	subtitle?: string;
	/** Optional suffix rendered after the count (e.g. trend arrows) */
	suffix?: React.ReactNode;
	/** Optional category for color mapping */
	category?: string;
	/** Optional custom color (overrides category color) */
	color?: string;
	/** Optional click handler for future extensibility */
	onClick?: () => void;
	/** Optional tooltip text shown on hover over the label */
	tooltip?: string;
	/** Optional action element rendered next to the label */
	action?: React.ReactNode;
	/** Optional additional metadata */
	metadata?: Record<string, any>;
};

export type ColorMapping = {
	[category: string]: string;
};

export type ProgressBarChartProps = {
	/** Array of items to display */
	items: ProgressBarItem[];
	/** Color mapping for categories */
	colorMapping?: ColorMapping;
	/** Default color if no category match */
	defaultColor?: string;
	/** Background color of the progress bar track */
	trackColor?: string;
	/** Height of the progress bar (tailwind class like 'h-2' or 'h-3') */
	barHeight?: string;
	/** How to calculate percentages: 'max' (relative to max count) or 'total' (relative to sum of all counts) */
	percentageMode?: "max" | "total";
	/** Custom total for percentage calculation (overrides percentageMode) */
	customTotal?: number;
	/** Spacing between items (tailwind class) */
	spacing?: string;
	/** Show label in bold if it matches this value */
	highlightLabel?: string;
	/** Additional CSS classes for the container */
	className?: string;
	/** Whether labels should be truncated if too long */
	truncateLabels?: boolean;
	/** Use flex layout to fill parent height and distribute items evenly */
	fillHeight?: boolean;
};

export function ProgressBarChart({
	items,
	colorMapping = {},
	defaultColor = "#3b82f6",
	trackColor = "bg-primary/10",
	barHeight = "h-2",
	percentageMode = "max",
	customTotal,
	spacing = "space-y-4",
	highlightLabel,
	className,
	truncateLabels = true,
	fillHeight = false,
}: ProgressBarChartProps) {
	// Calculate the total for percentage calculations
	const total = React.useMemo(() => {
		if (customTotal !== undefined) {
			return customTotal;
		}
		
		if (percentageMode === "total") {
			return items.reduce((sum, item) => sum + item.count, 0);
		}
		
		// percentageMode === "max"
		return Math.max(...items.map(item => item.count), 1);
	}, [items, percentageMode, customTotal]);

	const getItemColor = (item: ProgressBarItem): string => {
		// Custom color takes precedence
		if (item.color) {
			return item.color;
		}
		
		// Category-based color
		if (item.category && colorMapping[item.category]) {
			return colorMapping[item.category];
		}
		
		// Default color
		return defaultColor;
	};

	const calculatePercentage = (count: number): number => {
		if (total === 0) return 0;
		return (count / total) * 100;
	};

	return (
		<div className={cn(fillHeight ? "flex flex-col justify-between h-full" : spacing, className)}>
			{items.map((item) => {
				const percentage = calculatePercentage(item.count);
				const color = getItemColor(item);
				const isHighlighted = highlightLabel && item.label === highlightLabel;
				const isClickable = !!item.onClick;

				return (
					<div key={item.label} className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1 min-w-0 flex-1">
							{item.tooltip ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<span
											className={cn(
												"text-sm cursor-default",
												isHighlighted ? "font-bold" : "font-medium",
												truncateLabels && "truncate",
												isClickable && "cursor-pointer hover:underline"
											)}
											onClick={item.onClick}
										>
											{item.label}
										</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs text-xs font-normal">{item.tooltip}</TooltipContent>
								</Tooltip>
							) : (
								<span
									className={cn(
										"text-sm",
										isHighlighted ? "font-bold" : "font-medium",
										truncateLabels && "truncate",
										isClickable && "cursor-pointer hover:underline"
									)}
									onClick={item.onClick}
								>
									{item.label}
								</span>
							)}
							{item.action}
						</div>
							<div className="flex items-center gap-2 ml-2 shrink-0">
								<span className="text-sm">{item.count.toLocaleString()}</span>
								{item.suffix}
							</div>
						</div>
						{item.subtitle && (
							<p className="text-xs text-muted-foreground truncate -mt-1">{item.subtitle}</p>
						)}
						<div className={cn("relative w-full overflow-hidden rounded-full", trackColor, barHeight)}>
							<div
								className="h-full transition-all rounded-full"
								style={{
									width: `${percentage}%`,
									backgroundColor: color,
								}}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

export { DOMAIN_CATEGORY_COLORS } from "@/lib/domain-categories";

// Colors are keyed by the provider family (iconId from `getModelMeta`), so a
// deployment that adds any google-flavored model, anthropic-flavored model,
// etc. via `SCRAPE_TARGETS` gets a sensible color without needing per-model
// config here. Anything the `generic` branch can't match falls through to
// `ProgressBarChart`'s `defaultColor`.
const COLOR_BY_ICON: Record<string, string> = {
	openai: "#10b981", // green
	anthropic: "#f59e0b", // amber/orange
	google: "#3b82f6", // blue
	microsoft: "#06b6d4", // cyan
	perplexity: "#8b5cf6", // purple
	x: "#111827", // near-black
};

/** Resolve a model id to a display color. "all" is a no-filter sentinel. */
export function getModelColor(model: string): string | undefined {
	if (model === "all") return "#8b5cf6";
	return COLOR_BY_ICON[getModelMeta(model).iconId];
}

/** Colors for every model id in `KNOWN_MODELS` plus "all". Unknown deployment
 *  models fall back to `ProgressBarChart`'s `defaultColor`. */
export const MODEL_COLORS: ColorMapping = {
	all: "#8b5cf6",
	...Object.fromEntries(
		Object.keys(KNOWN_MODELS)
			.map((m) => [m, getModelColor(m)])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	),
};

