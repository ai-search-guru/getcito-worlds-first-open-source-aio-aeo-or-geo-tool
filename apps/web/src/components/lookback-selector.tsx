import { useMemo } from "react";
import { useSearch } from "@tanstack/react-router";
import { type LookbackPeriod, getDefaultLookbackPeriod } from "@/lib/chart-utils";
import { useBrand } from "@/hooks/use-brands";
import { coerceLookback, useFilterNavigate } from "@/hooks/use-list-filters";

function getLookbackLabel(lookback: LookbackPeriod): string {
	switch (lookback) {
		case "1w":
			return "1w";
		case "1m":
			return "1mo";
		case "3m":
			return "3mo";
		case "6m":
			return "6mo";
		case "1y":
			return "1yr";
		case "all":
			return "all";
	}
}

interface LookbackSelectorProps {
	defaultPeriod?: LookbackPeriod;
	onLookbackChange?: (lookback: LookbackPeriod) => void;
}

export function LookbackSelector({ defaultPeriod, onLookbackChange }: LookbackSelectorProps) {
	const { brand } = useBrand();
	const computedDefaultPeriod = useMemo(
		() => defaultPeriod ?? getDefaultLookbackPeriod(brand?.earliestDataDate),
		[defaultPeriod, brand?.earliestDataDate]
	);

	const urlLookback = useSearch({ strict: false, select: (s) => s.lookback });
	const setFilters = useFilterNavigate();
	const selectedLookback = coerceLookback(urlLookback, computedDefaultPeriod);

	const handleChange = (period: LookbackPeriod) => {
		setFilters({ lookback: period === computedDefaultPeriod ? undefined : period });
		onLookbackChange?.(period);
	};

	return (
		<div className="flex rounded-md bg-muted p-1">
			{(["1w", "1m", "3m", "6m", "1y", "all"] as LookbackPeriod[]).map((period) => (
				<button
					key={period}
					onClick={() => handleChange(period)}
					className={`px-3 py-1 text-sm rounded cursor-pointer ${
						selectedLookback === period
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
					type="button"
				>
					{getLookbackLabel(period)}
				</button>
			))}
		</div>
	);
}

export function useLookbackPeriod(defaultPeriod?: LookbackPeriod) {
	const { brand } = useBrand();
	const computedDefaultPeriod = useMemo(
		() => defaultPeriod ?? getDefaultLookbackPeriod(brand?.earliestDataDate),
		[defaultPeriod, brand?.earliestDataDate]
	);

	const urlLookback = useSearch({ strict: false, select: (s) => s.lookback });
	return coerceLookback(urlLookback, computedDefaultPeriod);
}
