interface YouTubeEmbedProps {
	/** YouTube video ID — the `v` query param of a watch URL (e.g. "4-9kJG6CL6U"). */
	id: string;
	/** Accessible title for the player iframe. */
	title?: string;
}

// Responsive 16:9 YouTube player, registered as the `YouTube` MDX component in
// @/components/mdx so posts can embed a video with <YouTube id="..." />. Mirrors
// the bordered media frame used by the homepage feature graphics (Frame in
// feature-graphics.tsx). Uses the privacy-enhanced youtube-nocookie host and
// lazy-loads the iframe so it doesn't block initial render; `not-prose` opts the
// frame out of the typography plugin's spacing so its own margin applies.
export function YouTubeEmbed({ id, title = "YouTube video player" }: YouTubeEmbedProps) {
	return (
		<div className="not-prose relative mb-8 aspect-video w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
			<iframe
				className="absolute inset-0 size-full"
				src={`https://www.youtube-nocookie.com/embed/${id}`}
				title={title}
				loading="lazy"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				referrerPolicy="strict-origin-when-cross-origin"
				allowFullScreen
			/>
		</div>
	);
}
