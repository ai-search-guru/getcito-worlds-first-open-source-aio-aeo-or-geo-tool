'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { LOGO_ACCEPT } from '@/lib/white-label/kit';

/**
 * A white label logo (00429): the logo as it is now, and for whoever may
 * change it, Upload (or Replace) and Remove. The parent uploads and sets a
 * picked file, and says what happened; on a read-only workspace both
 * buttons open the upgrade dialog instead, labelled with `action`.
 */
export function LogoField({
  label,
  url,
  canEdit,
  action,
  onPick,
  onRemove,
}: {
  label: string;
  /** The logo's address now; null for none. */
  url: string | null;
  canEdit: boolean;
  /** What the read-only dialog says was clicked. */
  action: string;
  onPick: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations('settings.whiteLabel');
  const { guard } = useUpgradeGate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      // The same file can be picked again after a failure.
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        {/* White paper in both themes, as the report it goes on: a dark logo stays visible. */}
        <div
          data-testid="logo-paper"
          className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border bg-white p-2 shadow-sm"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed address
            <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-zinc-500">{t('noLogo')}</span>
          )}
        </div>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept={LOGO_ACCEPT}
              hidden
              aria-label={label}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void run(() => onPick(file));
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={guard(() => input.current?.click(), { action })}
            >
              {busy ? (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload aria-hidden className="h-3.5 w-3.5" />
              )}
              {busy ? t('uploading') : url ? t('replaceLogo') : t('uploadLogo')}
            </Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={guard(() => void run(onRemove), { action })}
              >
                {t('removeLogo')}
              </Button>
            )}
          </>
        )}
      </div>
      {canEdit && <p className="text-xs text-muted-foreground">{t('logoHint')}</p>}
    </div>
  );
}
