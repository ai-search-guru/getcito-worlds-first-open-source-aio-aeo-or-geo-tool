
import { Fragment } from "react";

interface TextHighlighterProps {
	text: string;
	highlight: string;
	className?: string;
	highlightClassName?: string;
}

export function TextHighlighter({
	text,
	highlight,
	className = "",
	highlightClassName = "bg-yellow-200 dark:bg-yellow-800 rounded-sm",
}: TextHighlighterProps) {
	if (!highlight || highlight.trim() === "") {
		return <span className={className}>{text}</span>;
	}

	const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`(${escapedHighlight})`, "gi");
	const segments = text.split(regex).map((part, i) => ({
		key: `${i}-${part.slice(0, 8)}`,
		part,
		isMatch: part.toLowerCase() === highlight.toLowerCase(),
	}));

	return (
		<span className={className}>
			{segments.map((seg) =>
				seg.isMatch ? (
					<mark key={seg.key} className={highlightClassName}>
						{seg.part}
					</mark>
				) : (
					<Fragment key={seg.key}>{seg.part}</Fragment>
				),
			)}
		</span>
	);
}

