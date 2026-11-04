'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AnswerActions } from '@/components/chat/run/AnswerActions';
import { RunAnswer } from '@/components/chat/run/RunAnswer';
import type { ChatStep } from '@/lib/chat/events';
import { emptyRun, type ClientRun } from '@/lib/chat/runState';

/** The sample run's handle: no such run, so its downloads say they couldn't. */
const PREVIEW_RUN = '00000000-0000-4000-8000-0000000000aa';

/** The mockup's answer (#s-ask): what the pretend run reads, opens and checks. */
const READ: ChatStep = {
  n: 2,
  kind: 'read',
  label: 'Read Citations',
  status: 'running',
  detail: 'Google AI Overviews · Last 7 days · 12 prompts',
};
const OPENED: ChatStep = {
  n: 3,
  kind: 'open_page',
  label: 'Opened getcito.com/blog/what-is-aeo',
  status: 'running',
};
const CHECKED: ChatStep = {
  n: 4,
  kind: 'check',
  label: 'Checked facts',
  status: 'running',
};
const ANSWER =
  'Two pages lost most of it. **/blog/what-is-aeo** lost 14 citations and **/features** lost 6. For the same prompts, Google AI Overviews now cites newer 2026 guides from two publishers. Both of your pages were last updated in March.';

/** The run at each tick of the preview: thinking, a read, a page, the check, the answer. */
function runAt(tick: number): ClientRun {
  const done = (step: ChatStep, extra: Partial<ChatStep> = {}): ChatStep => ({
    ...step,
    status: 'done',
    ...extra,
  });
  const steps: ChatStep[] = [
    { n: 1, kind: 'thinking', label: 'Thinking', status: tick < 2 ? 'running' : 'done' },
  ];
  if (tick >= 2) steps.push(tick < 4 ? READ : done(READ, { rowCount: 3180 }));
  if (tick >= 4) steps.push(tick < 6 ? OPENED : done(OPENED));
  const words = ANSWER.split(' ');
  const shown = tick < 6 ? 0 : Math.min(words.length, (tick - 5) * 8);
  if (shown === words.length) {
    steps.push(
      tick < 6 + Math.ceil(words.length / 8) + 1
        ? CHECKED
        : done(CHECKED, { detail: 'Every figure matches the data' }),
    );
  }
  const finished = tick >= 6 + Math.ceil(words.length / 8) + 2;
  return {
    ...emptyRun(tick === 0 ? 'queued' : finished ? 'done' : 'running'),
    steps,
    text: words.slice(0, shown).join(' '),
    ...(finished
      ? { generatedAt: new Date().toISOString(), dataAsOf: new Date().toISOString() }
      : {}),
  };
}

const LAST_TICK = 6 + Math.ceil(ANSWER.split(' ').length / 8) + 2;

/**
 * The live answer (W1-14) for design sign-off: Play runs the mockup's
 * answer a step at a time, from the events a real run sends; nothing is
 * read or sent.
 */
export function RunPreview() {
  const t = useTranslations('chatRun.preview');
  const [tick, setTick] = useState(LAST_TICK);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const play = () => {
    if (timer.current) clearInterval(timer.current);
    setTick(0);
    timer.current = setInterval(() => {
      setTick((n) => {
        if (n + 1 >= LAST_TICK && timer.current) clearInterval(timer.current);
        return Math.min(n + 1, LAST_TICK);
      });
    }, 700);
  };

  const current = runAt(tick);
  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="mb-4 flex items-center gap-3 text-sm font-semibold">
        {t('title')}
        <span className="font-normal text-muted-foreground">{t('note')}</span>
        <Button
          data-action="preview.playRun"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={play}
        >
          {t('play')}
        </Button>
      </h2>
      <div className="mx-auto max-w-[720px]">
        <RunAnswer
          run={current}
          workingMs={tick * 700}
          footer={
            // The answer's actions as they show (W1-25); a sample answer has no file to download.
            <AnswerActions
              runId={PREVIEW_RUN}
              markdown={current.text}
              filed={false}
              onFiled={() => undefined}
            />
          }
        />
      </div>
    </section>
  );
}
