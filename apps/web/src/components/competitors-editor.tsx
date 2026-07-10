/**
 * Shared competitor list editor — used by both the settings/competitors page
 * (long-lived edits) and the prompt wizard's Review step (one-shot setup).
 *
 * Controlled component: caller owns the `competitors` array + the change
 * callbacks. State helpers like expand/collapse and the "X/MAX competitors
 * configured" footer live here so both surfaces look identical.
 */
import { useCallback } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { IconInfoCircle } from "@tabler/icons-react";
import { MAX_COMPETITORS } from "@workspace/lib/constants";
import { cleanAndValidateDomain } from "@/lib/domain-categories";

export interface CompetitorEntry {
	_key: string;
	name: string;
	domains: string[];
	aliases: string[];
	expanded: boolean;
}

interface CompetitorsEditorProps {
	competitors: CompetitorEntry[];
	onChange: (next: CompetitorEntry[]) => void;
	disabled?: boolean;
}

export function newCompetitorEntry(partial?: Partial<CompetitorEntry>): CompetitorEntry {
	return {
		_key: crypto.randomUUID(),
		name: partial?.name ?? "",
		domains: partial?.domains ?? [],
		aliases: partial?.aliases ?? [],
		expanded: partial?.expanded ?? true,
	};
}

export function CompetitorsEditor({ competitors, onChange, disabled }: CompetitorsEditorProps) {
	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return `"${val}" is not a valid domain`;
		return true;
	}, []);

	const update = (key: string, patch: Partial<CompetitorEntry>) => {
		onChange(competitors.map((c) => (c._key === key ? { ...c, ...patch } : c)));
	};
	const remove = (index: number) => onChange(competitors.filter((_, i) => i !== index));
	const add = () => {
		if (competitors.length >= MAX_COMPETITORS) return;
		onChange([...competitors, newCompetitorEntry()]);
	};

	const validCount = competitors.filter((c) => c.name.trim() && c.domains.some((d) => d.trim())).length;

	return (
		<div className="space-y-4">
			{competitors.map((competitor, index) => (
				<div key={competitor._key} className="border rounded-lg overflow-hidden">
					<div className="flex items-center gap-3 p-3">
						<div className="flex-1 min-w-0">
							{competitor.name ? (
								<span className="text-sm font-medium">{competitor.name}</span>
							) : (
								<span className="text-sm text-muted-foreground italic">Unnamed competitor</span>
							)}
							{competitor.domains.some(Boolean) && (
								<span className="text-xs text-muted-foreground ml-2">
									{competitor.domains.filter(Boolean)[0]}
								</span>
							)}
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => update(competitor._key, { expanded: !competitor.expanded })}
							className="p-1.5 h-auto cursor-pointer shrink-0"
							disabled={disabled}
						>
							<Pencil className="h-3.5 w-3.5 text-muted-foreground" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => remove(index)}
							className="p-1.5 h-auto cursor-pointer shrink-0 text-muted-foreground hover:text-destructive"
							disabled={disabled}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					</div>

					{competitor.expanded && (
						<div className="px-3 pb-3 pt-0 space-y-3 border-t bg-muted/30">
							<div className="space-y-1.5 pt-3">
								<Label className="text-xs font-medium flex items-center gap-1.5">
									Name
									<Tooltip>
										<TooltipTrigger asChild>
											<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
										</TooltipTrigger>
										<TooltipContent className="max-w-xs text-xs font-normal">
											The primary name used to detect this competitor in AI responses. Mention detection applies to <strong>future</strong> prompt runs only.
										</TooltipContent>
									</Tooltip>
								</Label>
								<Input
									type="text"
									value={competitor.name}
									onChange={(e) => update(competitor._key, { name: e.target.value })}
									placeholder="Competitor name"
									className="bg-background"
									disabled={disabled}
								/>
							</div>

							<div className="space-y-1.5">
								<Label className="text-xs font-medium flex items-center gap-1.5">
									Domains
									<Tooltip>
										<TooltipTrigger asChild>
											<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
										</TooltipTrigger>
										<TooltipContent className="max-w-xs text-xs font-normal">
											All domains owned by this competitor. Citation categorization updates retroactively &mdash; existing citations from these domains will immediately be classified as &quot;competitor&quot;.
										</TooltipContent>
									</Tooltip>
								</Label>
								<TagsInput
									value={competitor.domains.filter(Boolean)}
									onValueChange={(values) => update(competitor._key, { domains: values })}
									placeholder="Add domain..."
									maxItems={10}
									normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
									onValidate={validateDomain}
								/>
							</div>

							<div className="space-y-1.5">
								<Label className="text-xs font-medium flex items-center gap-1.5">
									Aliases
									<Tooltip>
										<TooltipTrigger asChild>
											<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
										</TooltipTrigger>
										<TooltipContent className="max-w-xs text-xs font-normal">
											Alternative names for this competitor (sub-brands, product names, abbreviations). Used for mention detection in <strong>future</strong> prompt runs only &mdash; does not apply retroactively.
										</TooltipContent>
									</Tooltip>
								</Label>
								<TagsInput
									value={competitor.aliases}
									onValueChange={(values) => update(competitor._key, { aliases: values })}
									placeholder="Add alias..."
									maxItems={10}
								/>
							</div>
						</div>
					)}
				</div>
			))}

			{competitors.length < MAX_COMPETITORS && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={add}
					className="flex items-center gap-2 cursor-pointer"
					disabled={disabled}
				>
					<Plus className="h-4 w-4" /> Add Competitor
				</Button>
			)}

			{competitors.length >= MAX_COMPETITORS && (
				<p className="text-xs text-muted-foreground">
					Maximum of {MAX_COMPETITORS} competitors allowed. Remove a competitor to add a new one.
				</p>
			)}

			<p className="text-xs text-muted-foreground">
				<strong>
					{validCount}/{MAX_COMPETITORS}
				</strong>{" "}
				competitors configured
			</p>
		</div>
	);
}
