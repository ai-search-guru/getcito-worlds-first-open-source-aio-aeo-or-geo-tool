export async function getWebsiteExcerpt(url: string): Promise<string> {
	if (!url) {
		return "";
	}

	try {
		// Clean the URL - ensure it starts with http/https
		const cleanUrl = url.startsWith("http") ? url : `https://${url}`;

		// Make request to Jina AI
		const jinaUrl = `https://r.jina.ai/${cleanUrl}`;
		const response = await fetch(jinaUrl, {
			method: "GET",
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; WebsiteExcerpt/1.0)",
			},
		});

		if (!response.ok) {
			console.error(`Failed to fetch website excerpt: ${response.status} ${response.statusText}`);
			return "";
		}

		const content = await response.text();

		// Split into lines and take the first 200 lines
		const lines = content.split("\n");
		const excerpt = lines.slice(0, 200).join("\n");

		return excerpt;
	} catch (error) {
		console.error("Error fetching website excerpt:", error);
		return "";
	}
}
