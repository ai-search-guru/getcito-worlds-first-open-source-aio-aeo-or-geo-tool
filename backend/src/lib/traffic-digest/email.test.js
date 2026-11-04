import { describe, expect, it } from 'vitest';
import { renderTrafficDigestEmail } from './email.js';

/** The AI Traffic weekly digest's e-mail (AT-013). */

const digest = (over = {}) =>
  renderTrafficDigestEmail({
    brandName: 'Acme <Coffee>',
    week: { firstDay: '2026-10-12', lastDay: '2026-10-18' },
    visits: 42,
    change: -30,
    sentences: ['Last week: 42 AI-referred visits, down 30% on the week before.'],
    changes: [{ type: 'platform', name: 'chatgpt.com', before: 30, now: 12 }],
    prevVisits: 60,
    share: null,
    citedNotClicked: 3,
    platforms: [
      { platform: 'chatgpt.com', visits: 30 },
      { platform: 'perplexity.ai', visits: 12 },
    ],
    days: [
      { day: '2026-10-12', visits: 4 },
      { day: '2026-10-13', visits: 0 },
      { day: '2026-10-14', visits: 8 },
      { day: '2026-10-15', visits: 6 },
      { day: '2026-10-16', visits: 6 },
      { day: '2026-10-17', visits: 10 },
      { day: '2026-10-18', visits: 8 },
    ],
    trafficUrl: 'https://app.example.com/dashboard/traffic',
    settingsUrl: 'https://app.example.com/dashboard/settings?tab=notifications',
    ...over,
  });

describe('renderTrafficDigestEmail', () => {
  it('leads with the visits and their change, then the summary line and the top changes', () => {
    const { subject, html } = digest();
    expect(subject).toBe('Acme <Coffee> AI traffic last week: 42 AI visits (−30%)');
    // A whole document that says its own charset, whatever the client assumes.
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('Acme &lt;Coffee&gt;');
    expect(html).toContain('Oct 12 – Oct 18');
    expect(html).toContain('Last week: 42 AI-referred visits, down 30% on the week before.');
    expect(html).toContain('Top changes');
    expect(html).toContain('ChatGPT sent 12 AI visits, down from 30.');
    expect(html).toContain('href="https://app.example.com/dashboard/traffic"');
    expect(html).toContain('href="https://app.example.com/dashboard/settings?tab=notifications"');
    // Nothing the brand typed reaches the HTML unescaped.
    expect(html).not.toContain('<Coffee>');
  });

  it('shows the cards, the visits by day and the platforms, in the brand colors', () => {
    const { html } = digest();
    // AI visits with its change; the top platform; cited-not-clicked without Analytics.
    expect(html).toContain('▼ 30% on the week before');
    expect(html).toContain('>ChatGPT</div>');
    expect(html).toContain('Cited, not clicked');
    expect(html).not.toContain('Share of traffic');
    // Seven day columns, Monday first; the busiest day is the tallest bar.
    expect(html).toContain('AI visits by day');
    expect(html.match(/>(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</g)).toEqual([
      '>Mon<',
      '>Tue<',
      '>Wed<',
      '>Thu<',
      '>Fri<',
      '>Sat<',
      '>Sun<',
    ]);
    expect(html).toContain('height:72px;');
    // The platforms by name, their bars as long as their share of the top one.
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Perplexity');
    expect(html).toContain(
      '<td width="40%" style="height:8px;line-height:8px;font-size:0;background:#1C1A17;',
    );
    // Only the brand's neutrals, and red, green and amber for what changed.
    const palette = ['#1C1A17', '#464442', '#F0EEEA', '#EBE6DE', '#FFFFFF'];
    const status = ['#067647', '#ECFDF3', '#B42318', '#FEF3F2', '#B54708', '#FFFAEB'];
    for (const color of new Set(html.match(/#[0-9a-fA-F]{6}\b/g))) {
      expect([...palette, ...status]).toContain(color);
    }
    // A fall is marked red.
    expect(html).toContain('color:#B42318;background:#FEF3F2;">▼</div>');
  });

  it('names the share of traffic when Analytics gives one', () => {
    const { html } = digest({ share: '0.8%' });
    expect(html).toContain('Share of traffic');
    expect(html).toContain('0.8%');
  });

  it('leaves out a change it cannot state, and the list when nothing moved', () => {
    const { subject, html } = digest({ visits: 1, prevVisits: 0, change: null, changes: [] });
    expect(subject).toBe('Acme <Coffee> AI traffic last week: 1 AI visit');
    expect(html).toContain('none the week before');
    expect(html).not.toContain('Top changes');
  });
});
