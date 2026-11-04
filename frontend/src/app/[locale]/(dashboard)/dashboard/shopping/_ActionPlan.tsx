'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { sendShoppingActions } from '@/lib/actions/shopping';
import type { PlannedWork } from '@/lib/shopping/actionPlan';
import { cn } from '@/lib/utils';

/**
 * "Actions to get on the shelf" (ECOM-013): the proposed work for a product
 * or a category, by type, each picked or not and set to Me or Agent, sent to
 * the Action Center as one action. The agent can't take a technical fix: a
 * person does it.
 */
export function ActionPlan({
  brandId,
  target,
  plan,
  promptIds,
  onSent,
}: {
  brandId: string;
  target: { type: 'product' | 'category'; id: string };
  plan: PlannedWork[];
  /** The shopping questions it's measured on. */
  promptIds: string[];
  onSent?: () => void;
}) {
  const t = useTranslations('shopping.plan');
  const router = useRouter();
  const [rows, setRows] = useState(() => plan.map((work) => ({ ...work, picked: true })));
  const [sending, setSending] = useState(false);
  const picked = rows.filter((row) => row.picked);

  const send = async () => {
    setSending(true);
    const toastId = toast.loading(t('sending'));
    try {
      const result = await sendShoppingActions(
        brandId,
        target,
        picked.map((row) => ({
          type: row.type,
          who: row.who,
          why: t(`lines.${row.line.key}`, row.line.values),
        })),
        promptIds,
      );
      if ('error' in result) {
        toast.error(t('failed'), { id: toastId, description: result.error });
        return;
      }
      const open = {
        label: t('open'),
        onClick: () => router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
      };
      (result.created ? toast.success : toast.info)(
        result.created
          ? t('sent', { number: result.actionNo })
          : t('alreadySent', { number: result.actionNo }),
        { id: toastId, duration: 10_000, action: open },
      );
      onSent?.();
    } catch {
      toast.error(t('failed'), { id: toastId });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {rows.map((row, i) => (
          <li key={`${row.type}:${i}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Checkbox
              checked={row.picked}
              aria-label={t('pick', { type: t(`types.${row.type}`) })}
              onCheckedChange={(checked) =>
                setRows((all) =>
                  all.map((r, j) => (j === i ? { ...r, picked: checked === true } : r)),
                )
              }
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{t(`types.${row.type}`)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {t(`lines.${row.line.key}`, row.line.values)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{t(`where.${row.where}`)}</p>
            </div>
            <div
              role="group"
              aria-label={t('who')}
              className="inline-flex shrink-0 rounded-full border bg-muted/40 p-0.5"
            >
              {(['me', 'agent'] as const).map((who) => (
                <button
                  key={who}
                  type="button"
                  aria-pressed={row.who === who}
                  disabled={who === 'agent' && !row.agentCan}
                  title={who === 'agent' && !row.agentCan ? t('personOnly') : undefined}
                  onClick={() => setRows((all) => all.map((r, j) => (j === i ? { ...r, who } : r)))}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    row.who === who
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground',
                  )}
                >
                  {t(`whos.${who}`)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button className="gap-2" disabled={!picked.length || sending} onClick={() => void send()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t('send', { count: picked.length })}
        </Button>
      </div>
    </div>
  );
}
