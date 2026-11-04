'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { assignAction } from '@/lib/actions/actionCenter';
import { sendContentDraftToActionCenter } from '@/lib/actions/contentDrafts';
import type { TeamMember } from '@/lib/actions/team';
import { memberLabel } from '@/lib/action-center/display';
import type { PlanRow } from '@/lib/content/plan';

/**
 * Assign a Plan row that has a draft (CE-014): its Action Center task goes
 * to a teammate. A draft not sent yet is sent first, as Start's Team does.
 * A row with no draft starts in Start instead, with Team and its assignee.
 */
export function AssignDialog({
  brandId,
  row,
  members,
  onClose,
  onAssigned,
}: {
  brandId: string;
  /** The row to assign; the dialog is closed while it is null. */
  row: PlanRow | null;
  members: TeamMember[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const t = useTranslations('contentEditor.plan.assign');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = row?.draft ?? null;

  const assign = async () => {
    if (!draft || !memberId) return;
    setSaving(true);
    try {
      let actionId = draft.actionId;
      if (!actionId) {
        const sent = await sendContentDraftToActionCenter(brandId, draft.id);
        if ('error' in sent) throw new Error(sent.error);
        actionId = sent.actionId;
      }
      await assignAction(brandId, actionId, memberId);
      const member = members.find((m) => m.userId === memberId);
      toast.success(t('done', { name: member ? memberLabel(member) : '' }));
      setMemberId(null);
      onAssigned();
    } catch (err) {
      console.error('Failed to assign the Plan row:', err);
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) {
          setMemberId(null);
          onClose();
        }
      }}
    >
      {/* One column no wider than the dialog: a long title wraps, clear of the close button. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">
            {t('title', { title: row?.title ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="plan-assign-member">{t('member')}</Label>
          <Select
            value={memberId}
            onValueChange={(value) => setMemberId(value as string | null)}
            items={members.map((member) => ({ value: member.userId, label: memberLabel(member) }))}
          >
            <SelectTrigger id="plan-assign-member" className="w-full">
              <SelectValue placeholder={t('pick')} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {memberLabel(member)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void assign()} disabled={!memberId || saving}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
