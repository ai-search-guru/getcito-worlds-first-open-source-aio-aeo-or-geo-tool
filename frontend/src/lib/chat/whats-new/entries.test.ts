// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WHATS_NEW_ENTRIES,
  approvedEntry,
  byNewest,
  daysSince,
  entryAccess,
  entryProblems,
  isPublished,
  matchesFeature,
  parseEntryFile,
  plansLine,
  type ParsedEntry,
} from './entries';

/**
 * What's new entries (W4-20, CHAT-11 §A): the team writes them in
 * /whats-new, GetCito maintainers approve them in the pull request, and this keeps
 * entries.json (what the app reads) in step with the approved ones, and
 * every entry within the rules: 3–4 lines of at most 120 characters, no
 * model names, API terms, versions or internal codes, no price, and no
 * plan named in the words.
 */

const REPO = path.resolve(__dirname, '../../../../..');
const FOLDER = path.join(REPO, 'whats-new');

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
const dashboardDir = path.join(REPO, 'frontend/src/app/[locale]/(dashboard)');
function pageExists(route: string): boolean {
  let dirs = [dashboardDir];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && (d.name === segment || /^\[[^.\]]+\]$/.test(d.name)))
        .map((d) => path.join(dir, d.name));
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

const files = existsSync(FOLDER)
  ? readdirSync(FOLDER)
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .map((name) =>
        parseEntryFile(`whats-new/${name}`, readFileSync(path.join(FOLDER, name), 'utf8')),
      )
  : [];

const entry = (meta: Record<string, unknown> = {}, lines?: string[]): ParsedEntry => ({
  slug: 'agent-center',
  meta: {
    feature: 'Agent Center',
    home_line: 'Agent Center runs routine work for you.',
    route: '/dashboard/agents',
    plans: ['starter', 'growth', 'enterprise'],
    plan_mode: 'show_upgrade',
    published: '2026-11-03',
    approved: true,
    ...meta,
  },
  lines: lines ?? [
    'Routine checks took hours every week.',
    'Agents run a skill on a schedule or when something changes.',
    'You get the work done and only approve the changes.',
  ],
});

