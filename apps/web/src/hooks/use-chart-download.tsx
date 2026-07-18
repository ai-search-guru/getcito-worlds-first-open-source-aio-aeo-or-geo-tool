import { useRef, useState } from "react";
import html2canvas from "html2canvas-pro";

export function useChartDownload(fileName: string) {
	const chartRef = useRef<HTMLDivElement>(null);
	const [isDownloading, setIsDownloading] = useState(false);

	const handleDownload = async () => {
		if (!chartRef.current || isDownloading) return;

		setIsDownloading(true);
		try {
			const canvas = await html2canvas(chartRef.current, {
				scale: 2,
				backgroundColor: "#ffffff",
				logging: false,
				onclone: (clonedDoc) => {
					const printHiddenElements = clonedDoc.querySelectorAll(".print\\:hidden");
					printHiddenElements.forEach((el) => el.remove());
				},
			});

			const link = document.createElement("a");
			link.download = `${fileName}.png`;
			link.href = canvas.toDataURL("image/png");
			link.click();
		} catch (error) {
			console.error("Error downloading chart:", error);
		} finally {
			setIsDownloading(false);
		}
	};

	return { chartRef, isDownloading, handleDownload };
}
