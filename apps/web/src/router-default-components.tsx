import * as Sentry from "@sentry/tanstackstart-react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { Skeleton } from "@workspace/ui/components/skeleton";
import FullPageCard from "./components/full-page-card";

export function NotFound() {
	return (
		<FullPageCard title="404 Not Found" subtitle="The page you're looking for doesn't exist." showBackButton={true} />
	);
}

export function DefaultPendingComponent() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-9 w-48" />
				<Skeleton className="h-5 w-80" />
			</div>
			<div className="space-y-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-64 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export function DefaultErrorComponent({ error }: ErrorComponentProps) {
	useEffect(() => {
		Sentry.captureException(error);
	}, [error]);

	return (
		<FullPageCard
			title="Something went wrong"
			subtitle="An unexpected error occurred while loading this page."
			showBackButton={true}
		/>
	);
}
