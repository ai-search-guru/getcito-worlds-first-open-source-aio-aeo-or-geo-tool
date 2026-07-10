import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { FeedbackBlock } from "@workspace/docs/components/feedback/client";
import type { ActionResponse, BlockFeedback } from "@workspace/docs/components/feedback/schema";
import { YouTubeEmbed } from "@/components/youtube-embed";

async function onBlockFeedback(
	feedback: BlockFeedback,
): Promise<ActionResponse> {
	const { trackEvent } = await import("@/lib/posthog");
	trackEvent("docs_block_feedback", {
		block_id: feedback.blockId,
		block_body: feedback.blockBody || undefined,
		message: feedback.message,
		url: feedback.url,
	});
	return { success: true };
}

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		FeedbackBlock: (props: { id: string; body?: string; children: React.ReactNode }) => (
			<FeedbackBlock {...props} onSendAction={onBlockFeedback} />
		),
		YouTube: YouTubeEmbed,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
