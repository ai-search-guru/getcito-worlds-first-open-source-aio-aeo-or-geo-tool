import { createFileRoute, notFound } from "@tanstack/react-router";
import ImageResponse from "@takumi-rs/image-response/wasm";
import takumiWasm from "virtual:takumi-wasm";
import titanOne400Data from "virtual:font/titan-one-400";
import geistSans400Data from "virtual:font/geist-sans-400";
import geistSans500Data from "virtual:font/geist-sans-500";
import { DEFAULT_APP_NAME } from "@workspace/config/constants";
import { renderOgImage } from "@workspace/og/render";
import { source } from "@/lib/source";

export const Route = createFileRoute("/og/docs/$")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const slugs = (params._splat?.split("/") ?? []).slice(0, -1);
				const page = source.getPage(slugs);
				if (!page) throw notFound();

				const response = new ImageResponse(
					renderOgImage({
						appName: DEFAULT_APP_NAME,
						title: page.data.title,
						description: page.data.description,
					}),
					{
						width: 1200,
						height: 630,
						module: takumiWasm,
						fonts: [
							{
								name: "Titan One",
								data: titanOne400Data,
								style: "normal" as const,
								weight: 400 as const,
							},
							{
								name: "Geist Sans",
								data: geistSans400Data,
								style: "normal" as const,
								weight: 400 as const,
							},
							{
								name: "Geist Sans",
								data: geistSans500Data,
								style: "normal" as const,
								weight: 500 as const,
							},
						],
					},
				);

				return new Response(response.body, {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control":
							"public, max-age=86400, s-maxage=604800",
					},
				});
			},
		},
	},
});
