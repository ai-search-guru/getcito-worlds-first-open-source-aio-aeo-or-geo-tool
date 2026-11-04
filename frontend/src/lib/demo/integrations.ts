/**
 * Settings › Integrations on the demo brand, in one list: what each
 * integration shows there.
 *
 *   - 'connected': live today, so its own card shows as connected, the way
 *     it looks with a real connection, with sample data and a "Sample data"
 *     mark; its buttons open the plan dialog.
 *   - 'soon': not live yet, so it says Coming soon.
 *
 * `group`: an integration with no card of its own in Settings yet; the demo
 * shows a Coming soon row for it in that group. When one goes live, its line
 * here becomes `{ id, state: 'connected' }` and its new card reads
 * demoIntegration(id), as the cards below do.
 *
 * One not named here (WordPress, Framer, Wix) shows on the demo brand as on any
 * brand, not connected: its buttons open the plan dialog.
 */
export type DemoIntegrationState = 'connected' | 'soon';

export interface DemoIntegration {
  id: string;
  state: DemoIntegrationState;
  group?: 'stores' | 'cms';
}

export const DEMO_INTEGRATIONS: readonly DemoIntegration[] = [
  { id: 'google-search-console', state: 'connected' },
  { id: 'google-analytics', state: 'connected' },
  { id: 'google-merchant-center', state: 'soon' },
  { id: 'shopify', state: 'soon', group: 'stores' },
  { id: 'webflow', state: 'connected' },
];

/** What an integration's card shows on the demo brand; null when the list doesn't name it. */
export function demoIntegration(id: string): DemoIntegrationState | null {
  return DEMO_INTEGRATIONS.find((integration) => integration.id === id)?.state ?? null;
}

/** The integrations a group shows on the demo brand as Coming soon rows of their own. */
export function upcomingDemoIntegrations(group: 'stores' | 'cms'): string[] {
  return DEMO_INTEGRATIONS.filter((i) => i.group === group && i.state === 'soon').map((i) => i.id);
}

/** The demo brand's Search Console property, from its domain. */
export function demoSearchConsoleProperty(domain: string): string {
  return `sc-domain:${domain}`;
}

/** The demo brand's GA4 property: a sample id. */
export const DEMO_ANALYTICS_PROPERTY_ID = '100000000';

/** The Webflow collection the demo brand's pages go to. */
export const DEMO_WEBFLOW_COLLECTION = 'Blog Posts';
