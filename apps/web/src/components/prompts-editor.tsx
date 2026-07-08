import { useState, useRef } from "react";
import { Button } from "@workspace/ui/components/button";
import { Save } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useInvalidatePromptsSummary } from "@/hooks/use-prompts-summary";
import { updatePromptsFn } from "@/server/prompts";
import { trackEvent } from "@/lib/posthog";
import { PromptsListEditor, type EditablePrompt } from "@/components/prompts-list-editor";

interface Prompt {
	id: string;
	brandId: string;
	value: string;
	enabled: boolean;
	tags?: string[];
	systemTags?: string[];
	createdAt: Date;
}

interface PromptsEditorProps {
	initialPrompts: Prompt[];
	brandId: string;
	pageTitle: string;
	pageDescription: string;
}

export function PromptsEditor({ initialPrompts, brandId, pageTitle, pageDescription }: PromptsEditorProps) {
	const [prompts, setPrompts] = useState<EditablePrompt[]>(() =>
		initialPrompts.map((p) => ({
			id: p.id,
			_key: p.id,
			value: p.value,
			enabled: p.enabled,
			tags: p.tags || [],
			systemTags: p.systemTags || [],
		})),
	);
	const [isLoading, setIsLoading] = useState(false);
	const saveInProgress = useRef(false);
	const navigate = useNavigate();
	const invalidatePromptsSummary = useInvalidatePromptsSummary();

	const savePrompts = async () => {
		if (saveInProgress.current) {
			console.warn("Save already in progress, ignoring duplicate request");
			return;
		}

		saveInProgress.current = true;
		setIsLoading(true);
		try {
			const validPrompts = prompts.filter((p) => p.value.trim());

			const currentIds = new Set(validPrompts.filter((p) => p.id).map((p) => p.id));
			const removedPrompts = initialPrompts
				.filter((p) => !currentIds.has(p.id))
				.map((p) => ({ id: p.id, value: p.value, enabled: false, tags: p.tags || [] }));

			const allPrompts = [
				...validPrompts.map((p) => ({
					...(p.id ? { id: p.id } : {}),
					value: p.value.trim(),
					enabled: p.enabled,
					tags: p.tags,
				})),
				...removedPrompts,
			];

			await updatePromptsFn({ data: { brandId, prompts: allPrompts } });

			const added = validPrompts.filter((p) => !p.id).length;
			const edited = validPrompts.filter((p) => p.id).length;
			const deleted = removedPrompts.length;
			trackEvent("prompts_updated", { added, edited, deleted });

			invalidatePromptsSummary(brandId);
			navigate({ to: `/app/${brandId}/visibility` });
		} catch (error) {
			console.error("Error saving prompts:", error);
			alert(`Failed to save prompts: ${error instanceof Error ? error.message : "Unknown error"}`);
		} finally {
			setIsLoading(false);
			saveInProgress.current = false;
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">{pageTitle}</h1>
					<p className="text-muted-foreground">{pageDescription}</p>
				</div>
			</div>

			<PromptsListEditor prompts={prompts} onChange={setPrompts} />

			<div className="flex gap-2 items-center">
				<Button
					onClick={savePrompts}
					disabled={isLoading}
					size="sm"
					className="flex items-center gap-2 cursor-pointer"
				>
					{isLoading ? (
						<>Saving...</>
					) : (
						<>
							<Save className="h-4 w-4" />
							Save Prompts
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
