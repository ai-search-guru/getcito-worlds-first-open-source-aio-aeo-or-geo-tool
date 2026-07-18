import type { LookbackPeriod } from "@/lib/chart-utils";

type DateShift = {
	days?: number;
	months?: number;
	years?: number;
};

type TimezoneDateRange = {
	fromDateStr: string | null;
	toDateStr: string | null;
};

type AllLookbackStrategy = "none" | "1y";

export function resolveTimezone(timezoneParam?: string, resolvedFallback?: string): string {
	if (timezoneParam) {
		try {
			Intl.DateTimeFormat("en-CA", { timeZone: timezoneParam });
			return timezoneParam;
		} catch {
			// Fall through to resolved/UTC fallback
		}
	}

	const resolved = resolvedFallback ?? (() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			return undefined;
		}
	})();

	return resolved || "UTC";
}

export function shiftDateStr(dateStr: string, delta: DateShift): string {
	const [yearStr, monthStr, dayStr] = dateStr.split("-");
	const year = Number(yearStr);
	const monthIndex = Number(monthStr) - 1;
	const day = Number(dayStr);

	let targetYear = year + (delta.years ?? 0);
	let targetMonthIndex = monthIndex + (delta.months ?? 0);

	// Normalize month overflow/underflow
	if (targetMonthIndex < 0 || targetMonthIndex > 11) {
		const yearDelta = Math.floor(targetMonthIndex / 12);
		targetYear += yearDelta;
		targetMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
	}

	// Clamp day to end of target month to avoid rollover
	const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
	const clampedDay = Math.min(day, lastDayOfTargetMonth);

	const date = new Date(Date.UTC(targetYear, targetMonthIndex, clampedDay));

	if (delta.days) {
		date.setUTCDate(date.getUTCDate() + delta.days);
	}

	return date.toISOString().slice(0, 10);
}

export function getTimezoneLookbackRange(
	lookback: LookbackPeriod,
	timezone: string,
	options?: {
		now?: Date;
		allStrategy?: AllLookbackStrategy;
	},
): TimezoneDateRange {
	const now = options?.now ?? new Date();
	const todayStr = now.toLocaleDateString("en-CA", { timeZone: timezone });

	if (lookback === "all") {
		if (options?.allStrategy === "1y") {
			return {
				fromDateStr: shiftDateStr(todayStr, { years: -1 }),
				toDateStr: todayStr,
			};
		}
		return { fromDateStr: null, toDateStr: null };
	}

	switch (lookback) {
		case "1w":
			return {
				fromDateStr: shiftDateStr(todayStr, { days: -6 }), // 7 days including today
				toDateStr: todayStr,
			};
		case "1m":
			return {
				fromDateStr: shiftDateStr(todayStr, { months: -1 }),
				toDateStr: todayStr,
			};
		case "3m":
			return {
				fromDateStr: shiftDateStr(todayStr, { months: -3 }),
				toDateStr: todayStr,
			};
		case "6m":
			return {
				fromDateStr: shiftDateStr(todayStr, { months: -6 }),
				toDateStr: todayStr,
			};
		case "1y":
			return {
				fromDateStr: shiftDateStr(todayStr, { years: -1 }),
				toDateStr: todayStr,
			};
	}
}
