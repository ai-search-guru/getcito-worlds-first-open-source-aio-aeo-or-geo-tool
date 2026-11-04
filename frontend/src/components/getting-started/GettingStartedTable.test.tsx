import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { FirstRun } from '@/hooks/useFirstRun';
import { buildGettingStarted, parseGettingStartedFacts } from '@/lib/getting-started/steps';
import { GettingStartedTable } from './GettingStartedTable';

/**
 * Getting started while the brand's first tracking run goes on: the steps
 * that need none of its data first, marked "Ready now"; the ones it brings
 * the data for say it is arriving and open their card. Back to the usual
 * list once it's done.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Competitors, topics and prompts set in onboarding.
const { steps } = buildGettingStarted(
  parseGettingStartedFacts({
    started_at: '2026-10-30T09:00:00Z',
    competitors: 3,
    topic_prompts: [3, 3, 3],
  })!,
);
const firstRun: FirstRun = {
  brandId: 'b1',
  queued: false,
  progress: { current: 18, total: 40 },
  left: { minutes: 6 },
};

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();

async function render(run: FirstRun | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <GettingStartedTable
          steps={steps}
          members={[]}
          onSelect={onSelect}
          selectedKey={null}
          showNote={false}
          firstRun={run}
        />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('tbody tr')];
const titles = () => rows().map((row) => row.querySelector('p')?.textContent);
const row = (title: string) => rows().find((r) => r.querySelector('p')?.textContent === title)!;
const g = messages.actionCenter.gettingStarted;

beforeEach(() => {
  onSelect.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GettingStartedTable during the first run', () => {
  it('lists the steps ready now first, marked, and the rest after', async () => {
    await render(firstRun);
    expect(titles().slice(0, 5)).toEqual([
      g.steps.kpis.title,
      g.steps.gsc.title,
      g.steps.ga.title,
      g.steps.snippet.title,
      // Done in onboarding: after the steps to do now.
      g.steps.competitors.title,
    ]);
    expect(row(g.steps.kpis.title).textContent).toContain('Ready now');
    expect(row(g.steps.competitors.title).textContent).not.toContain('Ready now');
    expect(container.textContent?.match(/Ready now/g)).toHaveLength(4);
  });

  it('says the data of the steps it brings is arriving, and opens their card', async () => {
    await render(firstRun);
    const mentions = row(g.steps.mentions.title);
    expect(mentions.textContent).toContain('Arriving now');
    expect(mentions.className).toContain('cursor-pointer');
    // The high-value prompts wait for Search Console, and the act steps for
    // the suggestions that come after the run: as before.
    expect(row(g.steps.data_prompts.title).textContent).toContain(g.readyWhen.dataPrompts);
    expect(row(g.steps.data_prompts.title).className).toContain('cursor-default');
    expect(row(g.steps.pick_content.title).textContent).toContain(g.readyWhen.act);
    expect(row(g.steps.pick_content.title).className).toContain('cursor-default');
  });

  it('is the usual list once the first run is done', async () => {
    await render(null);
    expect(titles().slice(0, 3)).toEqual([
      g.steps.kpis.title,
      g.steps.competitors.title,
      g.steps.topics.title,
    ]);
    expect(container.textContent).not.toContain('Ready now');
    expect(container.textContent).not.toContain('Arriving now');
    expect(row(g.steps.mentions.title).textContent).toContain(g.readyWhen.explore);
  });
});
