import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  guessedVolumeEstimate,
  keywordVolumeEstimate,
  promptVolumeEstimate,
  snapshotVolumeEstimate,
  sumEstimates,
  type VolumeEstimate,
} from '@/lib/volumeEstimate';
import {
  EstimateBadge,
  EstimateNoteTooltip,
  EstimateRange,
  createEstimateNoteHandle,
} from './VolumeEstimate';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = new Date('2026-10-22T12:00:00Z');
const row = (googleVolumes: Record<string, number>, estAiVolume: number) => ({
  estAiVolume,
  googleVolumes,
  aiVolumeMultiplier: 0.45,
  keywords: [...Object.keys(googleVolumes), 'unmeasured'],
  fetchedAt: '2026-10-10T19:28:41Z',
});
const medium = promptVolumeEstimate(row({ a: 400, b: 2000, c: 10_000 }, 900), NOW);
const low = promptVolumeEstimate(row({ a: 2000 }, 900), NOW);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    ),
  );
}

/** The method note a trigger opens on focus. */
async function noteOf(trigger: HTMLElement) {
  act(() => trigger.focus());
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  return document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? '';
}

describe('EstimateRange', () => {
  it('shows the range, not a bare number, and says how it was built on focus', async () => {
    render(<EstimateRange estimate={medium} />);
    const trigger = container.querySelector('button')!;
    expect(trigger.textContent).toBe('540–1.8k');
    expect(trigger.getAttribute('aria-label')).toBe(
      '540–1.8k a month, estimated, Medium confidence',
    );
    expect(trigger.className).not.toContain('text-muted-foreground');

    const note = await noteOf(trigger);
    expect(note).toContain('How we estimate AI search volume');
    expect(note).toContain('× the share of Google searches that now get an AI answer (45%)');
    expect(note).toContain('3 of 4 related keywords have Google search data.');
    expect(note).toContain('Sources: Google search volume from DataForSEO (Oct 2026)');
    expect(note).toContain('Confidence: Medium · updated Oct 10, 2026');
    expect(note).toContain('Measured numbers, such as your visibility');
    expect(note).not.toContain('Low confidence');
  });

  it('greys a low-confidence estimate and says it is not ranked on its own', async () => {
    render(<EstimateRange estimate={low} />);
    const trigger = container.querySelector('button')!;
    expect(trigger.textContent).toBe('450–1.8k');
    expect(trigger.className).toContain('text-muted-foreground');
    const note = await noteOf(trigger);
    expect(note).toContain('With one to go by, the range is half to twice the estimate.');
    expect(note).toContain('Low confidence: shown in grey, and not used to rank on its own.');
  });

  it('describes a total by its prompts and their confidence', async () => {
    const total = sumEstimates([medium, low]);
    render(<EstimateRange estimate={total} kind="total" />);
    const note = await noteOf(container.querySelector('button')!);
    expect(note).toContain("The sum of 2 prompts' estimates.");
    expect(note).toContain('Confidence by prompt: 0 high, 1 medium, 1 low.');
  });
});

describe('the note for other kinds of estimate', () => {
  it("says a keyword's volume is measured and only the AI share assumed", async () => {
    render(
      <EstimateRange estimate={keywordVolumeEstimate(22_200, 0.45, '2026-10-10T19:28:41Z', NOW)} />,
    );
    const note = await noteOf(container.querySelector('button')!);
    expect(note).toContain(
      "This keyword's monthly Google searches × the share of Google searches that now get an AI answer",
    );
    expect(note).toContain('the range is ±25%');
    expect(note).toContain('Confidence: Medium · updated Oct 10, 2026');
  });

  it("says a suggestion's volume is an AI's guess, dated by the suggestion", async () => {
    render(<EstimateRange estimate={guessedVolumeEstimate(1200, '2026-10-22T08:00:00Z')} />);
    const note = await noteOf(container.querySelector('button')!);
    expect(note).toContain("An AI's estimate for a prompt you don't track yet");
    expect(note).toContain("Source: GetCito's AI, from your tracked prompts' estimates.");
    expect(note).toContain('Confidence: Low · suggested Oct 22, 2026');
    expect(note).not.toContain('DataForSEO');
  });
});

describe("the note for a sum of an AI's guesses", () => {
  it('says it adds up guesses, and that low here only means grey', async () => {
    render(<EstimateRange estimate={guessedVolumeEstimate(1200, null)} kind="total" perMonth />);
    const note = await noteOf(container.querySelector('button')!);
    expect(note).toContain("The sum of an AI's estimates for suggested prompts");
    expect(note).toContain("Low confidence: an AI's guess, shown in grey.");
    expect(note).not.toContain('not used to rank');
  });
});

describe("the note for an opportunity's kept volume", () => {
  it("says it is its question's old estimate, undated, in grey", async () => {
    render(<EstimateRange estimate={snapshotVolumeEstimate(18_660)} perMonth />);
    expect(container.querySelector('button')!.textContent).toBe('9.3–38k/mo');
    const note = await noteOf(container.querySelector('button')!);
    expect(note).toContain("This opportunity's question's estimate when it was made");
    expect(note).toContain("the opportunity's question's estimate, kept when it was made.");
    expect(note).toContain('Confidence: Low');
    expect(note).not.toContain('·');
    expect(note).toContain('Low confidence: an old estimate, shown in grey.');
    expect(note).not.toContain('DataForSEO');
  });
});

describe('a shared note for a long table', () => {
  it('mounts one note, telling the estimate whose range has focus', async () => {
    const handle = createEstimateNoteHandle();
    render(
      <>
        <EstimateRange estimate={medium} handle={handle} />
        <EstimateRange estimate={low} handle={handle} />
        <EstimateNoteTooltip handle={handle} />
      </>,
    );
    const [first, second] = container.querySelectorAll('button');
    expect(await noteOf(second as HTMLElement)).toContain('Confidence: Low');
    expect(document.querySelectorAll('[data-slot="tooltip-content"]')).toHaveLength(1);
    act(() => (second as HTMLElement).blur());
    expect(await noteOf(first as HTMLElement)).toContain('Confidence: Medium');
  });
});

describe('EstimateBadge', () => {
  it('reads "Estimate", or "Estimate · low confidence"', () => {
    const badge = (estimate: VolumeEstimate) => {
      render(<EstimateBadge estimate={estimate} />);
      return container.querySelector('button')!;
    };
    expect(badge(medium).textContent).toBe('Estimate');
    expect(badge(medium).getAttribute('aria-label')).toBe(
      "Estimate, Medium confidence: how it's built",
    );
    expect(badge(low).textContent).toBe('Estimate · low confidence');
  });
});
