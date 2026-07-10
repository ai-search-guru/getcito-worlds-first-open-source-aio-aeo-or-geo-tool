import type { Meta } from "@storybook/react";
import { ChartExportPreview, type ChartExportPreviewProps } from "@/components/chart-export-preview";
import { setMockRouteContext, MockRouteContextProvider } from "./_mocks/tanstack-router";
import { setMockClientConfig, type ClientConfig } from "./_mocks/config-client";

const CHART_COLORS = [
	"#2563eb", "#efb118", "#3ca951", "#ff725c",
	"#a463f2", "#ff8ab7", "#38b2ac", "#9c6b4e",
];

const mockBrand = {
	id: "brand-1",
	name: "Acme Corp",
	website: "https://acme.com",
	enabled: true,
	onboarded: true,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

const mockCompetitors = [
	{ id: "comp-1", name: "Competitor Alpha", domain: "alpha.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
	{ id: "comp-2", name: "Competitor Beta", domain: "beta.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
	{ id: "comp-3", name: "Competitor Gamma", domain: "gamma.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

function generateChartData(days: number) {
	const data: Array<{ date: string; [key: string]: number | string | null }> = [];
	const now = new Date();
	let seed = 42;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	for (let i = days - 1; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		data.push({
			date: date.toISOString().split("T")[0],
			"brand-1": Math.round(random() * 40 + 45),
			"comp-1": Math.round(random() * 30 + 25),
			"comp-2": Math.round(random() * 25 + 15),
			"comp-3": Math.round(random() * 20 + 5),
		});
	}
	return data;
}

const defaultClientConfig: ClientConfig = {
	mode: "local",
	features: { readOnly: false, showOptimizeButton: false, supportsMultiOrg: true, canCreateBrands: true },
	branding: { name: "Getcito", chartColors: CHART_COLORS },
	analytics: {},
};

function setupMocks() {
	setMockClientConfig(defaultClientConfig);
	setMockRouteContext({ clientConfig: defaultClientConfig });
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
			<div className="border border-gray-200 inline-block">{children}</div>
		</div>
	);
}

function ExportPreview(props: ChartExportPreviewProps) {
	return (
		<MockRouteContextProvider value={{ clientConfig: defaultClientConfig }}>
			<ChartExportPreview {...props} />
		</MockRouteContextProvider>
	);
}

export default {
	title: "Chart Export Preview",
} satisfies Meta;

export const GetcitoDefault = () => {
	setupMocks();
	const data = generateChartData(30);
	const branding = { isWhitelabel: false, chartColors: CHART_COLORS };

	return (
		<MockRouteContextProvider value={{ clientConfig: defaultClientConfig }}>
			<div className="p-6 space-y-8">
				<Section label="Default (Getcito) — standard prompt">
					<ExportPreview
						promptName="What are the best running shoes for marathon training?"
						visibility={80}
						data={data}
						lookback="1m"
						brand={mockBrand}
						competitors={mockCompetitors}
						branding={branding}
					/>
				</Section>

				<Section label="Default (Getcito) — long prompt name (should truncate)">
					<ExportPreview
						promptName="What are the best running shoes for long distance marathon training on trails and roads with good arch support and cushioning for heavy runners who overpronate?"
						visibility={55}
						data={data}
						lookback="1m"
						brand={mockBrand}
						competitors={mockCompetitors}
						branding={branding}
					/>
				</Section>

				<Section label="Default (Getcito) — high visibility">
					<ExportPreview
						promptName="Best trail running shoes 2025"
						visibility={95}
						data={generateChartData(7)}
						lookback="1w"
						brand={mockBrand}
						competitors={mockCompetitors}
						branding={branding}
					/>
				</Section>
			</div>
		</MockRouteContextProvider>
	);
};

export const Whitelabel = () => {
	setupMocks();
	const data = generateChartData(30);

	const whitelabelBranding = {
		name: "BrandMonitor Pro",
		icon: "https://api.dicebear.com/9.x/shapes/svg?seed=brand",
		parentUrl: "https://agency.example.com",
		isWhitelabel: true,
		chartColors: CHART_COLORS,
	};

	return (
		<MockRouteContextProvider value={{ clientConfig: defaultClientConfig }}>
			<div className="p-6 space-y-8">
				<Section label="Whitelabel — with icon and parent URL">
					<ExportPreview
						promptName="What are the best running shoes for beginners?"
						visibility={100}
						data={data}
						lookback="1m"
						brand={mockBrand}
						competitors={mockCompetitors}
						branding={whitelabelBranding}
					/>
				</Section>

				<Section label="Whitelabel — long prompt name">
					<ExportPreview
						promptName="What are the most comfortable running shoes for people with flat feet who need extra stability and motion control for daily training runs on pavement?"
						visibility={72}
						data={data}
						lookback="1m"
						brand={mockBrand}
						competitors={mockCompetitors}
						branding={whitelabelBranding}
					/>
				</Section>
			</div>
		</MockRouteContextProvider>
	);
};
