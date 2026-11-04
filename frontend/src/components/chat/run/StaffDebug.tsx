'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ChatMessageDebug } from '@/lib/chat/staffDebug';
import { saveBlob } from '@/lib/download';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Load =
  { state: 'loading' } | { state: 'failed' } | { state: 'ready'; debug: ChatMessageDebug };

const debugUrl = (runId: string) => `/api/internal/chat/messages/${runId}/debug`;

/** A count, or a dash when it wasn't measured. */
const counted = (value: number | null, dash: string) =>
  value === null ? dash : formatNumber(value);

/**
 * Chat's staff Debug view of one answer (CHAT-03 items 25–26; W1-15), shown
 * under it while Debug is on in the chat's ⋯ menu: each step with its tool,
 * input and output (the first 20 KB, then Download full), latency and cache
 * hit; then the run's model calls with tokens and cost in USD. Folded
 * until staff open it: only an answer opened is read, from the staff-only
 * endpoint, which checks the person on the server; read again as the run
 * moves on (`status`).
 */
export function StaffDebug({ runId, status }: { runId: string; status: string }) {
  const t = useTranslations('chatDebug');
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    if (!open) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad({ state: 'loading' });
    void fetch(debugUrl(runId))
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          debug?: ChatMessageDebug;
        } | null;
        if (!live) return;
        setLoad(
          res.ok && body?.ok && body.debug
            ? { state: 'ready', debug: body.debug }
            : { state: 'failed' },
        );
      })
      .catch(() => live && setLoad({ state: 'failed' }));
    return () => {
      live = false;
    };
  }, [open, runId, status]);

  async function downloadFull(n: number) {
    const res = await fetch(`${debugUrl(runId)}?full=${n}`).catch(() => null);
    if (!res?.ok) {
      toast.error(t('failed'));
      return;
    }
    saveBlob(await res.blob(), `step-${n}-output.json`);
  }

  const dash = t('unknown');
  return (
    <section
      data-slot="staff-debug"
      aria-label={t('title')}
      className="space-y-2 rounded-lg border border-dashed bg-muted/30 p-3 text-xs"
    >
      <button
        type="button"
        data-action="debug.open"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-1.5 text-left font-semibold"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
        {t('title')}
      </button>
      {open && load.state === 'loading' && <p className="text-muted-foreground">{t('loading')}</p>}
      {open && load.state === 'failed' && (
        <p className="text-red-700 dark:text-red-400">{t('failed')}</p>
      )}
      {open && load.state === 'ready' && (
        <>
          <p className="text-muted-foreground">
            {t('run', {
              status: load.debug.status,
              model: load.debug.model,
              effort: load.debug.effort,
            })}
            {load.debug.error && <> · {t('runError', { code: load.debug.error })}</>}
          </p>
          {load.debug.steps.length === 0 && <p className="text-muted-foreground">{t('noSteps')}</p>}
          <ol className="m-0 list-none space-y-2 p-0">
            {load.debug.steps.map((step) => (
              <li
                key={step.n}
                data-step={step.n}
                className="space-y-1 rounded-md border bg-card p-2"
              >
                <p className="font-medium">{t('step', { n: step.n, label: step.label })}</p>
                <p className="text-muted-foreground">
                  {t('tool')}: <code className="font-mono">{step.tool ?? t('noTool')}</code> ·{' '}
                  {step.status} ·{' '}
                  {step.latencyMs === null ? dash : t('latency', { ms: step.latencyMs })} ·{' '}
                  {step.cacheHit ? t('cacheHit') : t('cacheMiss')}
                  {step.truncated && <> · {t('cutToBudget')}</>}
                  {step.resultTokens !== null && (
                    <> · {t('resultTokens', { tokens: step.resultTokens })}</>
                  )}
                </p>
                {step.error && (
                  <p className="text-red-700 dark:text-red-400">
                    {t('error')}: {step.error}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer">{t('input')}</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(step.input, null, 2)}
                  </pre>
                </details>
                {step.output !== null && (
                  <details>
                    <summary className="cursor-pointer">
                      {t('output')}
                      {step.outputCut && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {t('outputCut', { kb: Math.ceil(step.outputBytes / 1024) })}
                        </span>
                      )}
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
                      {step.output}
                    </pre>
                    {step.outputCut && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        data-action="debug.downloadFull"
                        onClick={() => void downloadFull(step.n)}
                        className="mt-1"
                      >
                        {t('downloadFull')}
                      </Button>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ol>
          <p className="font-medium">{t('modelCalls')}</p>
          {load.debug.modelCalls.length === 0 ? (
            <p className="text-muted-foreground">{t('noModelCalls')}</p>
          ) : (
            <ul className="m-0 list-none space-y-0.5 p-0 font-mono text-[11px]">
              {load.debug.modelCalls.map((call, i) => (
                <li key={`${call.at}-${i}`} data-slot="model-call">
                  {t('modelCall', {
                    model: call.model ?? dash,
                    input: counted(call.inputTokens, dash),
                    output: counted(call.outputTokens, dash),
                    cacheRead: counted(call.cacheReadTokens, dash),
                    cacheWrite: counted(call.cacheWriteTokens, dash),
                    cost: call.costUsd.toFixed(6),
                    latency: call.latencyMs === null ? dash : t('latency', { ms: call.latencyMs }),
                  })}
                  {call.n !== null && <> · {t('forStep', { n: call.n })}</>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">
            {t('total', {
              input: formatNumber(load.debug.totals.inputTokens),
              output: formatNumber(load.debug.totals.outputTokens),
              cost: load.debug.totals.costUsd.toFixed(6),
            })}
          </p>
        </>
      )}
    </section>
  );
}
