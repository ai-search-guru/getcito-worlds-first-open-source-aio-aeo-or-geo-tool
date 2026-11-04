import { describe, expect, it, vi } from 'vitest';
import {
  LEAKED_REFERENCE,
  cleanStoredOpportunity,
  distance,
  fixCompetitorNames,
  resolveReferences,
} from './opportunityText.js';

// CONTENT-005: internal indexes and misspelled competitor names must not
// reach what users read.

describe('resolveReferences', () => {
  it('turns "prompt [0]" into the prompt itself', () => {
    expect(
      resolveReferences('Develop a pillar piece targeting prompt [0] to close the 48% gap.', {
        clusters: ['how to optimize content for AEO'],
      }),
    ).toBe(
      'Develop a pillar piece targeting "how to optimize content for AEO" to close the 48% gap.',
    );
  });

  it('turns page indexes into page titles, or the URL without one', () => {
    expect(
      resolveReferences('We must defend and improve [P2] by incorporating features from [P1].', {
        pages: [
          { title: 'Home', url: 'https://a.com/' },
          { title: null, url: 'https://semrush.com/kb/ai-overviews' },
          { title: 'Google AI Overviews rank tracker', url: 'https://a.com/features' },
        ],
      }),
    ).toBe(
      'We must defend and improve Google AI Overviews rank tracker by incorporating features from https://semrush.com/kb/ai-overviews.',
    );
  });

  it('names existing opportunities and cluster indexes', () => {
    expect(
      resolveReferences('Same need as [E0]; merge with cluster [1].', {
        existing: ['Best AI SEO tools guide'],
        clusters: ['AEO basics', 'AEO vs SEO'],
      }),
    ).toBe('Same need as "Best AI SEO tools guide"; merge with "AEO vs SEO".');
  });

  it('falls back to neutral words when an index has nothing behind it', () => {
    const out = resolveReferences('To address Prompt [1], update [P3] and see [E4].', {});
    expect(out).toBe('To address this prompt, update the page and see an existing opportunity.');
    expect(LEAKED_REFERENCE.test(out)).toBe(false);
  });

  it('treats a lone [3] as an index only when asked (the generator does)', () => {
    expect(resolveReferences('Answer [1] first.', { clusters: ['A', 'B'] })).toBe(
      'Answer [1] first.',
    );
    expect(resolveReferences('Answer [1] first.', { clusters: ['A', 'B'], bare: true })).toBe(
      'Answer "B" first.',
    );
  });

  it('leaves text without indexes untouched', () => {
    const text = 'Compare the top [best] tools of 2026.';
    expect(resolveReferences(text, {})).toBe(text);
  });
});

describe('fixCompetitorNames', () => {
  it('corrects a misspelled competitor to the configured name', () => {
    expect(
      fixCompetitorNames('Bridge the visibility deficit against Profund and Searchable.', [
        'Profound',
        'Searchable',
      ]),
    ).toBe('Bridge the visibility deficit against Profound and Searchable.');
  });

  it('handles multi-word names and keeps punctuation', () => {
    expect(fixCompetitorNames('Unlike Demo Cofee Co, we ship.', ['Demo Coffee Co'])).toBe(
      'Unlike Demo Coffee Co, we ship.',
    );
  });

  it('leaves ordinary words and short names alone', () => {
    expect(fixCompetitorNames('Profit and profile matter more.', ['Profound'])).toBe(
      'Profit and profile matter more.',
    );
    expect(fixCompetitorNames('Use Sem and Ahref.', ['Semr', 'Ahrefs'])).toBe(
      'Use Sem and Ahrefs.',
    );
  });
});

describe('fixCompetitorNames on everyday words', () => {
  it('never takes a lowercase word for a competitor', () => {
    expect(fixCompetitorNames('Our team writes guides; Writr is a rival.', ['Writer'])).toBe(
      'Our team writes guides; Writer is a rival.',
    );
  });
});

describe('distance', () => {
  it('is the edit distance, capped once it passes the limit', () => {
    expect(distance('profund', 'profound')).toBe(1);
    expect(distance('kitten', 'sitting')).toBe(3);
    expect(distance('a', 'abcdef', 2)).toBe(3);
  });
});

describe('cleanStoredOpportunity', () => {
  it('cleans an old single-prompt row without guessing what an index pointed at', () => {
    const row = {
      cluster_id: null,
      title: 'Optimize for prompt [0]',
      description: 'Beat Profund on [P0], the top [5] in the list.',
      source_data: {
        promptText: 'best AEO tools',
        targetPages: [{ title: 'Tools page', url: 'https://a.com/tools' }],
        assets: [{ key: 'a1', title: 'Refresh [P2]' }],
      },
    };
    const clean = cleanStoredOpportunity(row, ['Profound']);
    expect(clean.title).toBe('Optimize for "best AEO tools"');
    // [P0] numbered the run's candidate pages, not the stored target pages.
    expect(clean.description).toBe('Beat Profound on the page, the top [5] in the list.');
    expect(clean.source_data.assets[0].title).toBe('Refresh the page');
    expect(row.title).toBe('Optimize for prompt [0]');
  });

  it("doesn't name one of a cluster row's prompts for an index that numbered clusters", () => {
    const row = {
      cluster_id: 'c1',
      title: 'Merge with cluster [1]',
      description: null,
      source_data: { prompts: ['A', 'B'] },
    };
    expect(cleanStoredOpportunity(row).title).toBe('Merge with this prompt');
  });

  it('reads a past year in its titles and question as this year, and stores nothing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-02T00:00:00Z'));
    try {
      const row = {
        cluster_id: 'c1',
        title: 'Expand the coffee subscription guide into a 2026 ranking',
        description: 'Ranked in 2026.',
        source_data: {
          promptText: 'What are the best coffee subscription services in 2026?',
          assets: [{ key: 'a1', title: 'The 2025-2026 buying guide' }],
        },
      };
      const clean = cleanStoredOpportunity(row);
      expect(clean.title).toBe('Expand the coffee subscription guide into a 2027 ranking');
      expect(clean.source_data.promptText).toBe(
        'What are the best coffee subscription services in 2027?',
      );
      expect(clean.source_data.assets[0].title).toBe('The 2026-2027 buying guide');
      // Only titles and the question: a description is what the model wrote then.
      expect(clean.description).toBe('Ranked in 2026.');
      expect(row.title).toContain('2026');
      expect(row.source_data.promptText).toContain('2026');
    } finally {
      vi.useRealTimers();
    }
  });
});
