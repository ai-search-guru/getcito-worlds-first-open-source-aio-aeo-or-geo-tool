import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import type { QualityTodo } from '@/lib/content/qualityTodos';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { NextNudge, useNextNudge } = await import('./_NextNudge');
type NudgeMoment = import('./_NextNudge').NudgeMoment;

/**
 * The next-step nudge (Quality spec §4, CE-040): "Next for you: {first open
 * to-do} · 1 of n", at the agent's end, Accept all and Mark ready, once per
 * moment and to-do; Later hides it for the session.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: null,
  photoUrl: null,
  sameAs: [],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const pick: QualityTodo = {
  id: 'byline',
  done: false,
  gain: 60,
  score: 'eeat',
  action: 'pickAuthor',
};
const profile: QualityTodo = {
  id: 'authorProfile',
  done: false,
  gain: 40,
  score: 'eeat',
  action: 'editAuthor',
};

let container: HTMLDivElement;
let root: Root;
const onPickAuthor = vi.fn();
const onShowPlaceholder = vi.fn();
const onAddSource = vi.fn();
const onConfirmImages = vi.fn();
const onPickReviewer = vi.fn();
const MOMENTS: NudgeMoment[] = ['agent', 'acceptAll', 'markReady'];

/** The editor's part: the hook, a button per moment, and the nudge while it shows. */
function Harness({ todos, author }: { todos: QualityTodo[]; author: ContentAuthor | null }) {
  const nudge = useNextNudge('d1', todos);
  return (
    <>
      {MOMENTS.map((moment) => (
        <button key={moment} type="button" data-moment={moment} onClick={() => nudge.at(moment)} />
      ))}
      <NextNudge
        shown={nudge.shown}
        quality={{
          author,
          team: 'Acme Team',
          canEdit: true,
          brandFactsPath: '/dashboard/brands/b1/settings?tab=facts',
        }}
        onShowPlaceholder={onShowPlaceholder}
        onPickAuthor={onPickAuthor}
        onAddSource={onAddSource}
        onConfirmImages={onConfirmImages}
        onPickReviewer={onPickReviewer}
        onLater={nudge.later}
        onAct={nudge.close}
      />
    </>
  );
}

async function render(todos: QualityTodo[], author: ContentAuthor | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness todos={todos} author={author} />
      </NextIntlClientProvider>,
    );
  });
}
const nudge = () => container.querySelector('[aria-label="Your next step"]');
const status = () => container.querySelector('[role="status"]')!.textContent;
const nudgeAt = (moment: NudgeMoment) =>
  container.querySelector<HTMLButtonElement>(`[data-moment="${moment}"]`)!.click();
const button = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === name)!;

