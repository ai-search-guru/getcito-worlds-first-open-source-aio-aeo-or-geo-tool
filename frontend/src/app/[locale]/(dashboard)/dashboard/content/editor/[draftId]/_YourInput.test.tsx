import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { NO_INPUTS, type DraftInputs } from '@/lib/content/draftInputs';
import type { InputsUpdate } from './_useDraftInputs';
import { YourInput, type InputPrompt } from './_YourInput';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom's files can't be read as text, as browsers' can.
if (!('text' in Blob.prototype)) {
  Object.assign(Blob.prototype, {
    text(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

/** Brief › Your input (Quality spec §6, CE-048): what only the person can give. */

const PROMPTS: InputPrompt[] = [
  {
    id: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
    text: 'best pour-over grinder',
    answers: 825,
    mentioned: 28,
  },
  {
    id: '0b7d0c43-6f1e-4b8e-9d0a-2f6b1c2f3e4d',
    text: 'quiet coffee grinder',
    answers: 12,
    mentioned: 0,
  },
];

let container: HTMLDivElement;
let root: Root;
const changes: DraftInputs[] = [];

/** Makes each change to the input as it is then, as the editor does, so the block shows it. */
function Harness({ initial, scrollRequest }: { initial: DraftInputs; scrollRequest?: number }) {
  const [inputs, setInputs] = useState(initial);
  const latest = useRef(initial);
  const change = (update: InputsUpdate) => {
    const next = update(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    changes.push(next);
    setInputs(next);
  };
  return (
    <YourInput
      inputs={inputs}
      prompts={PROMPTS}
      scrollRequest={scrollRequest ?? null}
      onChange={change}
    />
  );
}

async function render(initial: DraftInputs = NO_INPUTS, scrollRequest?: number) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness initial={initial} scrollRequest={scrollRequest} />
      </NextIntlClientProvider>,
    );
  });
}

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = <T extends HTMLElement>(label: string) =>
  container.querySelector<T>(`[aria-label="${label}"]`)!;
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const last = () => changes.at(-1)!;

async function upload(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The file is read as text after the change.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  changes.length = 0;
  toast.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('Your input', () => {
  it("offers GetCito data from the draft's prompts, cited as of this month", async () => {
    await render();
    expect(container.textContent).toContain(
      'From your GetCito data: in 825 answers to “best pour-over grinder” over the last 30 days, you were named 28 times.',
    );
    expect(container.textContent).toContain("over the last 30 days, you weren't named.");

    await act(async () => button('Use this').click());
    expect(last().getcitoData).toEqual([
      {
        promptId: PROMPTS[0].id,
        prompt: 'best pour-over grinder',
        answers: 825,
        mentioned: 28,
        asOf: '2026-10-24',
        days: 30,
      },
    ]);
    // Used: no longer offered, shown with how it is cited.
    expect(container.textContent).toContain('Cited as “GetCito data, October 2026”.');
    expect(container.textContent).not.toContain('From your GetCito data: in 825');

    await act(async () => field<HTMLButtonElement>('Remove best pour-over grinder').click());
    expect(last().getcitoData).toEqual([]);
  });

  it('keeps the experience on Save, or when the person leaves its box', async () => {
    await render();
    const box = container.querySelector<HTMLTextAreaElement>('#your-experience')!;
    expect(button('Save').disabled).toBe(true);
    await act(async () => setValue(box, '  We tested three grinders for six weeks.  '));
    await act(async () => button('Save').click());
    expect(last().experience).toBe('We tested three grinders for six weeks.');

    await act(async () => setValue(box, 'We tested four grinders.'));
    await act(async () => {
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(last().experience).toBe('We tested four grinders.');
    expect(changes).toHaveLength(2);
  });

  it('adds a quote only with all four of its parts, and an http(s) source', async () => {
    await render();
    const add = () => button('Add quote');
    await act(async () => {
      setValue(field('Name'), 'Ada Lovelace');
      setValue(field('Title and company'), 'Head of Research, Acme');
      setValue(field('The quote, word for word'), 'We cut our forecast misses in half.');
      setValue(field('Source link (https://…)'), 'acme.example/talk');
    });
    expect(add().disabled).toBe(true);
    await act(async () => setValue(field('Source link (https://…)'), 'https://acme.example/talk'));
    expect(add().disabled).toBe(false);

    await act(async () => add().click());
    expect(last().quotes).toEqual([
      {
        name: 'Ada Lovelace',
        title: 'Head of Research, Acme',
        text: 'We cut our forecast misses in half.',
        sourceUrl: 'https://acme.example/talk',
      },
    ]);
    expect(container.textContent).toContain('“We cut our forecast misses in half.”');
    // The form is empty again for the next one.
    expect(field<HTMLInputElement>('Name').value).toBe('');
    expect(container.textContent).toContain('Add quotes from real people only.');
  });

  it('reads a CSV in the browser, or pasted numbers, as a table', async () => {
    await render();
    await upload(new File(['Teams,Share\n1250,42%\n'], 'survey.csv', { type: 'text/csv' }));
    expect(last().data).toEqual([
      {
        name: 'survey.csv',
        rows: [
          ['Teams', 'Share'],
          ['1250', '42%'],
        ],
      },
    ]);
    expect(container.textContent).toContain('survey.csv · 2 rows');

    const paste = field<HTMLTextAreaElement>(
      'Or paste numbers, one row a line, separated by commas',
    );
    await act(async () => setValue(paste, 'Month,Visits\nOctober,3400'));
    await act(async () => button('Add these numbers').click());
    expect(last().data[1]).toEqual({
      name: 'Pasted numbers',
      rows: [
        ['Month', 'Visits'],
        ['October', '3400'],
      ],
    });
  });

  it("says why a file can't be used, and keeps nothing from it", async () => {
    await render();
    await upload(new File(['hello'], 'notes.pdf'));
    expect(toast.error).toHaveBeenCalledWith("notes.pdf isn't a CSV or Excel (.xlsx) file.");
    const big = new File(['x'], 'big.csv');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await upload(big);
    expect(toast.error).toHaveBeenCalledWith('big.csv is over 10 MB.');
    await upload(new File([''], 'empty.csv'));
    expect(toast.error).toHaveBeenCalledWith('empty.csv has no rows to use.');
    expect(changes).toHaveLength(0);
  });

  it('keeps a large table to the rows the draft can keep, and says so', async () => {
    await render();
    const row = Array.from({ length: 12 }, () => 'x'.repeat(200)).join(',');
    const csv = Array.from({ length: 100 }, () => row).join('\n');
    await upload(new File([csv], 'big.csv'));
    const kept = last().data[0].rows.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(100);
    expect(toast).toHaveBeenCalledWith(
      `big.csv is kept to its first ${kept} rows: that is what fits beside your other data.`,
    );
    // Full: the next one isn't kept.
    await upload(new File([csv], 'again.csv'));
    expect(toast.error).toHaveBeenCalledWith('Your data is full. Remove a table to add another.');
    expect(last().data).toHaveLength(1);
  });

  it('keeps a change made while a file is read', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['Teams,Share\n1250,42%\n'], 'survey.csv')],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Use this').click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(last().getcitoData).toHaveLength(1);
    expect(last().data.map((table) => table.name)).toEqual(['survey.csv']);
  });

  it('reads numbers pasted from a spreadsheet into their columns', async () => {
    await render();
    const paste = field<HTMLTextAreaElement>(
      'Or paste numbers, one row a line, separated by commas',
    );
    await act(async () => setValue(paste, 'Month\tVisits\nOctober\t3400'));
    await act(async () => button('Add these numbers').click());
    expect(last().data[0].rows).toEqual([
      ['Month', 'Visits'],
      ['October', '3400'],
    ]);
  });

  it('says what the agent never does', async () => {
    await render();
    expect(container.textContent).toContain(
      'Content Agent never makes things up. No invented people, quotes, customer stories, test results or numbers.',
    );
  });

  it("scrolls into view on Quality's Add", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      await render(NO_INPUTS, 3);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      // The same Add, shown again: not again.
      await render(NO_INPUTS, 3);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
