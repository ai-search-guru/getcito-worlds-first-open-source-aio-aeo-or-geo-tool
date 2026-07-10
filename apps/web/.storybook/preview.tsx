import type { Decorator } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

const withQueryClient: Decorator = (Story) => (
	<QueryClientProvider client={queryClient}>
		<Story />
	</QueryClientProvider>
);

export const decorators: Decorator[] = [withQueryClient];
