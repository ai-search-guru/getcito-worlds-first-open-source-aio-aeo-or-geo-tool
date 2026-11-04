'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Newspaper, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useUserRole } from '@/hooks/useUserRole';
import {
  connectWordPress,
  disconnectWordPress,
  readWordPress,
  type WordPressConnection,
} from '@/lib/wordpressClient';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * Send to CMS → WordPress (#1331, phase 2; 00294): the active brand's
 * WordPress site. Admins and managers connect it with a user's Application
 * Password, replace the sign-in and disconnect; members see where pages go.
 * Pages go as draft posts, published in WordPress.
 */
export function WordPressCard() {
  const t = useTranslations('settings.wordpress');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  // A read-only workspace's refusal opens the upgrade dialog, not a toast;
  // while it is read-only, Change sign-in opens it at once. Disconnect stays
  // open: it ends an access, it starts nothing.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The connection as read for a brand: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    configured: boolean;
    connection: WordPressConnection | null;
    failed: boolean;
  } | null>(null);
  // Replacing the sign-in, for the brand it was asked for.
  const [replacingFor, setReplacingFor] = useState<string | null>(null);
  const replacing = replacingFor !== null && replacingFor === activeBrandId;
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    readWordPress(activeBrandId).then((result) => {
      if (cancelled) return;
      setRead(
        result.ok
          ? {
              brandId: activeBrandId,
              configured: result.configured,
              connection: result.connection,
              failed: false,
            }
          : { brandId: activeBrandId, configured: true, connection: null, failed: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const current = read?.brandId === activeBrandId ? read : null;
  const connection = current?.connection ?? null;
  const setConnection = (next: WordPressConnection | null) =>
    setRead((r) => (r && r.brandId === activeBrandId ? { ...r, connection: next } : r));
  const site = connection ? (connection.siteName ?? connection.siteUrl) : '';

  const disconnect = async () => {
    if (!activeBrandId) return;
    setDisconnecting(true);
    const result = await disconnectWordPress(activeBrandId);
    setDisconnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else toast.error(t(`errors.${result.code}`));
      return;
    }
    setConnection(null);
    setReplacingFor(null);
    // Not revoked: the password still works until it's deleted in WordPress.
    if (result.revoked) toast.success(t('disconnected'));
    else toast.warning(t('disconnectedNotRevoked'));
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Newspaper className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('title')}</p>
            {connection?.status === 'connected' && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {t('connected')}
              </Badge>
            )}
            {connection?.status === 'auth_failed' && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {t('refused')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brand.name }) : t('noBrand')}
          </p>
          {connection && (
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {t('site', { site: connection.siteUrl })}
              {' · '}
              {t('account', { account: connection.account })}
            </p>
          )}
          {canManage && connection && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!replacing && current?.configured && connection.status === 'connected' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={guard(() => setReplacingFor(activeBrandId), {
                    action: tActions('connectCms'),
                  })}
                >
                  {t('replace')}
                </Button>
              )}
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={disconnecting}
                    />
                  }
                >
                  {disconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unplug className="h-3.5 w-3.5" />
                  )}
                  {t('disconnect')}
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t('disconnectTitle')}</DialogTitle>
                    <DialogDescription>{t('disconnectDescription')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
                    <DialogClose render={<Button variant="destructive" onClick={disconnect} />}>
                      {t('disconnect')}
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </div>

      {!activeBrandId ? null : !current ? (
        <Skeleton className="h-16 w-full" />
      ) : current.failed ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : !current.configured ? (
        <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
      ) : !canManage ? (
        <p className="text-sm text-muted-foreground">
          {!connection
            ? t('notConnectedMember')
            : connection.status === 'auth_failed'
              ? t('refusedMember')
              : t('pagesGoTo', { site })}
        </p>
      ) : !connection || connection.status === 'auth_failed' || replacing ? (
        <div className="space-y-3">
          {connection?.status === 'auth_failed' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('refusedNote')}</span>
            </div>
          )}
          <SignInForm
            brandId={activeBrandId}
            // Connecting again, the site and user as they were.
            initial={connection}
            onCancel={replacing ? () => setReplacingFor(null) : undefined}
            onConnected={(next) => {
              setReplacingFor(null);
              setConnection(next);
            }}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pagesGoTo', { site })}</p>
      )}
    </div>
  );
}

/** The site, its user and an Application Password: the password goes to the API once, never shown again. */
function SignInForm({
  brandId,
  initial,
  onConnected,
  onCancel,
}: {
  brandId: string;
  initial: WordPressConnection | null;
  onConnected: (connection: WordPressConnection) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('settings.wordpress');
  // Read-only (plan not active): Connect opens the upgrade dialog before anything is sent.
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [siteUrl, setSiteUrl] = useState(initial?.siteUrl ?? '');
  const [username, setUsername] = useState(initial?.account ?? '');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const id = (field: string) => `wordpress-${field}-${brandId}`;
  // An Application Password is 24 letters and digits; a user's own password is the usual mix-up.
  const short = password.trim() !== '' && password.replace(/\s+/g, '').length < 16;
  const ready = siteUrl.trim() && username.trim() && password.trim() && !short;

  const connect = async () => {
    setConnecting(true);
    const result = await connectWordPress(brandId, {
      siteUrl: siteUrl.trim(),
      username: username.trim(),
      password: password.trim(),
    });
    setConnecting(false);
    if (!result.ok) {
      if (result.code === 'subscription') openUpgrade();
      else toast.error(t(`errors.${result.code}`));
      return;
    }
    setPassword('');
    toast.success(t('connectedToast'));
    onConnected(result.connection);
  };
  const connectSite = guard(() => void connect(), { action: tActions('connectCms') });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !connecting) connectSite();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={id('site')}>{t('siteLabel')}</Label>
          <Input
            id={id('site')}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder={t('sitePlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('user')}>{t('userLabel')}</Label>
          <Input
            id={id('user')}
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('userPlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('password')}>{t('passwordLabel')}</Label>
          <Input
            id={id('password')}
            aria-describedby={id('hint')}
            aria-invalid={short || undefined}
            type="password"
            // Not a sign-in to GetCito: no saved password is offered here.
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
          />
        </div>
      </div>
      <p id={id('hint')} className="text-xs text-muted-foreground">
        {t('passwordHint')}
      </p>
      {short && <p className="text-xs text-amber-700 dark:text-amber-400">{t('passwordShort')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="h-9 gap-2" disabled={!ready || connecting}>
          {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {connecting ? t('connecting') : t('connect')}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            disabled={connecting}
            onClick={onCancel}
          >
            {t('cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
