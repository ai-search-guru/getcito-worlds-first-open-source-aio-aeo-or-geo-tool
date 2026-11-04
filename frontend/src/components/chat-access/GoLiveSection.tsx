'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { GoLiveView } from '@/lib/actions/chatSettings';
import { cn } from '@/lib/utils';
import { SettingsSwitch as Switch } from './SettingsSwitch';

const POINTS = ['what', 'responsible', 'limits', 'checks', 'told'] as const;

/**
 * Settings › Chat › Agents that publish on their own (AUTONOMOUS-GO-LIVE
 * §7.1, §7.3): the workspace switch, off unless an Admin turns it on.
 * Turning it on asks the Admin to accept the responsibility text first;
 * turning it off needs no dialog. Locked below Growth, and while Content
 * Quality is off. Everyone else reads it. Not shown before 00443.
 */
export function GoLiveSection({
  view,
  isAdmin,
  lockedOn,
  saving,
  onChange,
}: {
  view: GoLiveView;
  isAdmin: boolean;
  /** The plan's name when it lacks Growth (Full auto's plan), else null. */
  lockedOn: string | null;
  saving: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('chatAccess.settings.goLive');
  const tSettings = useTranslations('chatAccess.settings');
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const since = view.since
    ? new Date(view.since).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  const blocked = lockedOn !== null || view.qualityOff;

  return (
    <section className="space-y-2" data-slot="go-live">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('lead')}</p>
      </div>
      <ul className="divide-y rounded-xl border">
        <li className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{t('switch')}</span>
            <span className="block text-xs text-muted-foreground">{t('note')}</span>
            {view.on && since && (
              <span className="mt-1 block text-xs text-foreground">
                {view.byName
                  ? t('onSince', { date: since, name: view.byName })
                  : t('onSinceNoName', { date: since })}
              </span>
            )}
          </span>
          {blocked && !view.on ? (
            <span className="inline-flex max-w-56 items-center gap-1 text-right text-xs text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              {lockedOn !== null ? t('locked', { current: lockedOn }) : t('qualityOff')}
            </span>
          ) : isAdmin ? (
            <Switch
              checked={view.on}
              label={t('switch')}
              disabled={saving}
              onChange={(next) => {
                if (!next) {
                  onChange(false);
                  return;
                }
                setUnderstood(false);
                setAsking(true);
              }}
            />
          ) : (
            <span className="text-xs font-medium">
              {view.on ? tSettings('switches.on') : tSettings('switches.off')}
            </span>
          )}
        </li>
      </ul>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('dialog.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('lead')}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 text-sm">
            {POINTS.map((point, i) => (
              <li key={point} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span>{t(`dialog.points.${point}`)}</span>
              </li>
            ))}
          </ol>
          <label
            className={cn(
              'flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm',
              understood && 'border-primary/40',
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={understood}
              onCheckedChange={(checked) => setUnderstood(checked === true)}
            />
            <span>
              {t('dialog.confirm', { workspace: view.workspace || t('dialog.yourWorkspace') })}
            </span>
          </label>
          <p className="text-xs text-muted-foreground">{t('dialog.recorded')}</p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('dialog.cancel')}</DialogClose>
            <Button
              disabled={!understood || saving}
              onClick={() => {
                setAsking(false);
                onChange(true);
              }}
            >
              {t('dialog.turnOn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
