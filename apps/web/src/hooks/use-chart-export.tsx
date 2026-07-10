import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas-pro";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import {
	ChartExportPreview,
	type ChartExportPreviewProps,
} from "@/components/chart-export-preview";

export function useChartExport(fileName: string) {
	const [isExporting, setIsExporting] = useState(false);
	const [exportData, setExportData] = useState<ChartExportPreviewProps | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const exportingRef = useRef(false);

	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;
	const mode = context.clientConfig?.mode;

	const handleExport = useCallback(
		async (data: Omit<ChartExportPreviewProps, "branding">) => {
			if (exportingRef.current) return;
			exportingRef.current = true;
			setIsExporting(true);

			const exportProps: ChartExportPreviewProps = {
				...data,
				branding: {
					name: branding?.name,
					icon: branding?.icon,
					parentUrl: branding?.parentUrl,
					isWhitelabel: mode === "whitelabel",
					chartColors: branding?.chartColors ?? [],
				},
			};

			setExportData(exportProps);

			// Wait for React to render the portal, then capture it
			await new Promise((r) => setTimeout(r, 200));

			try {
				if (!containerRef.current) throw new Error("Export container not mounted");

				const canvas = await html2canvas(containerRef.current, {
					scale: 1,
					backgroundColor: "#ffffff",
					logging: false,
					useCORS: true,
				});

				const link = document.createElement("a");
				link.download = `${fileName}.png`;
				link.href = canvas.toDataURL("image/png");
				link.click();
			} catch (error) {
				console.error("Error exporting chart:", error);
			} finally {
				setExportData(null);
				exportingRef.current = false;
				setIsExporting(false);
			}
		},
		[branding, mode, fileName],
	);

	const portal = exportData
		? createPortal(
				<div
					ref={containerRef}
					style={{
						position: "fixed",
						left: "-9999px",
						top: 0,
						zIndex: -1,
						pointerEvents: "none",
					}}
				>
					<ChartExportPreview {...exportData} />
				</div>,
				document.body,
			)
		: null;

	return { isExporting, handleExport, portal };
}
