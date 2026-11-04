import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuditRecommendation, AuditResult, AuditSignal } from '@/lib/actions/audits';
import { AuditReport } from './AuditReport';

// Outbound authority links' way to Settings (00449).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE =
  'Your input needed: replace each highlighted [bracket] with your own details before you publish.';

const rec = (over: Partial<AuditRecommendation> = {}): AuditRecommendation => ({
  signalKey: 'case-study-evidence',
  label: 'Case study evidence',
  category: 'eeat',
  priority: 'medium',
  recommendation: 'Add one real customer result next to the plans.',
  draft: null,
  ...over,
});

const audit = (
  recommendations: AuditRecommendation[],
  previous: Partial<
    Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'signals' | 'partial'>
  > = {},
): AuditResult => ({
  id: 'a1',
  brandId: 'b1',
  url: 'https://getcito.com/pricing',
  finalUrl: 'https://getcito.com/pricing',
  status: 'completed',
  totalScore: 0.63,
  categoryScores: {},
  signalsEvaluated: 45,
  signalsTotal: 47,
  rubricVersion: '1',
  error: null,
  createdAt: '2026-10-17T09:00:00.000Z',
  completedAt: '2026-10-17T09:01:00.000Z',
  signals: [],
  recommendations,
  ...previous,
});

const signal = (over: Partial<AuditSignal>): AuditSignal => ({
  key: 'readability',
  category: 'content',
  status: 'pass',
  score: 1,
  evidence: {},
  label: 'Readability',
  what: null,
  why: null,
  howToFix: null,
  impactTier: 'standard',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

function render(
  recommendations: AuditRecommendation[],
  previous: Partial<
    Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'signals' | 'partial'>
  > = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditReport audit={audit(recommendations, previous)} />
      </NextIntlClientProvider>,
    );
  });
}

const marks = () => [...container.querySelectorAll('pre mark')].map((m) => m.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditReport recommendations', () => {
  it('highlights the brand’s own facts in a draft as its input needed', () => {
    render([rec({ draft: '[customer name] grew AI citations by [your result] with Growth.' })]);

    expect(container.querySelector('pre')?.textContent).toBe(
      '[customer name] grew AI citations by [your result] with Growth.',
    );
    expect(marks()).toEqual(['[customer name]', '[your result]']);
    expect([...container.querySelectorAll('mark')].map((m) => m.getAttribute('title'))).toEqual([
      'Your input needed',
      'Your input needed',
    ]);
    expect(container.textContent).toContain(NOTE);
  });

  it('shows the code in its own block with its own copy button', () => {
    render([
      rec({
        signalKey: 'faq-schema',
        draft: 'How much is Starter? Starter costs $49 a month.',
        code: '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
      }),
    ]);

    const blocks = [...container.querySelectorAll('pre')].map((p) => p.textContent);
    expect(blocks).toEqual([
      'How much is Starter? Starter costs $49 a month.',
      '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
    ]);
    expect(container.querySelector('[aria-label="Copy draft"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy code"]')).not.toBeNull();
    // A JSON array is not a placeholder.
    expect(marks()).toEqual(['[date]']);
    expect(container.textContent).toContain(NOTE);
  });

  it('adds no note to copy without placeholders, or to an older audit without code', () => {
    render([rec({ draft: 'GetCito pricing: AI visibility plans for every team size' })]);

    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(marks()).toEqual([]);
    expect(container.textContent).not.toContain(NOTE);
  });
});

describe('AuditReport score change', () => {
  it('shows a positive percentage-point delta and the previous audit date', () => {
    render([], {
      previousScore: 0.56,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });

    expect(container.textContent).toContain('+7 since Sep 28');
  });

  it('shows negative and zero deltas accurately', () => {
    render([], {
      previousScore: 0.7,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('-7 since Sep 28');

    render([], {
      previousScore: 0.63,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('0 since Sep 28');
  });

  it('does not show a delta when there is no prior completed score/date', () => {
    render([]);
    expect(container.textContent).not.toContain('since');

    render([], { previousScore: 0.56 });
    expect(container.textContent).not.toContain('since');
  });
});

describe('AuditReport partial audit', () => {
  const PARTIAL = messages.audit.partialNote;
  const NO_CREDIT = messages.audit.partialNoCredit;

  it("says when the AI checks didn't run, and that it used no audit; not otherwise", () => {
    render([], { partial: true });
    expect(container.textContent).toContain(PARTIAL);
    expect(container.textContent).toContain(NO_CREDIT);

    render([]);
    expect(container.textContent).not.toContain(PARTIAL);
    expect(container.textContent).not.toContain(NO_CREDIT);
  });
});

describe('a signal’s finding', () => {
  /** Opens each signal row, and reads the panels' text. */
  const open = () => {
    for (const button of container.querySelectorAll<HTMLButtonElement>('button[aria-controls]')) {
      act(() => button.click());
    }
    return [...container.querySelectorAll('[id^="signal-panel-"]')].map((p) => p.textContent);
  };

  it('shows readability in parts, with the formula and language it was read in', () => {
    render([], {
      signals: [
        signal({
          evidence: {
            language: 'tr',
            formula: 'atesman',
            readingScore: 81,
            wordsPerSentence: 5.6,
            syllablesPerWord: 2.6,
            lettersPerWord: 6,
            wordsPerParagraph: 33,
            mobileLinesPerParagraph: 6,
          },
        }),
      ],
    });
    expect(open()).toEqual([
      'Finding: Reading score 81 (Ateşman, Turkish)' +
        'Sentences: 5.6 words on average' +
        'Words: 2.6 syllables and 6 letters on average' +
        'Paragraphs: 33 words on average, about 6 lines each on a phone',
    ]);
  });

  it('says when a language has no reading formula yet, and counts first-person sentences', () => {
    render([], {
      signals: [
        signal({
          status: 'warn',
          evidence: {
            language: 'it',
            formula: null,
            readingScore: null,
            wordsPerSentence: 24,
            syllablesPerWord: null,
            lettersPerWord: 5.1,
            wordsPerParagraph: null,
            mobileLinesPerParagraph: null,
          },
        }),
        signal({
          key: 'first-person',
          category: 'eeat',
          label: 'First-person evidence',
          evidence: { language: 'en', firstPersonSentences: 29, sentences: 35 },
        }),
      ],
    });
    expect(open()).toEqual([
      'Finding: No reading-score formula for Italian yet: read by sentence and word length' +
        'Sentences: 24 words on average' +
        'Words: 5.1 letters on average',
      'Finding: 29 sentences of 35 told in the first person (English)',
    ]);
  });

  it('shows an older audit’s Flesch score as nothing rather than a part', () => {
    render([], { signals: [signal({ status: 'fail', evidence: { fleschReadingEase: 27 } })] });
    expect(open()).toEqual(['']);
  });
});
