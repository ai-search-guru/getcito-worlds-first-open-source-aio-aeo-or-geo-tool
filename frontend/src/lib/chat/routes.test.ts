// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hrefWithFilters, routeById, routeRegistry, routeRequest } from './routes';

/** Chat's "Go to a page" (CHAT-19 §2, W1-28): the route registry and the rules-based router. */

const APP = path.resolve(__dirname, '../../app/[locale]/(dashboard)');

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
function pageExists(route: string): boolean {
  let dirs = [APP];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const params = readdirSync(dir)
        .filter((entry) => /^\[[^.\]]+\]$/.test(entry))
        .map((entry) => path.join(dir, entry));
      const named = path.join(dir, segment);
      return [...(existsSync(named) ? [named] : []), ...params];
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

describe('routeRegistry', () => {
  const routes = routeRegistry({ cloud: true });

  it('comes from the live sidebar and Settings, named as the sidebar names them', () => {
    expect(routeById('insights')).toMatchObject({ name: 'Brand Visibility', section: null });
    expect(routeById('/dashboard/prompts/tracked')).toMatchObject({
      name: 'Tracked Prompts',
      section: 'Prompts',
    });
    expect(routeById('content/plan')).toMatchObject({
      section: 'Content',
      requiredFeature: 'content_optimization',
    });
    expect(routeById('settings/ai-providers', routes)).toMatchObject({
      name: 'AI Providers',
      section: 'Settings',
    });
    expect(routeById('action-center/signals')).toMatchObject({
      name: 'Signals',
      section: 'Action Center',
    });
    expect(routeById('competitors')).toMatchObject({ requiredFeature: 'competitor_tracking' });
    // Chat doesn't open itself; Agent Center, gated as Chat is, it does.
    expect(routeById('agent')).toBeUndefined();
    expect(routeById('agents')).toMatchObject({
      name: 'Agent Center',
      section: null,
      requiredFeature: 'ai_agent',
    });
  });

  it('lists only the Settings sections this install shows: a self-hosted one has no Billing or AI Providers', () => {
    const selfHosted = routeRegistry({ cloud: false });
    expect(routeById('settings/billing', selfHosted)).toBeUndefined();
    expect(routeById('settings/ai-providers', selfHosted)).toBeUndefined();
    expect(routeById('settings/team', selfHosted)).toBeDefined();
    expect(routeById('settings/billing', routes)).toBeDefined();
  });

  it('opens only pages of the app, whatever address it is asked for', () => {
    expect(routes.every((r) => r.href.startsWith('/dashboard'))).toBe(true);
    for (const address of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '../login']) {
      expect(routeById(address, routes)).toBeUndefined();
    }
  });

  it('points every route at a page of the app, once', () => {
    expect(routes.filter((r) => !pageExists(r.href)).map((r) => r.href)).toEqual([]);
    const hrefs = routes.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('sets only the filters a page keeps, with the values it takes', () => {
    const insights = routeById('insights')!;
    const citations = routeById('citations')!;
    expect(hrefWithFilters(citations, { range: '30d', platform: 'perplexity-web' })).toEqual({
      href: '/dashboard/citations?preset=30d&platform=perplexity-web',
      applied: [
        { key: 'range', value: '30d' },
        { key: 'platform', value: 'perplexity-web' },
      ],
    });
    // Insights' `model` filter holds the answers' model slugs, not platform
    // ids: a platform id there would open an empty page.
    expect(hrefWithFilters(insights, { range: '30d', platform: 'chatgpt-web' })).toEqual({
      href: '/dashboard/insights?range=30d',
      applied: [{ key: 'range', value: '30d' }],
    });
    expect(hrefWithFilters(routeById('competitors')!, { range: '24h', platform: 'x' }).href).toBe(
      '/dashboard/competitors',
    );
    // A platform the pages don't filter by isn't set.
    expect(hrefWithFilters(insights, { platform: 'javascript:alert(1)' }).href).toBe(
      '/dashboard/insights',
    );
  });
});

describe('routeRequest', () => {
  const cloud = routeRegistry({ cloud: true });
  const to = (text: string) => {
    const routed = routeRequest(text, cloud);
    return routed ? hrefWithFilters(routed.route, routed.filters).href : null;
  };

  it('opens the page with its filters set, from plain words', () => {
    expect(to('Open Visibility for the last 30 days')).toBe('/dashboard/insights?range=30d');
    expect(to('Take me to Competitors')).toBe('/dashboard/competitors');
    expect(to('Open Settings › AI Providers')).toBe('/dashboard/settings/ai-providers');
    expect(to('go to tracked prompts for the last 7 days')).toBe(
      '/dashboard/prompts/tracked?range=7d',
    );
    expect(to('Show me citations from ChatGPT all time')).toBe(
      '/dashboard/citations?preset=all&platform=chatgpt-web',
    );
    expect(to('open the content library')).toBe('/dashboard/content/library');
    expect(to('Open Prompts › Query Fan-outs')).toBe('/dashboard/prompts/fan-outs');
    expect(to('open Agent Center')).toBe('/dashboard/agents');
    expect(to('take me to my agents')).toBe('/dashboard/agents');
  });

  it('takes the longest name it finds: Prompts Insights over Insights', () => {
    expect(to('open prompt insights')).toBe('/dashboard/prompts/insights');
    expect(to('open content plan')).toBe('/dashboard/content/plan');
  });

  it('leaves two pages of the same name to the model', () => {
    // Content › Plan, or Billing's plan; a self-hosted install has no Billing.
    expect(to('open plan')).toBeNull();
    expect(routeRequest('open plan', routeRegistry({ cloud: false }))?.route.id).toBe(
      'content/plan',
    );
    // Brand Visibility's address, or Prompts › Insights.
    expect(to('open insights')).toBeNull();
  });

  it('opens no address it was given, only pages it knows', () => {
    expect(to('open //evil.com')).toBeNull();
    expect(to('go to javascript:alert(1)')).toBeNull();
    expect(to('take me to https://evil.com/dashboard/insights')).toBeNull();
  });

  it('leaves to the model what it did not fully understand', () => {
    // A filter it can't set.
    expect(to('Show me the Content drafts under Quality 60')).toBeNull();
    // A filter the page doesn't keep.
    expect(to('Open Competitors for Perplexity')).toBeNull();
    expect(to('Open Visibility for Perplexity, last 30 days')).toBeNull();
    // A question, or no navigation verb.
    expect(to('Why did my visibility drop?')).toBeNull();
    expect(to('visibility for perplexity')).toBeNull();
    expect(to('open the thing I looked at yesterday')).toBeNull();
  });
});
