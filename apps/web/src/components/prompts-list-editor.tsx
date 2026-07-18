/**
 * Shared prompts table — used by the settings/prompts page (manages a brand's
 * full prompt list) and the prompt wizard's Review step (picks from
 * AI-suggested prompts + custom additions).
 *
 * Controlled component: the caller owns the `prompts` array and the change
 * callback. The settings page wraps it with save/server logic; the wizard
 * keeps it inline. The `showSystemTags` prop hides the System Tags column
 * in the wizard since onboarding hasn't yet computed any system tags.
 */
import { useMemo, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Switch } from "@workspace/ui/components/switch";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { Textarea } from "@workspace/ui/components/textarea";
import { Plus, Inbox, ListPlus, Trash2 } from "lucide-react";
import { IconInfoCircle } from "@tabler/icons-react";
import { MAX_PROMPTS } from "@workspace/lib/constants";

export interface EditablePrompt {
	id?: string;
	_key: string;
	value: string;
	enabled: boolean;
	tags: string[];
	systemTags: string[];
}

export function newPromptEntry(partial?: Partial<EditablePrompt>): EditablePrompt {
	return {
		_key: crypto.randomUUID(),
		value: partial?.value ?? "",
		enabled: partial?.enabled ?? true,
		tags: partial?.tags ?? [],
		systemTags: partial?.systemTags ?? [],
		...(partial?.id ? { id: partial.id } : {}),
	};
}

interface PromptsListEditorProps {
	prompts: EditablePrompt[];
	onChange: (next: EditablePrompt[]) => void;
	/** Show the read-only System Tags column. Default true. */
	showSystemTags?: boolean;
	/** Optional function to dynamically compute system tags as the user types */
	computeSystemTags?: (text: string) => string[];
}

