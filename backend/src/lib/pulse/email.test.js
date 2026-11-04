import { describe, expect, it } from 'vitest';

import { renderPulseEmail } from './email.js';

const metrics = {
  kpis: {
    visibilityRate: 42,
    weekRate: 43,
    weekTrend: 1.2,
    mentions: 20,
    mentionsChange: 2,
    citations: 8,
    citationsChange: -1,
    sentimentPct: 75,
    sentimentChange: 0,
    visiblePrompts: 4,
    promptCount: 10,
  },
  highlights: [],
  warnings: [],
  degradedPlatforms: [],
  windowDays: 7,
};

describe('renderPulseEmail', () => {
  it('escapes user-controlled HTML values', () => {
    const { html } = renderPulseEmail({
      brandName: '<script>alert("x")</script>',
      metrics: {
        ...metrics,
        highlights: [
          {
            type: 'prompt_gain',
            promptText: '<script>alert("prompt")</script>',
            gain: 1.5,
          },
          {
            type: 'competitor_overtaken',
            competitorName: 'Bad "Brand"',
            brandRate: 12,
            competitorRate: 8,
          },
        ],
      },
      insightsUrl: 'https://example.com/insights?a=1&b=2',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;prompt&quot;)&lt;/script&gt;');
    expect(html).toContain('Bad &quot;Brand&quot;');
    expect(html).not.toContain('<script>alert("prompt")</script>');
  });

  it('renders the degraded-platform notice only when needed', () => {
    const healthy = renderPulseEmail({
      brandName: 'Acme',
      metrics,
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });
    expect(healthy.html).not.toContain('Data collection was degraded');

    const degraded = renderPulseEmail({
      brandName: 'Acme',
      metrics: { ...metrics, degradedPlatforms: ['chatgpt-web', 'perplexity-web'] },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });
    expect(degraded.html).toContain('Data collection was degraded on ChatGPT, Perplexity today');
  });

  it('renders a visibility slip under Needs attention', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: {
        ...metrics,
        warnings: [
          { type: 'visibility_slipping', key: 'visibility_slipping', from: 42, to: 35, drop: 7 },
        ],
      },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('⚠ Needs attention');
    expect(html).toContain('Visibility is slipping: <strong>42 → 35</strong> week-over-week');
  });

  it('names the pulse after its window in the subject and heading', () => {
    const render = (windowDays) =>
      renderPulseEmail({
        brandName: 'Acme',
        metrics: { ...metrics, windowDays },
        insightsUrl: 'https://example.com/insights',
        settingsUrl: 'https://example.com/settings',
      });

    const weekly = render(7);
    expect(weekly.subject).toBe('Acme Weekly Pulse — visibility 42 (+1.2 pts this week)');
    expect(weekly.html).toContain('Weekly Pulse — Acme</h1>');

    const daily = render(1);
    expect(daily.subject).toBe('Acme Daily Pulse — visibility 42 (+1.2 pts this week)');
    expect(daily.html).toContain('Daily Pulse — Acme</h1>');
  });

  it('uses the rounded change when selecting the KPI trend arrow', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: { ...metrics, kpis: { ...metrics.kpis, weekTrend: -0.04 } },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('color:#059669;">▲ 0</div>');
    expect(html).not.toContain('color:#dc2626;">▼ 0</div>');
  });
});
