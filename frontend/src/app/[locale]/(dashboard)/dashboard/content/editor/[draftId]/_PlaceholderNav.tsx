'use client';

import { useId, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Code2 } from 'lucide-react';
import {
  placeholderIndexAt,
  placeholderMarksKey,
  selectPlaceholder,
  stepPlaceholder,
} from './_placeholderMarks';

/**
 * The toolbar's placeholders (CE-044): how many are left to fill, and the
 * way from one to the next, as long as one is left. A send to a CMS or an
 * export waits for all of them, so the person never has to search the page.
 * Those the page doesn't show (`hidden`: in an image's alt text, the
 * JSON-LD or an HTML block) are counted too, and Show in HTML, there while
 * one is left, opens the first of them: the arrows step through the page's
 * only. A screen reader hears the count as it changes, down to none left.
 */
export function PlaceholderNav({
  editor,
  hidden,
  onShowHidden,
}: {
  editor: Editor;
  /** Placeholders a send or an export finds outside the page's text. */
  hidden: number;
  onShowHidden: () => void;
}) {
  const t = useTranslations('contentEditor.editor.placeholders');
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const ranges = placeholderMarksKey.getState(e.state)?.ranges ?? [];
      const at = e.state.selection.from;
      return {
        count: ranges.length,
        // Which one the cursor is on, from 1; 0 for none.
        on: placeholderIndexAt(ranges, at) + 1,
      };
    },
  });
  const total = state.count + hidden;
  const hintId = useId();
  // Whether the page had one: then the last filled is said too.
  const [had, setHad] = useState(false);
  if (total > 0 && !had) setHad(true);
  const status = (
    <span role="status" aria-live="polite" className="sr-only">
      {total > 0 || had ? t('left', { count: total }) : ''}
    </span>
  );
  if (total === 0) return status;

  const step = (direction: 1 | -1) => {
    const ranges = placeholderMarksKey.getState(editor.state)?.ranges ?? [];
    const range = stepPlaceholder(ranges, editor.state.selection.from, direction);
    if (range) selectPlaceholder(editor, range);
  };
  const arrow =
    'inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-amber-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-amber-500/30';

  return (
    <>
      {status}
      <div
        role="group"
        aria-label={t('label')}
        className="flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      >
        {state.count > 0 ? (
          <>
            <button
              type="button"
              onClick={() => step(1)}
              className="whitespace-nowrap rounded-full pr-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {state.on > 0
                ? t('onOf', { on: state.on, count: total })
                : t('left', { count: total })}
            </button>
            <button
              type="button"
              className={arrow}
              aria-label={t('previous')}
              title={t('previous')}
              onClick={() => step(-1)}
            >
              <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={arrow}
              aria-label={t('next')}
              title={t('next')}
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="whitespace-nowrap pr-1">{t('left', { count: total })}</span>
        )}
        {hidden > 0 && (
          <>
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 hover:bg-amber-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-amber-500/30"
              title={t('hiddenHint')}
              aria-describedby={hintId}
              onClick={onShowHidden}
            >
              <Code2 aria-hidden className="h-3.5 w-3.5" />
              {t('showHidden')}
            </button>
            <span id={hintId} className="sr-only">
              {t('hiddenHint')}
            </span>
          </>
        )}
      </div>
    </>
  );
}
