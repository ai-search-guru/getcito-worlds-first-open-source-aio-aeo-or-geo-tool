import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";

export const Route = createFileRoute("/_authed/app/$brand/$")({
	component: BrandSubpathNotFound,
});

function BrandSubpathNotFound() {
	const { brand: brandId } = Route.useParams();

	return (
		<div className="space-y-0">
			<div className="mb-4">
				<h1 className="text-3xl font-bold tracking-tight">404 Not Found</h1>
				<p className="text-muted-foreground mt-1">The page you're looking for doesn't exist.</p>
			</div>

			<div className="pt-2">
				<Button asChild variant="outline">
					<Link to="/app/$brand" params={{ brand: brandId }}>
						Go Back
					</Link>
				</Button>
			</div>
		</div>
	);
}
