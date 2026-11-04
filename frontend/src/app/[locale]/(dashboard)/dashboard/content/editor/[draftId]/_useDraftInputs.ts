'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getDraftInputs, saveDraftInputs } from '@/lib/actions/contentDraftInputs';
import type { DraftInputs } from '@/lib/content/draftInputs';

/** A change to the input, made to it as it is when the change lands. */
export type InputsUpdate = (current: DraftInputs) => DraftInputs;

export type DraftInputsRead =
  | { status: 'off' | 'loading' }
  | { status: 'ready'; inputs: DraftInputs; change: (update: InputsUpdate) => void }
  | { status: 'failed'; retry: () => void };

/**
 * A draft's Brief › Your input (CE-048), read once when the editor opens
 * with Quality's second phase: Brief shows it, E-E-A-T and Trust count what
 * the page uses of it.
 *
 * A change is made to the input as it is when it lands (a file read
 * meanwhile, or a card used, isn't lost), shows at once and is kept as a
 * whole. One that can't be kept says so and reads the input as kept again;
 * a change made since wins over that read. Server actions run one after
 * another, so the read comes after every save before it.
 */
export function useDraftInputs(draftId: string, on: boolean): DraftInputsRead {
  const t = useTranslations('contentEditor.editor.yourInput');
  const [inputs, setInputs] = useState<DraftInputs | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<DraftInputs | null>(null);
  const changes = useRef(0);

  useEffect(() => {
    if (!on) return;
    let live = true;
    getDraftInputs(draftId)
      .then((read) => {
        if (!live) return;
        latest.current = read;
        setInputs(read);
        setFailed(false);
      })
      .catch((err) => {
        console.error('Failed to read the input:', err);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [draftId, on, attempt]);

  const change = useCallback(
    (update: InputsUpdate) => {
      const current = latest.current;
      if (!current) return;
      const next = update(current);
      if (next === current) return;
      latest.current = next;
      changes.current += 1;
      setInputs(next);
      saveDraftInputs(draftId, next).catch((err) => {
        console.error('Failed to save the input:', err);
        toast.error(t('saveFailed'));
        const at = changes.current;
        getDraftInputs(draftId)
          .then((read) => {
            if (changes.current !== at) return;
            latest.current = read;
            setInputs(read);
          })
          .catch((readErr) => console.error('Failed to read the input:', readErr));
      });
    },
    [draftId, t],
  );
  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  if (!on) return { status: 'off' };
  if (inputs) return { status: 'ready', inputs, change };
  return failed ? { status: 'failed', retry } : { status: 'loading' };
}
