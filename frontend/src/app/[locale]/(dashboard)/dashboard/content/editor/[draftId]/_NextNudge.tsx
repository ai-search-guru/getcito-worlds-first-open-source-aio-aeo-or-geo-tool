'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ClaimMark } from '@/lib/content/qualityChecks';
import type { QualityTodo } from '@/lib/content/qualityTodos';
import { MANAGE_AUTHORS_PATH } from './_AuthorMenu';
import { useTodoCopy, type QualityRead } from './_QualityTab';

/** The moments the nudge shows at (Quality spec §4). */
export type NudgeMoment = 'agent' | 'acceptAll' | 'markReady';

/** What the nudge showed for this draft in this session, and whether Later hid it. */
const nudgeKey = (draftId: string) => `aeo:quality-nudge:${draftId}`;
interface NudgeSeen {
  later: boolean;
  /** "{moment}:{to-do}" it showed for. */
  steps: string[];
}

function readSeen(draftId: string): NudgeSeen {
  try {
    const seen = JSON.parse(sessionStorage.getItem(nudgeKey(draftId)) ?? 'null') as NudgeSeen;
    if (seen && Array.isArray(seen.steps)) return { later: !!seen.later, steps: seen.steps };
  } catch {
    // Storage unavailable (private mode) or unreadable: as if nothing showed.
  }
  return { later: false, steps: [] };
}

function writeSeen(draftId: string, seen: NudgeSeen) {
  try {
    sessionStorage.setItem(nudgeKey(draftId), JSON.stringify(seen));
  } catch {
    // It may show again this session.
  }
}

/**
 * The next-step nudge's timing (Quality spec §4, CE-040): at a moment (the
 * agent's run ended, Accept all, Mark ready) with a to-do open, it shows the
 * first open one, once per moment and to-do in the session; Later hides it
 * for the session, while the to-do stays on the list.
 */
export function useNextNudge(draftId: string, todos: QualityTodo[]) {
  const [showing, setShowing] = useState(false);
  const open = todos.filter((todo) => !todo.done);
  // All done: it goes, and a to-do open again later waits for its moment.
  if (showing && open.length === 0) setShowing(false);
  // The to-dos as they are when a moment comes, after an await.
  const openNow = useRef(open);
  useEffect(() => {
    openNow.current = open;
  });

  const at = useCallback(
    (moment: NudgeMoment) => {
      const first = openNow.current[0];
      if (!first) return;
      const seen = readSeen(draftId);
      const step = `${moment}:${first.key ?? first.id}`;
      if (seen.later || seen.steps.includes(step)) return;
      writeSeen(draftId, { ...seen, steps: [...seen.steps, step] });
      setShowing(true);
    },
    [draftId],
  );
  const later = () => {
    writeSeen(draftId, { ...readSeen(draftId), later: true });
    setShowing(false);
  };

  return {
    /** The first open to-do and how many are open, while it shows. */
    shown: showing && open.length > 0 ? { todo: open[0], count: open.length } : null,
    at,
    later,
    close: () => setShowing(false),
  };
}

/**
 * The nudge (bottom right of the draft, a dark pill): "Next for you: {the
 * first open to-do} · 1 of 3", its one action now, and Later. Its words go
 * to a status kept on the page, so screen readers hear it when it shows.
 */
