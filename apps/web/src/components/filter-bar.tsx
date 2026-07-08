import { type ReactNode, useEffect, useRef, useState, useMemo } from "react";
import { useSearch } from "@tanstack/react-router";
import { SiOpenai, SiGoogle, SiAnthropic, SiPerplexity, SiX, SiGithubcopilot, SiMistralai } from "react-icons/si";
import { MdSelectAll } from "react-icons/md";
import { Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { ChevronDown, Search, Tag as TagIcon, Clock, X } from "lucide-react";
import { type LookbackPeriod, getDefaultLookbackPeriod } from "@/lib/chart-utils";
import { useBrand } from "@/hooks/use-brands";
import { getModelMeta } from "@workspace/lib/providers/models";
export { ALL_MODELS_VALUE, getAvailableModels } from "@/lib/model-filter";
import { ALL_MODELS_VALUE } from "@/lib/model-filter";
// Filter state lives in the URL, validated by the `$brand` layout route's
// search schema (see `validateBrandFilterSearch`). The widgets here keep
// per-key `useSearch` selectors so one filter's click doesn't re-render the
// others, and write through `useFilterNavigate` (replace, no scroll reset).
// The router commits search updates synchronously within the interaction, so
// no optimistic layer is needed (nuqs throttled URL writes, which is why the
// old code wrapped every change in `useOptimistic` + `startTransition`).
import {
	useFilterNavigate,
	splitTags,
	joinTags,
	coerceLookback,
} from "@/hooks/use-list-filters";

/** "all" is the no-filter sentinel; any other string is a concrete model id
 *  from the deployment's `SCRAPE_TARGETS`. Deployments can configure arbitrary
 *  model ids, so we don't constrain this to a literal union. */
export type ModelFilterValue = string;

/** Map a provider `iconId` (see `getModelMeta`) to the react-icons component
 *  that renders it. `generic` and any unknown id fall through to a sparkle,
 *  so a deployment that configures a new model id we haven't seen still gets
 *  a reasonable trigger glyph. */
export function iconForModel(model: string, className = "size-3.5") {
	if (model === ALL_MODELS_VALUE) return <MdSelectAll className={className} />;
	const { iconId } = getModelMeta(model);
	switch (iconId) {
		case "openai":
			return <SiOpenai className={className} />;
		case "anthropic":
			return <SiAnthropic className={className} />;
		case "google":
			return <SiGoogle className={className} />;
		case "microsoft":
			return <SiGithubcopilot className={className} />;
		case "perplexity":
			return <SiPerplexity className={className} />;
		case "x":
			return <SiX className={className} />;
		case "mistral":
			return <SiMistralai className={className} />;
		default:
			return <Sparkles className={className} />;
	}
}

export function labelForModel(model: string): string {
	if (model === ALL_MODELS_VALUE) return "All models";
	return getModelMeta(model).label;
}


const LOOKBACK_OPTIONS: { value: LookbackPeriod; label: string }[] = [
	{ value: "1w", label: "Last 7 days" },
	{ value: "1m", label: "Last 30 days" },
	{ value: "3m", label: "Last 3 months" },
	{ value: "6m", label: "Last 6 months" },
	{ value: "1y", label: "Last 12 months" },
	{ value: "all", label: "All time" },
];

function getLookbackLabel(lookback: LookbackPeriod): string {
	return LOOKBACK_OPTIONS.find((o) => o.value === lookback)?.label ?? lookback;
}

// ------------------------------------------------------------------
// Trigger button (used by every dropdown)
// ------------------------------------------------------------------

type FilterTriggerButtonProps = {
	icon: ReactNode;
	label: string;
	active?: boolean;
	badgeCount?: number;
} & React.ComponentProps<"button">;

// Props forward to the underlying Button so `<DropdownMenuTrigger asChild>` /
// `<PopoverTrigger asChild>` can hand their ref + data-state directly to the
// button element (wrapping in a div would make Slot target the div instead).
// Exported so page-specific bar controls (e.g. the prompts sort dropdown)
// share the same trigger look without re-implementing it.
export function FilterTriggerButton({
	icon,
	label,
	active,
	badgeCount,
	className,
	...props
}: FilterTriggerButtonProps) {
	return (
		<Button
			variant="outline"
			size="sm"
			{...props}
			className={`h-8 gap-1.5 cursor-pointer font-normal ${
				active ? "border-foreground/30 bg-accent/50" : ""
			} ${className ?? ""}`}
		>
			<span className="text-muted-foreground flex items-center">{icon}</span>
			<span className="text-foreground">{label}</span>
			{badgeCount !== undefined && badgeCount > 0 && (
				<span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
					{badgeCount}
				</span>
			)}
			<ChevronDown className="size-3.5 text-muted-foreground" />
		</Button>
	);
}

// ------------------------------------------------------------------
// Model dropdown — subscribes to only the "model" URL key.
// ------------------------------------------------------------------

export function ModelDropdown({ availableModels }: { availableModels: string[] }) {
	const defaultModel = availableModels.includes(ALL_MODELS_VALUE)
		? ALL_MODELS_VALUE
		: (availableModels[0] ?? ALL_MODELS_VALUE);
	const urlModel = useSearch({ strict: false, select: (s) => s.model });
	const setFilters = useFilterNavigate();
	// If the URL has a model that isn't valid for this brand (e.g. stale deep
	// link after a deployment change), fall back to the default rather than
	// showing a trigger with an unknown value.
	const selected = urlModel && availableModels.includes(urlModel) ? urlModel : defaultModel;

	const handleChange = (next: string) => {
		setFilters({ model: next === defaultModel ? undefined : next });
	};

	if (availableModels.length <= 1) return null;
	const isFiltered = selected !== ALL_MODELS_VALUE;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterTriggerButton
					icon={iconForModel(selected)}
					label={labelForModel(selected)}
					active={isFiltered}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuRadioGroup value={selected} onValueChange={handleChange}>
					{availableModels.map((model) => (
						<DropdownMenuRadioItem key={model} value={model} className="cursor-pointer gap-2">
							{iconForModel(model)}
							{labelForModel(model)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ------------------------------------------------------------------
// Lookback dropdown — subscribes to only the "lookback" URL key.
// ------------------------------------------------------------------

export function LookbackDropdown() {
	const { brand } = useBrand();
	const defaultLookback = useMemo(
		() => getDefaultLookbackPeriod(brand?.earliestDataDate),
		[brand?.earliestDataDate],
	);
	const urlLookback = useSearch({ strict: false, select: (s) => s.lookback });
	const setFilters = useFilterNavigate();
	const selected = coerceLookback(urlLookback, defaultLookback);

	const handleChange = (next: LookbackPeriod) => {
		setFilters({ lookback: next === defaultLookback ? undefined : next });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterTriggerButton
					icon={<Clock className="size-3.5" />}
					label={getLookbackLabel(selected)}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuRadioGroup
					value={selected}
					onValueChange={(v) => handleChange(v as LookbackPeriod)}
				>
					{LOOKBACK_OPTIONS.map((opt) => (
						<DropdownMenuRadioItem key={opt.value} value={opt.value} className="cursor-pointer">
							{opt.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ------------------------------------------------------------------
// Tags dropdown — subscribes to only the "tags" URL key.
// Consumer passes `availableTags` (derived from prompts summary) so the
// dropdown doesn't need to fetch.
// ------------------------------------------------------------------

export function TagsDropdown({ availableTags }: { availableTags: readonly string[] }) {
	const urlTags = useSearch({ strict: false, select: (s) => s.tags });
	const setFilters = useFilterNavigate();
	const selected = useMemo(() => splitTags(urlTags), [urlTags]);

	const commit = (next: string[]) => {
		setFilters({ tags: joinTags(next) });
	};
	const toggle = (tag: string) => {
		commit(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
	};

	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen} modal={false}>
			<PopoverTrigger asChild>
				<FilterTriggerButton
					icon={<TagIcon className="size-3.5" />}
					label="Tags"
					active={selected.length > 0}
					badgeCount={selected.length > 0 ? selected.length : undefined}
				/>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
				<div className="flex items-center justify-between px-3 h-10 border-b">
					<span className="font-medium text-sm">Tags</span>
					{selected.length > 0 && (
						<button
							type="button"
							onClick={() => commit([])}
							className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
						>
							Clear
						</button>
					)}
				</div>
				{availableTags.length === 0 ? (
					<p className="text-sm text-muted-foreground py-6 text-center">No tags available</p>
				) : (
					<div className="py-1 max-h-64 overflow-y-auto">
						{availableTags.map((tag) => {
							const checked = selected.includes(tag);
							return (
								<div
									key={tag}
									role="button"
									tabIndex={0}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										toggle(tag);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											toggle(tag);
										}
									}}
									className={`flex items-center gap-2.5 py-1.5 px-3 cursor-pointer text-left text-sm ${
										checked ? "bg-accent" : "hover:bg-muted"
									}`}
								>
									<Checkbox checked={checked} className="pointer-events-none" />
									<span className="capitalize flex-1">{tag}</span>
								</div>
							);
						})}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

// ------------------------------------------------------------------
// Search input — subscribes to only the "q" URL key.
// Debounces keystrokes and uses an effect-based sync (no render-time
// setState) to avoid flashing back when the URL echo races with typing.
// ------------------------------------------------------------------

export function SearchInput({ placeholder = "Search prompts..." }: { placeholder?: string }) {
	const urlValue = useSearch({ strict: false, select: (s) => s.q });
	const setFilters = useFilterNavigate();
	const value = urlValue ?? "";

	const [local, setLocal] = useState(value);
	// `pendingTargetRef` holds the value we're currently pushing to the URL
	// while the navigation commits. While set, the sync effect ignores the
	// stale `value` — without this, a re-render that fires after
	// `setLocal("")` but before the router commits would see `value='abc'`
	// and snap `local` back to 'abc'. That's what caused the
	// "empty → abc → empty" flash when clicking the X.
	const pendingTargetRef = useRef<string | null>(null);

	useEffect(() => {
		if (pendingTargetRef.current !== null) {
			if (value === pendingTargetRef.current) {
				pendingTargetRef.current = null; // our push committed
				return;
			}
			// The URL moved to something other than what we were pushing —
			// an external clearFilters() or direct navigation wins.
			pendingTargetRef.current = null;
			setLocal(value);
			return;
		}
		if (value !== local) setLocal(value);
	}, [value]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (local === value) return;
		if (local === pendingTargetRef.current) return;
		const timer = setTimeout(() => {
			pendingTargetRef.current = local;
			setFilters({ q: local.length ? local : undefined });
		}, 250);
		return () => clearTimeout(timer);
	}, [local, value, setFilters]);

	const clear = () => {
		setLocal("");
		if (value !== "") {
			pendingTargetRef.current = "";
			setFilters({ q: undefined });
		} else {
			pendingTargetRef.current = null;
		}
	};

	return (
		<div className="relative w-full sm:w-64">
			<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
			<Input
				value={local}
				onChange={(e) => setLocal(e.target.value)}
				placeholder={placeholder}
				className="h-8 pl-8 pr-8 text-sm"
			/>
			{local && (
				<button
					type="button"
					onClick={clear}
					className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
					aria-label="Clear search"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}

// ------------------------------------------------------------------
// Result count — subscribes only to the two URL keys that gate its
// visibility (tags + q). Parent passes the count as a prop so the
// prompts-summary query is read once by a single owner.
// ------------------------------------------------------------------

export function ResultCount({ count, total }: { count: number | undefined; total?: number }) {
	const tags = useSearch({ strict: false, select: (s) => s.tags });
	const q = useSearch({ strict: false, select: (s) => s.q });
	const active = Boolean(tags) || Boolean(q);
	if (!active || count === undefined) return null;
	const showTotal = total !== undefined && total !== count;
	return (
		<span className="text-xs text-muted-foreground tabular-nums ml-1">
			{count.toLocaleString()}
			{showTotal && ` of ${total.toLocaleString()}`} {count === 1 && !showTotal ? "result" : "results"}
		</span>
	);
}

// ------------------------------------------------------------------
// Composed FilterBar
// ------------------------------------------------------------------

export function FilterBar({
	availableTags,
	availableModels,
	showSearch,
	showModelSelector,
	resultCount,
	resultTotal,
	extraControls,
}: {
	availableTags: readonly string[];
	availableModels: string[];
	showSearch: boolean;
	showModelSelector: boolean;
	/** Only passed by pages that filter a list; omit on pages with a single aggregate view (e.g. Citations). */
	resultCount?: number;
	/** Unfiltered count — when it differs from `resultCount` the line reads "n of m results". */
	resultTotal?: number;
	/** Page-specific controls rendered inline with the dropdown group
	 *  (e.g. the prompts list's sort dropdown). */
	extraControls?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex flex-wrap items-center gap-1.5">
				{showModelSelector && <ModelDropdown availableModels={availableModels} />}
				<TagsDropdown availableTags={availableTags} />
				<LookbackDropdown />
				{extraControls}
				<ResultCount count={resultCount} total={resultTotal} />
			</div>
			{showSearch && <SearchInput />}
		</div>
	);
}

// Data-fetching consumers that need the full filter set use
// `useListFilters` from "@/hooks/use-list-filters".