describe('entries.json', () => {
  it('holds every approved entry in /whats-new, and only those (refresh: yarn test -u src/lib/chat/whats-new)', async () => {
    const approved = files
      .map((file) => approvedEntry(file, pageExists))
      .filter((e) => e !== null)
      .sort(byNewest);
    await expect(`${JSON.stringify({ entries: approved }, null, 2)}\n`).toMatchFileSnapshot(
      './entries.json',
    );
  });

  it('keeps every entry in /whats-new within the rules, approved or not', () => {
    expect(files.flatMap((file) => entryProblems(file, pageExists))).toEqual([]);
    const slugs = files.map((file) => file.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    // Chat pages "Show older updates" by the features already shown.
    const features = files.map((file) =>
      String(file.meta.feature ?? '')
        .trim()
        .toLowerCase(),
    );
    expect(new Set(features).size).toBe(features.length);
  });
});

describe('entryProblems', () => {
  it('passes an entry within the rules', () => {
    expect(entryProblems(entry(), pageExists)).toEqual([]);
    expect(
      entryProblems(entry({}, [...entry().lines, 'Open Agent Center to start.']), pageExists),
    ).toEqual([]);
  });

  it('refuses more than four lines, fewer than three, or a line over 120 characters', () => {
    expect(entryProblems(entry({}, ['One.', 'Two.']), pageExists)).toEqual([
      'agent-center: has 2 lines; an entry has 3 or 4',
    ]);
    expect(entryProblems(entry({}, ['1.', '2.', '3.', '4.', '5.']), pageExists)).toHaveLength(1);
    expect(entryProblems(entry({}, ['A.', 'B.', `${'x'.repeat(120)}.`]), pageExists)).toEqual([
      'agent-center: line 3 is over 120 characters',
    ]);
  });

  it('refuses model names, API terms, versions, internal codes, prices and plan names', () => {
    const problems = (line: string) =>
      entryProblems(entry({}, ['Why it matters.', 'What it does.', line]), pageExists);
    for (const line of [
      'It runs on Claude Sonnet now.',
      'Built on GPT-5 for speed.',
      'We rebuilt the backend.',
      'A new API for your team.',
      'Version 2 is here.',
      'Now in 0.3.0.',
      'Shipped with CHAT-11.',
      'See #1234 for more.',
    ]) {
      expect(problems(line).join(' ')).toMatch(
        /no model names, API terms, versions or internal codes/,
      );
    }
    expect(problems('Only $49 a month.')).toContain(
      'agent-center: names a price: prices come from Billing',
    );
    expect(problems('Included from €25/mo.').join(' ')).toMatch(/price/);
    expect(problems('Available on Growth.')).toContain(
      'agent-center: names the plan "Growth": plans come from Billing (plans:)',
    );
    // The engines AI visibility is about are not model names.
    expect(problems('See how ChatGPT, Gemini and Perplexity describe you.')).toEqual([]);
  });

  it('checks the front matter: a page of the app, known plans, a mode, a day and approved', () => {
    expect(
      entryProblems(
        entry({
          route: '/dashboard/nowhere',
          plans: ['starter', 'pro'],
          plan_mode: 'maybe',
          published: '3 Nov',
          approved: 'yes',
          feature: '',
          home_line: 'No full stop',
        }),
        pageExists,
      ),
    ).toEqual([
      'agent-center: feature is missing',
      'agent-center: home_line is not one sentence',
      'agent-center: route /dashboard/nowhere is not a page of the app',
      'agent-center: plans must list some of starter, growth, enterprise',
      'agent-center: plan_mode must be hide or show_upgrade',
      'agent-center: published is not a day (YYYY-MM-DD)',
      'agent-center: approved must be true or false',
    ]);
    expect(entryProblems(entry({ route: '/dashboard/agents?tab=ready' }), pageExists)).toEqual([
      'agent-center: route is not a page of the app (/dashboard/…, no query)',
    ]);
    expect(entryProblems({ ...entry(), slug: 'Agent_Center' }, pageExists)).toContain(
      'Agent_Center: the file name is not kebab-case',
    );
  });
});

describe('parseEntryFile and approvedEntry', () => {
  const text = [
    '---',
    'feature: Agent Center',
    'home_line: Agent Center runs routine work for you.',
    'route: /dashboard/agents',
    'plans: [growth, starter]',
    'plan_mode: hide',
    'published: 2026-11-03',
    'approved: true',
    '---',
    'Routine checks took hours every week.',
    '',
    'Agents run a skill on a schedule.',
    'You only approve the changes.',
    '',
  ].join('\n');

  it('reads the front matter and the lines, blank ones left out', () => {
    const parsed = parseEntryFile('whats-new/agent-center.md', text);
    expect(parsed.slug).toBe('agent-center');
    expect(parsed.lines).toEqual([
      'Routine checks took hours every week.',
      'Agents run a skill on a schedule.',
      'You only approve the changes.',
    ]);
    expect(approvedEntry(parsed, pageExists)).toEqual({
      slug: 'agent-center',
      feature: 'Agent Center',
      homeLine: 'Agent Center runs routine work for you.',
      route: '/dashboard/agents',
      // In the plans' own order.
      plans: ['starter', 'growth'],
      planMode: 'hide',
      published: '2026-11-03',
      lines: parsed.lines,
    });
  });

  it('keeps out an entry not approved, or not within the rules', () => {
    expect(
      approvedEntry(
        parseEntryFile('whats-new/a.md', text.replace('approved: true', 'approved: false')),
        pageExists,
      ),
    ).toBeNull();
    expect(
      approvedEntry(
        parseEntryFile('whats-new/a.md', text.replace('/dashboard/agents', '/dashboard/x')),
        pageExists,
      ),
    ).toBeNull();
  });

  it('reads the approved entries newest first', () => {
    const days = WHATS_NEW_ENTRIES.map((e) => e.published);
    expect(days).toEqual([...days].sort().reverse());
  });
});

describe('entryAccess', () => {
  it('shows an entry to its plans, hides it or says the plan by its mode, and all to self-hosted', () => {
    const starter = { planId: 'starter' as const, selfHosted: false };
    expect(entryAccess({ plans: ['growth', 'enterprise'], planMode: 'hide' }, starter)).toBe(
      'hidden',
    );
    expect(
      entryAccess({ plans: ['growth', 'enterprise'], planMode: 'show_upgrade' }, starter),
    ).toBe('upgrade');
    expect(
      entryAccess({ plans: ['growth'], planMode: 'hide' }, { planId: 'growth', selfHosted: false }),
    ).toBe('included');
    expect(
      entryAccess(
        { plans: ['growth'], planMode: 'hide' },
        { planId: 'self_hosted', selfHosted: true },
      ),
    ).toBe('included');
  });

  it('names the plans as Billing does', () => {
    expect(plansLine(['growth', 'enterprise'])).toBe('Growth and Enterprise');
    expect(plansLine(['starter', 'growth', 'enterprise'])).toBe('Starter, Growth, and Enterprise');
  });
});

describe('dates and names', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  it('shows an entry from its day, and counts the days since', () => {
    expect(isPublished({ published: '2026-11-17' }, now)).toBe(true);
    expect(isPublished({ published: '2026-11-18' }, now)).toBe(false);
    expect(daysSince({ published: '2026-11-03' }, now)).toBe(14);
  });

  it('finds an entry by its feature or its slug, in the person’s words', () => {
    const e = approvedEntry(entry(), pageExists)!;
    expect(matchesFeature(e, 'agent center')).toBe(true);
    expect(matchesFeature(e, 'What’s new: how can Agent Center help me?')).toBe(true);
    expect(matchesFeature(e, 'agent-center')).toBe(true);
    expect(matchesFeature(e, 'mentions')).toBe(false);
    expect(matchesFeature(e, ' ')).toBe(false);
  });
});
