'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { requestAccess } from '@/lib/actions/chatAccessRequests';
import {
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_DAY,
  type AccessRequest,
} from '@/lib/chat/accessRequests';

/**
 * Ask your Admin (CHAT-20 §4c): the person says what they need, starting
 * from what was asked, and their click sends it to the workspace's Admins
 * with the rule that stopped it. Admins don't see it: they have no one to
 * ask.
 */
export function AskAdminButton({
  asked,
  ruleKind,
  ruleDetail = '',
  toolKey = null,
  size = 'sm',
  variant = 'outline',
  label,
  title,
  className,
  onSent,
}: {
  asked: string;
  ruleKind: AccessRequest['ruleKind'];
  ruleDetail?: string;
  toolKey?: string | null;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default';
  /** Shorter words for a tight place (the chat menu's Connections list); its title says it all. */
  label?: string;
  title?: string;
  className?: string;
  onSent?: () => void;
}) {
  const t = useTranslations('chatAccess.askAdmin');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(asked);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const result = await requestAccess({ asked: text, ruleKind, ruleDetail, toolKey });
      if (result.ok) {
        toast.success(t('sent'));
        setOpen(false);
        onSent?.();
      } else if (result.reason === 'too_many') {
        toast.error(t('tooMany', { count: MAX_PENDING_REQUESTS }));
      } else if (result.reason === 'daily_limit') {
        toast.error(t('dailyLimit', { count: MAX_REQUESTS_PER_DAY }));
      } else if (result.reason === 'already_today') {
        toast.info(t('alreadyToday'));
        setOpen(false);
      } else {
        toast.error(t('failed'));
      }
    } catch {
      toast.error(t('failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        title={title}
        className={className}
        onClick={() => {
          setText(asked);
          setOpen(true);
        }}
      >
        {label ?? t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('lead')}</DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{t('label')}</span>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          {ruleDetail && <p className="text-xs text-muted-foreground">{ruleDetail}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={() => void send()} disabled={sending || !text.trim()}>
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