export function PromptsListEditor({ prompts, onChange, showSystemTags = true, computeSystemTags }: PromptsListEditorProps) {
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

	const allTagOptions = useMemo(() => {
		const set = new Set<string>();
		for (const p of prompts) for (const t of p.tags) set.add(t);
		return [...set].sort().map((t) => ({ value: t }));
	}, [prompts]);

	const update = (index: number, patch: Partial<EditablePrompt>) => {
		onChange(
			prompts.map((p, i) => {
				if (i !== index) return p;
				const next = { ...p, ...patch };
				// Auto-compute system tags if text changed and a compute function was provided
				if ("value" in patch && computeSystemTags) {
					next.systemTags = computeSystemTags(patch.value as string);
				}
				return next;
			}),
		);
	};
	const add = () => {
		if (prompts.length >= MAX_PROMPTS) return;
		onChange([...prompts, newPromptEntry({ tags: ["custom"] })]);
	};

	// Count selection against current prompts so stale keys (e.g. after the
	// wizard regenerates suggestions) don't linger.
	const liveSelectedCount = prompts.reduce((n, p) => (selectedKeys.has(p._key) ? n + 1 : n), 0);
	const allSelected = prompts.length > 0 && liveSelectedCount === prompts.length;

	const toggleSelect = (key: string) => {
		setSelectedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	const toggleSelectAll = () => {
		if (allSelected) setSelectedKeys(new Set());
		else setSelectedKeys(new Set(prompts.map((p) => p._key)));
	};
	const applyEnabledToSelection = (enabled: boolean) => {
		if (liveSelectedCount === 0) return;
		onChange(prompts.map((p) => (selectedKeys.has(p._key) ? { ...p, enabled } : p)));
	};
	const clearSelection = () => setSelectedKeys(new Set());

	const validCount = prompts.filter((p) => p.enabled && p.value.trim().length > 0).length;

	const [isBulkMode, setIsBulkMode] = useState(false);
	const [bulkInput, setBulkInput] = useState("");

	const handleBulkAdd = () => {
		const newLines = bulkInput
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		
		if (newLines.length === 0) {
			setIsBulkMode(false);
			return;
		}

		const spaceLeft = MAX_PROMPTS - prompts.length;
		const toAdd = newLines.slice(0, spaceLeft).map((text) => 
			newPromptEntry({ 
				value: text,
				tags: ["custom"],
				...(computeSystemTags ? { systemTags: computeSystemTags(text) } : {})
			})
		);
		
		onChange([...prompts, ...toAdd]);
		setBulkInput("");
		setIsBulkMode(false);
	};

	// Desktop layout only — column order is [select] [text] [system?] [tags] [switch+delete].
	// Mobile renders a stacked per-prompt block instead (no selection, no bulk).
	const gridCols = showSystemTags
		? "md:grid-cols-[2.25rem_minmax(0,1fr)_6rem_minmax(14rem,1fr)_5rem]"
		: "md:grid-cols-[2.25rem_minmax(0,1fr)_minmax(14rem,1fr)_5rem]";

	const remove = (index: number) => {
		onChange(prompts.filter((_, i) => i !== index));
	};

	return (
		<div className="space-y-4">
			{liveSelectedCount > 0 && (
				<div className="hidden md:flex flex-wrap items-center justify-between gap-x-2 gap-y-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
					<span className="text-muted-foreground">
						<strong className="text-foreground">{liveSelectedCount}</strong> selected
					</span>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => applyEnabledToSelection(true)}
							className="cursor-pointer"
						>
							Enable
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => applyEnabledToSelection(false)}
							className="cursor-pointer"
						>
							Disable
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={clearSelection}
							className="cursor-pointer"
						>
							Clear
						</Button>
					</div>
				</div>
			)}

			<div className={`hidden md:grid ${gridCols} gap-2 text-sm font-medium text-muted-foreground border-b pb-2`}>
				<div className="flex justify-center">
					<Checkbox
						checked={allSelected}
						onCheckedChange={toggleSelectAll}
						disabled={prompts.length === 0}
						aria-label={allSelected ? "Deselect all prompts" : "Select all prompts"}
					/>
				</div>
				<div className="flex items-center gap-1 min-w-0">
					Prompt Text
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent>
							<p className="max-w-xs">The question or query that will be sent to AI models for evaluation.</p>
						</TooltipContent>
					</Tooltip>
				</div>
				{showSystemTags && (
					<div className="hidden md:flex items-center gap-1">
						System
						<Tooltip>
							<TooltipTrigger asChild>
								<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
							</TooltipTrigger>
							<TooltipContent>
								<p className="max-w-xs">Auto-generated tags like &quot;branded&quot; or &quot;unbranded&quot; based on prompt content.</p>
							</TooltipContent>
						</Tooltip>
					</div>
				)}
				<div className="flex items-center gap-1 min-w-0">
					Tags
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent>
							<p className="max-w-xs">Custom labels to organize and filter prompts.</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<div className="flex justify-center">
					<span className="sr-only">Enabled</span>
				</div>
			</div>

			{prompts.length === 0 ? (
				<div className="border-2 border-dashed border-muted rounded-lg min-h-48 flex items-center justify-center">
					<div className="text-center py-8 text-muted-foreground">
						<Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
						<p>No prompts yet.</p>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					{prompts.map((prompt, index) => (
						<div key={prompt._key} className={!prompt.enabled ? "opacity-60" : ""}>
							{/* Mobile: stacked, no selection/bulk */}
							<div
								className={`md:hidden flex flex-col gap-2 pb-3 ${
									index < prompts.length - 1 ? "border-b" : ""
								}`}
							>
								<div className="flex items-start gap-2">
									<Input
										value={prompt.value}
										onChange={(e) => update(index, { value: e.target.value })}
										placeholder="Enter prompt text..."
										className="min-w-0 flex-1"
									/>
									<div className="pt-2 flex items-center gap-2">
										<Switch
											checked={prompt.enabled}
											onCheckedChange={(checked) => update(index, { enabled: checked })}
											aria-label={prompt.enabled ? "Disable prompt" : "Enable prompt"}
										/>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => remove(index)}
											className="h-auto p-1.5 text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
											aria-label="Delete prompt"
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</div>
								<TagsInput
									value={prompt.tags}
									onValueChange={(tags) => update(index, { tags })}
									options={allTagOptions}
									placeholder="Add tag..."
									searchPlaceholder="Search or create tag..."
									normalizeValue={(raw) => raw.toLowerCase().trim()}
								/>
							</div>

							{/* Desktop (md+): single-line grid */}
							<div className={`hidden md:grid ${gridCols} gap-2 items-start`}>
								<div className="flex justify-center pt-2">
									<Checkbox
										checked={selectedKeys.has(prompt._key)}
										onCheckedChange={() => toggleSelect(prompt._key)}
										aria-label="Select prompt"
									/>
								</div>
								<Input
									value={prompt.value}
									onChange={(e) => update(index, { value: e.target.value })}
									placeholder="Enter prompt text..."
									className="min-w-0"
								/>
								{showSystemTags && (
									<TagsInput value={prompt.systemTags} onValueChange={() => {}} disabled placeholder="—" />
								)}
								<TagsInput
									value={prompt.tags}
									onValueChange={(tags) => update(index, { tags })}
									options={allTagOptions}
									placeholder="Add tag..."
									searchPlaceholder="Search or create tag..."
									normalizeValue={(raw) => raw.toLowerCase().trim()}
								/>
								<div className="flex justify-center items-center gap-1 pt-2">
									<Switch
										checked={prompt.enabled}
										onCheckedChange={(checked) => update(index, { enabled: checked })}
										aria-label={prompt.enabled ? "Disable prompt" : "Enable prompt"}
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => remove(index)}
										className="h-auto p-1.5 text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
										aria-label="Delete prompt"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			{prompts.length < MAX_PROMPTS && (
				<div className="flex flex-col gap-2">
					{isBulkMode ? (
						<div className="space-y-2 border rounded-md p-3 bg-muted/20">
							<div className="flex justify-between items-center mb-1">
								<span className="text-sm font-medium">Bulk Add Prompts</span>
								<span className="text-xs text-muted-foreground">{MAX_PROMPTS - prompts.length} slots remaining</span>
							</div>
							<Textarea
								value={bulkInput}
								onChange={(e) => setBulkInput(e.target.value)}
								placeholder="Paste multiple prompts here, each on a new line..."
								className="min-h-[100px]"
							/>
							<div className="flex gap-2 justify-end pt-1">
								<Button size="sm" variant="ghost" onClick={() => setIsBulkMode(false)} className="cursor-pointer">
									Cancel
								</Button>
								<Button size="sm" onClick={handleBulkAdd} className="cursor-pointer">
									Add to list
								</Button>
							</div>
						</div>
					) : (
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								type="button"
								onClick={add}
								className="flex items-center gap-2 cursor-pointer"
							>
								<Plus className="h-4 w-4" /> Add Prompt
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								onClick={() => setIsBulkMode(true)}
								className="flex items-center gap-2 cursor-pointer"
							>
								<ListPlus className="h-4 w-4" /> Bulk Add
							</Button>
						</div>
					)}
				</div>
			)}

			{prompts.length >= MAX_PROMPTS && (
				<p className="text-xs text-muted-foreground">
					Maximum of {MAX_PROMPTS} prompts allowed. Remove a prompt to add a new one.
				</p>
			)}

			<p className="text-xs text-muted-foreground">
				<strong>
					{validCount}/{MAX_PROMPTS}
				</strong>{" "}
				prompts configured
			</p>
		</div>
	);
}
