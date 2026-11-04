import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Affected } from '@/lib/action-center/affected';
import { AffectedTab } from './AffectedTab';
import { promptVolumeEstimate } from '@/lib/volumeEstimate';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base: Affected = {
  prompts: [],
  pages: [],
  promptTotal: 0,
  pageTotal: 0,
  platforms: [],
  lostPages: [],
  competitors: [],
  topics: [],
};

const headers = () => [...container.querySelectorAll('th')].map((th) => th.textContent);

describe('AffectedTab', () => {
  it('shows a lost citation row with its demand, page and what is cited instead', () => {
    render(
      <AffectedTab
        affected={{
          ...base,
          promptTotal: 1,
          prompts: [
            {
              id: 'p1',
              text: 'Which tools track AI search?',
              platforms: ['chatgpt-web'],
              lostPages: ['https://acme.example/blog/best-tools'],
              citedInstead: ['https://www.profound.com/features'],
              leaders: [],
              topics: [],
            },
          ],
        }}
        volumes={
          new Map([
            [
              'p1',
              promptVolumeEstimate({
                estAiVolume: 25_100,
                googleVolumes: { a: 40_000, b: 55_800, c: 70_000 },
                aiVolumeMultiplier: 0.45,
                keywords: ['a', 'b', 'c'],
                fetchedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
              }),
            ],
          ])
        }
      />,
    );
    // The Volume column says its figures are estimates, with their note (2026-11-01).
    expect(headers()).toEqual([
      'Prompt',
      'VolumeEstimate',
      'Lost on',
      'Your lost page',
      'Cited instead',
    ]);
    const cells = [...container.querySelectorAll('td')].map((td) => td.textContent);
    // An estimate: its range (PROMPT-013).
    expect(cells[1]).toBe('18–32k');
    expect(cells[3]).toContain('/blog/best-tools');
    expect(cells[4]).toContain('profound.com');
    // The prompt opens its page; its chart icon, the Positions panel.
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/prompts/p1');
    expect(links).toContain('/dashboard/prompts?tab=all&positions=p1');
  });

  it('leaves out columns nothing fills', () => {
    render(
      <AffectedTab
        affected={{
          ...base,
          promptTotal: 1,
          prompts: [
            {
              id: null,
              text: 'A prompt',
              platforms: [],
              lostPages: [],
              citedInstead: [],
              leaders: [],
              topics: [],
            },
          ],
        }}
        volumes={null}
      />,
    );
    expect(headers()).toEqual(['Prompt']);
  });

  it('says how many there are when it lists only the first ones', () => {
    render(
      <AffectedTab
        affected={{
          ...base,
          promptTotal: 60,
          prompts: [
            {
              id: 'p1',
              text: 'One',
              platforms: [],
              lostPages: [],
              citedInstead: [],
              leaders: [],
              topics: [],
            },
          ],
        }}
        volumes={null}
      />,
    );
    expect(container.textContent).toContain('60 prompts');
    expect(container.textContent).toContain('Showing 1 of 60');
  });
});
