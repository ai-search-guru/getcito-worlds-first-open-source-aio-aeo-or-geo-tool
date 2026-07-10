import { useRouteContext } from "@tanstack/react-router";
import { IconInfoCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import type { ClientConfig } from "@workspace/config/types";

export function DemoModePill() {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const isReadOnly = context.clientConfig?.features.readOnly ?? false;

	if (!isReadOnly) return null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
					<IconInfoCircle className="size-3" />
					Demo
				</span>
			</TooltipTrigger>
			<TooltipContent>
				This is a read-only demo. Any edits will fail.
			</TooltipContent>
		</Tooltip>
	);
}
