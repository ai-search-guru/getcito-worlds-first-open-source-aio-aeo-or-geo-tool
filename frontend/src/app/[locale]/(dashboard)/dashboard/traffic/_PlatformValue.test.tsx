import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TrafficEngagement } from '@/lib/actions/traffic';
import { EngagedCell, KeyEventsCell, PlatformValueNote } from './_PlatformValue';

/**
 * AT-005 (spec §3.4): Referrals by Platform shows what each platform's
 * visitors did in Google Analytics — engaged share and key events — muted
 * below 30 sessions, "—" for a platform Analytics never saw, and a note
 * while Analytics has no data.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
  return container;
}

const ga = (sessions: number, engagedSessions: number, keyEvents = 0): TrafficEngagement => ({
  sessions,
  engagedSessions,
  keyEvents,
  keyEventSessions: 0,
});

describe('EngagedCell', () => {
  it("shows the share of the platform's sessions Analytics counts as engaged", () => {
    const span = render(<EngagedCell analytics={ga(120, 90)} />).querySelector('span')!;
    expect(span.textContent).toBe('75%');
    expect(span.title).toBe('');
  });

  it('mutes a rate on fewer than 30 sessions, with the count on hover (§5.4)', () => {
    const span = render(<EngagedCell analytics={ga(4, 3)} />).querySelector('span')!;
    expect(span.textContent).toBe('75%');
    expect(span.className).toContain('text-muted-foreground');
    expect(span.title).toBe('Low sample: 4 sessions in Google Analytics');
  });

  it('shows "—" for a platform Analytics never saw', () => {
    expect(render(<EngagedCell analytics={null} />).textContent).toBe('—');
    expect(render(<EngagedCell analytics={ga(0, 0)} />).textContent).toBe('—');
  });
});

describe('KeyEventsCell', () => {
  it("shows the platform's key events, or — without Analytics", () => {
    expect(render(<KeyEventsCell analytics={ga(120, 90, 7)} />).textContent).toBe('7');
    expect(render(<KeyEventsCell analytics={ga(120, 90, 0)} />).textContent).toBe('0');
    expect(render(<KeyEventsCell analytics={null} />).textContent).toBe('—');
  });
});

describe('PlatformValueNote', () => {
  it('says what the columns need', () => {
    expect(render(<PlatformValueNote />).textContent).toBe(
      'Engaged and key events need Google Analytics.',
    );
  });
});
