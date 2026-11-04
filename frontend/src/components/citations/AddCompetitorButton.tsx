'use client';

/**
 * Add-as-competitor confirm dialog (#301), shared by the citations tables and
 * the per-URL citation detail page (#535). Opens pre-filled with a name
 * derived from the domain, then adds it as a tracked competitor.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addCompetitor } from '@/lib/actions/competitor';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';

/** Turn a domain into a first-guess competitor name, e.g. caranddriver.com → "Caranddriver". */
export function deriveCompetitorName(domain: string): string {
  const first = domain
    .replace(/^www\./, '')
    .split('.')[0]
    ?.trim();
  if (!first) return domain;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function AddCompetitorButton({
  brandId,
  domain,
  onAdded,
  appearance = 'icon',
}: {
  brandId: string;
  domain: string;
  onAdded: () => void;
  /** 'icon' — compact "+" for table rows; 'button' — labeled outline button. */
  appearance?: 'icon' | 'button';
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  // A read-only workspace (plan not active): the upgrade dialog instead of this one.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Admins and managers add competitors; others only read them.
  const { canManage } = useUserRole();

  const openDialog = guard(
    () => {
      setName(deriveCompetitorName(domain));
      setOpen(true);
    },
    { action: tActions('addCompetitors') },
  );

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await addCompetitor(brandId, { name: trimmed, domain });
      toast.success(`${domain} added as competitor`);
      setOpen(false);
      onAdded();
    } catch {
      toast.error('Could not add this domain as a competitor. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      {appearance === 'icon' ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={openDialog}
          aria-label={`Add ${domain} as competitor`}
          title="Add as competitor"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={openDialog}>
          <Plus className="h-3.5 w-3.5" />
          Add as competitor
        </Button>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {domain} as competitor?</DialogTitle>
          <DialogDescription>
            Track this domain as a competitor. You can edit the name below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Competitor name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim() || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
