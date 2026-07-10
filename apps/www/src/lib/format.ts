/**
 * Format a "YYYY-MM-DD" blog date as e.g. "May 30, 2026". Parsed and rendered
 * in UTC so the displayed day matches the frontmatter regardless of the
 * viewer's timezone.
 */
export function formatPostDate(value: string): string {
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}
