import { createFileRoute } from "@tanstack/react-router";
import ImageResponse from "@takumi-rs/image-response/wasm";
import takumiWasm from "virtual:takumi-wasm";
import titanOne400Data from "virtual:font/titan-one-400";
import geistSans400Data from "virtual:font/geist-sans-400";
import geistSans500Data from "virtual:font/geist-sans-500";
import { DEFAULT_APP_NAME } from "@workspace/config/constants";
import { renderOgImage } from "@workspace/og/render";

export const Route = createFileRoute("/og.png")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const title = url.searchParams.get("title") ?? undefined;
				const description = url.searchParams.get("description") ?? undefined;

				const response = new ImageResponse(
					renderOgImage({
						appName: DEFAULT_APP_NAME,
						title,
						description,
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
