/**
 * Shared utility functions.
 */
import { getModelMeta } from "@workspace/lib/providers/models";

/**
 * Display name for a model id. Thin wrapper over `getModelMeta` so the UI
 * works for any deployment-configured model, not just the ones we happen
 * to have hardcoded in a switch. Unknown ids get a title-cased fallback.
 */
export function getModelDisplayName(model: string): string {
	return getModelMeta(model).label;
}
