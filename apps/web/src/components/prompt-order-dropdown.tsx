import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpDown } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { FilterTriggerButton } from "@/components/filter-bar";
import {
	PROMPT_ORDER_OPTIONS,
	DEFAULT_PROMPT_ORDER,
	coercePromptOrder,
	type PromptOrder,
} from "@/lib/prompt-order";

/** Sort control for the prompts list (#60). Reads/writes the `order` URL key
 *  the visibility route declares in its `validateSearch`. Like the filter-bar
 *  widgets it subscribes to just its own key, and writes with `replace` + no
 *  scroll reset, dropping the key when set back to the default so default
 *  state keeps a clean URL. */
export function PromptOrderDropdown() {
	const navigate = useNavigate();
	const selected = useSearch({
		strict: false,
		select: (s) => coercePromptOrder((s as { order?: unknown }).order),
	});

	const setOrder = (next: PromptOrder) =>
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				order: next === DEFAULT_PROMPT_ORDER ? undefined : next,
			}),
			replace: true,
			resetScroll: false,
		});

	// The button reads "Sort" in the default state and otherwise echoes the
	// chosen order's menu label (arrows and all).
	const label =
		selected === DEFAULT_PROMPT_ORDER
			? "Sort"
			: (PROMPT_ORDER_OPTIONS.find((o) => o.value === selected)?.label ?? "Sort");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterTriggerButton
					icon={<ArrowUpDown className="size-3.5" />}
					label={label}
					active={selected !== DEFAULT_PROMPT_ORDER}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuRadioGroup value={selected} onValueChange={(v) => setOrder(v as PromptOrder)}>
					{PROMPT_ORDER_OPTIONS.map((o) => (
						<DropdownMenuRadioItem key={o.value} value={o.value} className="cursor-pointer whitespace-nowrap">
							{o.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
