import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import {
  getPlatformName,
  isPlatformSurface,
  movedPlatformOf,
  platformTableRows,
} from './trafficPlatforms';
import { getColor } from '@/app/[locale]/(dashboard)/dashboard/traffic/_charts';

/**
 * Every engine on the AI source list (backend/src/lib/ai-sources.json, AT-004)
 * has a name and a color on the AI Traffic page; otherwise a new engine would
 * show as a grey raw hostname.
 */

const list = JSON.parse(
  readFileSync(join(__dirname, '../../../backend/src/lib/ai-sources.json'), 'utf8'),
) as { sources: { key: string; surfaces?: { key: string }[] }[] };

describe('the AI source list on the page', () => {
  it('names every engine on the list', () => {
    for (const { key } of list.sources) {
      expect(getPlatformName(key), key).not.toBe(key);
    }
  });

  it('names every platform in the weekly digest e-mail as the page names it (AT-013)', () => {
    const digestNames = JSON.parse(
      readFileSync(
        join(__dirname, '../../../backend/src/lib/traffic-digest/platform-names.json'),
        'utf8',
      ),
    ) as Record<string, string>;
    for (const { key } of list.sources) {
      expect(digestNames[key], key).toBe(getPlatformName(key));
    }
    for (const [key, name] of Object.entries(digestNames)) {
      expect(getPlatformName(key), key).toBe(name);
    }
  });

  it('colors every engine on the list', () => {
    const fallback = getColor('not-an-engine.example');
    for (const { key } of list.sources) {
      expect(getColor(key), key).not.toBe(fallback);
    }
  });

  it('names every surface on the list (#1283)', () => {
    const platforms = messages.traffic.platforms as unknown as Record<
      'surfaces' | 'surfaceNames' | 'surfaceTips',
      Record<string, string>
    >;
    const exported = messages.traffic.export.surfaceNames as Record<string, string>;
    const surfaces = list.sources.flatMap((s) => (s.surfaces ?? []).map((surface) => surface.key));
    expect(surfaces).toContain('shopping');
    for (const key of surfaces) {
      expect(isPlatformSurface(key), key).toBe(true);
      expect(platforms.surfaces[key], key).toBeTruthy();
      expect(platforms.surfaceNames[key], key).toContain('{platform}');
      expect(platforms.surfaceTips[key], key).toBeTruthy();
      expect(exported[key], key).toBe(platforms.surfaceNames[key]);
    }
  });
});

describe('platformTableRows', () => {
  it("lists each platform's surfaces right under it, as parts of it", () => {
    const ga = { sessions: 10, engagedSessions: 8, keyEvents: 3, keyEventSessions: 2 };
    expect(
      platformTableRows([
        {
          platform: 'chatgpt.com',
          visits: 40,
          visitsPrev: 33,
          analytics: null,
          surfaces: [{ surface: 'shopping', visits: 11, visitsPrev: 4, analytics: ga }],
        },
        { platform: 'claude.ai', visits: 3, visitsPrev: 0, analytics: null, surfaces: [] },
      ]),
    ).toEqual([
      { platform: 'chatgpt.com', surface: null, visits: 40, visitsPrev: 33, analytics: null },
      { platform: 'chatgpt.com', surface: 'shopping', visits: 11, visitsPrev: 4, analytics: ga },
      { platform: 'claude.ai', surface: null, visits: 3, visitsPrev: 0, analytics: null },
    ]);
  });
});

describe('movedPlatformOf (Chat side panel, W1-08)', () => {
  const row = (platform: string, visits: number, visitsPrev: number) => ({
    platform,
    visits,
    visitsPrev,
    analytics: null,
    surfaces: [],
  });

  it('names the platform whose visits moved most, up or down', () => {
    expect(
      movedPlatformOf({
        hasPreviousPeriod: true,
        platformBreakdown: [row('chatgpt.com', 40, 30), row('perplexity.ai', 5, 25)],
      }),
    ).toEqual({ name: 'Perplexity', change: -20 });
  });

  it('only names a platform the page knows, and nothing without a previous period', () => {
    expect(
      movedPlatformOf({
        hasPreviousPeriod: true,
        platformBreakdown: [row('made-up-source', 500, 0), row('claude.ai', 3, 1)],
      }),
    ).toEqual({ name: 'Claude', change: 2 });
    expect(
      movedPlatformOf({ hasPreviousPeriod: false, platformBreakdown: [row('claude.ai', 3, 0)] }),
    ).toBeNull();
    expect(movedPlatformOf(null)).toBeNull();
  });
});
