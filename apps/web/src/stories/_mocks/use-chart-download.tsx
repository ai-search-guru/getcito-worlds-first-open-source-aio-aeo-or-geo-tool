import { useRef, useState } from "react";

export function useChartDownload(_fileName: string) {
	const chartRef = useRef<HTMLDivElement>(null);
	const [isDownloading] = useState(false);

	const handleDownload = async () => {
		console.log("[mock] useChartDownload: download skipped in Ladle");
	};

	return { chartRef, isDownloading, handleDownload };
}