beforeEach(() => {
  sessionStorage.clear();
  onPickAuthor.mockReset();
  onShowPlaceholder.mockReset();
  onAddSource.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('NextNudge', () => {
  it('names the first open to-do at a moment, and opens the author menu', async () => {
    await render([pick]);
    expect(nudge()).toBeNull();
    // A status kept on the page, so screen readers hear the nudge when it shows.
    expect(status()).toBe('');
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe("Next for you: pick the page's author · 1 of 1Pick nowLater");
    expect(nudge()!.querySelector('b')!.textContent).toBe("pick the page's author");
    expect(status()).toBe("Next for you: pick the page's author · 1 of 1");
    await act(async () => button('Pick now').click());
    expect(onPickAuthor).toHaveBeenCalled();
    expect(nudge()).toBeNull();
    expect(status()).toBe('');
  });

  it('shows the first placeholder the agent left (CE-044)', async () => {
    const fill: QualityTodo = {
      id: 'placeholders',
      done: false,
      gain: 0,
      score: 'eeat',
      action: 'showPlaceholder',
      count: 2,
    };
    await render([fill, pick]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe('Next for you: fill 2 placeholders · 1 of 2Show nowLater');
    await act(async () => button('Show now').click());
    expect(onShowPlaceholder).toHaveBeenCalled();
    expect(nudge()).toBeNull();
  });

  it('sends the brand facts to approve to Brand settings (CE-047)', async () => {
    const facts: QualityTodo = {
      id: 'brandFacts',
      done: false,
      gain: 0,
      score: 'trust',
      action: 'reviewBrandFacts',
      count: 2,
    };
    await render([facts]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe(
      'Next for you: approve 2 brand facts · 1 of 1Review nowLater',
    );
    expect(button('Review now').getAttribute('href')).toBe(
      '/dashboard/brands/b1/settings?tab=facts',
    );
  });

  it("selects a proof to-do's claim for its link, each claim once per moment (CE-049)", async () => {
    const proof = (claim: string): QualityTodo => ({
      id: 'proof',
      key: `proof:${claim}\nWe are ${claim}.`,
      done: false,
      gain: 4,
      score: 'trust',
      action: 'addProof',
      proof: { claim, block: `We are ${claim}.`, kind: 'award', sentence: `We are ${claim}.` },
    });
    await render([proof('award-winning'), proof('SOC 2 certified')]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe(
      'Next for you: add proof for “award-winning” · 1 of 2Add nowLater',
    );
    await act(async () => button('Add now').click());
    expect(onAddSource).toHaveBeenCalledWith({
      text: 'award-winning',
      sentence: 'We are award-winning.',
      block: 'We are award-winning.',
    });
    expect(nudge()).toBeNull();
    // The next claim is another to-do: the same moment shows it.
    await render([proof('SOC 2 certified')]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toContain('add proof for “SOC 2 certified”');
  });

  it("opens Confirm for the page's own images (CE-049, part d)", async () => {
    onConfirmImages.mockReset();
    await render([
      { id: 'visualProof', done: false, gain: 8, score: 'eeat', action: 'confirmImage', count: 1 },
    ]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe('Next for you: show your own image · 1 of 1Confirm nowLater');
    await act(async () => button('Confirm now').click());
    expect(onConfirmImages).toHaveBeenCalled();
  });

  it('opens the reviewer menu for a regulated page (CE-049, part e)', async () => {
    onPickReviewer.mockReset();
    await render([
      {
        id: 'reviewer',
        done: false,
        gain: 0,
        score: 'eeat',
        action: 'pickReviewer',
        topic: 'legal',
      },
    ]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe(
      'Next for you: add a qualified reviewer · 1 of 1Pick nowLater',
    );
    await act(async () => button('Pick now').click());
    expect(onPickReviewer).toHaveBeenCalled();
  });

  it('counts the open ones and skips the done', async () => {
    await render([{ ...pick, done: true }, profile], ada);
    await act(async () => nudgeAt('markReady'));
    expect(nudge()!.textContent).toContain(
      "Next for you: complete Ada Lovelace's profile · 1 of 1",
    );
    expect(button('Edit now').getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('shows once per moment and to-do, and not with none open', async () => {
    await render([pick]);
    await act(async () => nudgeAt('acceptAll'));
    await act(async () => button('Pick now').click());
    await act(async () => nudgeAt('acceptAll'));
    expect(nudge()).toBeNull();
    // Another moment for the same to-do still shows.
    await act(async () => nudgeAt('markReady'));
    expect(nudge()).not.toBeNull();

    await render([{ ...pick, done: true }]);
    expect(nudge()).toBeNull();
    sessionStorage.clear();
    await act(async () => nudgeAt('agent'));
    expect(nudge()).toBeNull();
  });

  it('hides for the session on Later', async () => {
    await render([pick, profile]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toContain('1 of 2');
    await act(async () => button('Later').click());
    expect(nudge()).toBeNull();
    await act(async () => nudgeAt('markReady'));
    expect(nudge()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('aeo:quality-nudge:d1')!)).toMatchObject({
      later: true,
    });
  });

  it('goes once the to-dos are done, and moves on to the next one meanwhile', async () => {
    await render([pick]);
    await act(async () => nudgeAt('agent'));
    // Picked from the header instead: the profile is next.
    await render([{ ...pick, done: true }, profile], ada);
    expect(nudge()!.textContent).toContain("complete Ada Lovelace's profile");
    await render([
      { ...pick, done: true },
      { ...profile, done: true },
    ]);
    expect(nudge()).toBeNull();
    // A to-do open again later waits for its moment.
    await render([pick]);
    expect(nudge()).toBeNull();
  });
});
