import { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { Skeleton } from "@workspace/ui/components/skeleton";

interface PageHeaderProps {
	title: string;
	subtitle: string;
	infoContent?: ReactNode;
	children?: ReactNode;
}

/** Title + subtitle block. No filter state, no data fetching — callers
 *  compose the filter section and content as children. */
export function PageHeader({ title, subtitle, infoContent, children }: PageHeaderProps) {
	return (
		<div className="space-y-0">
			<div className="mb-4">
				<h1 className="text-3xl font-bold flex items-center gap-2">
					{title}
					{infoContent && (
						<Tooltip>
							<TooltipTrigger asChild>
								<IconInfoCircle className="h-5 w-5 text-muted-foreground cursor-help" />
							</TooltipTrigger>
							<TooltipContent className="max-w-xs text-sm font-normal">
								{infoContent}
							</TooltipContent>
						</Tooltip>
					)}
				</h1>
				<p className="text-muted-foreground mt-1">{subtitle}</p>
			</div>
			{children}
		</div>
	);
}

export function PageHeaderTitleSkeleton() {
	return (
		<div className="mb-4 space-y-2">
			<Skeleton className="h-9 w-48" />
			<Skeleton className="h-5 w-80" />
		</div>
	);
}

/** Wrapper for the filter bar + visibility bar sitting under the page title. */
export function FilterSection({ children }: { children: ReactNode }) {
	return <div className="pt-2 pb-4">{children}</div>;
}
