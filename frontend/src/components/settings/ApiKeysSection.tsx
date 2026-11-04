'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';
import { isCloud } from '@/config/plans';
import { siteConfig } from '@/config/site';
import {
  MCP_CLIENTS,
  MCP_CLIENT_LABELS,
  mcpClientSnippet,
  type McpClient,
} from '@/lib/mcp/clientSetup';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';

function getMcpEndpoint(): string {
  const appUrl = configuredAppUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${appUrl}/api/mcp`;
}

const MCP_GUIDE_URL = `${siteConfig.links.github}/blob/main/docs/guides/mcp-server.mdx`;

const CLIENT_OPTIONS = MCP_CLIENTS.map((value) => ({ value, label: MCP_CLIENT_LABELS[value] }));

export function ApiKeysSection() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const mcpEndpoint = getMcpEndpoint();
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [client, setClient] = useState<McpClient>('claude-code');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/keys');
      const body = (await res.json()) as { keys?: ApiKey[]; error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setKeys(body.keys ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = (await res.json()) as {
        key?: ApiKey & { token: string };
        error?: string;
      };
      if (!res.ok || !body.key) throw new Error(body.error || 'Failed to create');
      setRevealedToken(body.key.token);
      setNewName('');
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Failed to revoke');
      }
      toast.success('Key revoked');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {t('apiKeys')}
            </CardTitle>
            <CardDescription>{t('apiKeys_description')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />
            {t('apiKeys_newKey')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
          <p className="font-medium text-foreground">{t('apiKeys_mcpEndpoint')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono">{mcpEndpoint}</code>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => copy(mcpEndpoint)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-muted-foreground">
            {t.rich('apiKeys_mcpEndpointHint', {
              link: (chunks) => (
                <a href={MCP_GUIDE_URL} target="_blank" rel="noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
          {/* MCP per plan (DECISIONS S): the server refuses the writes, this says so first. */}
          {isCloud() && (
            <p data-slot="mcp-plan-note" className="text-muted-foreground">
              {t('apiKeys_planNote')}
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('apiKeys_noKeys')}</p>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              {keys.map((k) => {
                const revoked = !!k.revoked_at;
                return (
                  <div key={k.id} className="flex items-center justify-between gap-4 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{k.name}</p>
                        {revoked && (
                          <Badge variant="outline" className="text-[10px]">
                            {t('apiKeys_revoked')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{k.prefix}…</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t('apiKeys_created', {
                          date: formatDate(k.created_at),
                          lastUsed: formatDate(k.last_used_at),
                        })}
                      </p>
                    </div>
                    {!revoked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRevoke(k.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <Dialog
              open={confirmRevoke !== null}
              onOpenChange={(v) => !v && setConfirmRevoke(null)}
            >
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t('revokeApiKey')}</DialogTitle>
                  <DialogDescription>{t('revokeApiKeyConfirm')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    {tCommon('cancel')}
                  </DialogClose>
                  <DialogClose
                    render={
                      <Button
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();

                          if (confirmRevoke === null) {
                            return;
                          }
                          void handleRevoke(confirmRevoke);
                        }}
                      />
                    }
                  >
                    {t('revoke')}
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('apiKeys_newKeyTitle')}</DialogTitle>
            <DialogDescription>{t('apiKeys_newKeyDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="apiKeyName">{t('apiKeys_name')}</Label>
            <Input
              id="apiKeyName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('apiKeys_namePlaceholder')}
              autoFocus
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={creating} />}>
              {tCommon('cancel')}
            </DialogClose>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('apiKeys_create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedToken} onOpenChange={(v) => !v && setRevealedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('apiKeys_copyTitle')}</DialogTitle>
            <DialogDescription>{t('apiKeys_copyDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 font-mono text-xs">
              <code className="ph-no-capture flex-1 truncate">{revealedToken}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revealedToken && copy(revealedToken)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {revealedToken && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{t('apiKeys_connectTitle')}</p>
                <Select
                  items={CLIENT_OPTIONS}
                  value={client}
                  onValueChange={(v) => v && setClient(v as McpClient)}
                >
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">{t(`apiKeysConnectWhere.${client}`)}</p>
              <div className="flex items-start gap-2">
                <pre className="ph-no-capture max-h-56 min-w-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre">
                  {mcpClientSnippet(client, mcpEndpoint, revealedToken)}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  onClick={() => copy(mcpClientSnippet(client, mcpEndpoint, revealedToken))}
                  aria-label={t('apiKeys_copySnippet')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.rich('apiKeys_connectHint', {
                  link: (chunks) => (
                    <a href={MCP_GUIDE_URL} target="_blank" rel="noreferrer" className="underline">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>{t('apiKeys_done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