export function NextNudge({
  shown,
  quality,
  onShowPlaceholder,
  onPickAuthor,
  onAddInput,
  onAddSource,
  onConfirmImages,
  onAddImage,
  onPickReviewer,
  onAddCheckDate,
  onConfirmCase,
  onConfirmIntro,
  onLater,
  onAct,
}: {
  shown: { todo: QualityTodo; count: number } | null;
  quality: Pick<QualityRead, 'author' | 'team' | 'canEdit' | 'brandFactsPath'> &
    Partial<Pick<QualityRead, 'siteType'>>;
  /** Selects the page's first placeholder, to type over. */
  onShowPlaceholder: () => void;
  onPickAuthor: () => void;
  /** Opens Brief › Your input (CE-048). */
  onAddInput?: () => void;
  /** A proof to-do's: its claim selected, the link dialog open (CE-049). */
  onAddSource?: (claim: ClaimMark) => void;
  /** Visual proof's: Confirm, or the first open spot's Add image (CE-049). */
  onConfirmImages?: () => void;
  onAddImage?: () => void;
  /** A regulated page's: the header's reviewer menu (CE-049). */
  onPickReviewer?: () => void;
  onAddCheckDate?: () => void;
  onConfirmCase?: (key: string) => void;
  onConfirmIntro?: () => void;
  onLater: () => void;
  /** It was acted on: it goes. */
  onAct: () => void;
}) {
  const t = useTranslations('contentEditor.editor.quality.nudge');
  const copy = useTodoCopy();
  const text =
    shown &&
    t.rich('text', {
      todo: copy(shown.todo, quality).next,
      position: 1,
      count: shown.count,
      b: (chunks) => <b className="font-semibold">{chunks}</b>,
    });
  const action = shown?.todo.action;
  const actClass =
    'shrink-0 rounded-full bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/90';
  return (
    <>
      <p role="status" className="sr-only">
        {text}
      </p>
      {shown && (
        <div
          role="group"
          aria-label={t('label')}
          className="absolute right-4 bottom-4 z-20 flex max-w-[min(440px,calc(100%-2rem))] items-center gap-2 rounded-2xl bg-foreground py-1.5 pr-1.5 pl-3.5 text-xs text-background shadow-lg"
        >
          <span aria-hidden className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {text}
          </span>
          {action === 'showPlaceholder' ? (
            <button
              type="button"
              className={actClass}
              onClick={() => {
                onAct();
                onShowPlaceholder();
              }}
            >
              {t('act.showPlaceholder')}
            </button>
          ) : action === 'pickAuthor' ? (
            <button
              type="button"
              className={actClass}
              onClick={() => {
                onAct();
                onPickAuthor();
              }}
            >
              {t('act.pickAuthor')}
            </button>
          ) : action === 'addInput' ? (
            onAddInput && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  onAddInput();
                }}
              >
                {t('act.addInput')}
              </button>
            )
          ) : action === 'addProof' ? (
            onAddSource &&
            shown.todo.proof && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  const { claim, sentence, block } = shown.todo.proof!;
                  onAddSource({ text: claim, sentence, block });
                }}
              >
                {t('act.addProof')}
              </button>
            )
          ) : action === 'confirmImage' || action === 'addImage' ? (
            (action === 'confirmImage' ? onConfirmImages : onAddImage) && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  (action === 'confirmImage' ? onConfirmImages : onAddImage)!();
                }}
              >
                {t(`act.${action}`)}
              </button>
            )
          ) : action === 'pickReviewer' ? (
            onPickReviewer && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  onPickReviewer();
                }}
              >
                {t('act.pickReviewer')}
              </button>
            )
          ) : action === 'confirmCase' ? (
            onConfirmCase &&
            shown.todo.key && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  onConfirmCase(shown.todo.key!);
                }}
              >
                {t('act.confirmCase')}
              </button>
            )
          ) : action === 'confirmIntro' ? (
            onConfirmIntro && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  onConfirmIntro();
                }}
              >
                {t('act.confirmIntro')}
              </button>
            )
          ) : action === 'addCheckDate' ? (
            onAddCheckDate && (
              <button
                type="button"
                className={actClass}
                onClick={() => {
                  onAct();
                  onAddCheckDate();
                }}
              >
                {t('act.addCheckDate')}
              </button>
            )
          ) : action === 'reviewBrandFacts' ? (
            quality.brandFactsPath && (
              <Link href={quality.brandFactsPath} className={actClass} onClick={onAct}>
                {t('act.reviewBrandFacts')}
              </Link>
            )
          ) : (
            action && (
              <Link href={MANAGE_AUTHORS_PATH} className={actClass} onClick={onAct}>
                {t(`act.${action}`)}
              </Link>
            )
          )}
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-1 text-background/70 hover:text-background"
            onClick={onLater}
          >
            {t('later')}
          </button>
        </div>
      )}
    </>
  );
}
