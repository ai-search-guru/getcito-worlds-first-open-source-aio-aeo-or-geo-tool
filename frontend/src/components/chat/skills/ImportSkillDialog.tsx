'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';

/** The most an upload may be (the API's MAX_UPLOAD): told before it goes. */
const MAX_UPLOAD = 5 * 1024 * 1024;

export type ImportMode = 'upload' | 'github';

/** What the import answered: the skill kept for review. */
export interface ImportedSkillRef {
  id: string;
  name: string;
  requested: boolean;
}

/**
 * Importing a skill (CHAT-13 items 13–16, W3-09; mockup `#s-skills` New
 * skill): a SKILL.md or a .zip of its folder, or a public GitHub link,
 * through POST /api/chat/skills/import. It comes in off and private,
 * waiting for an Admin's review; what the API refuses stays in the dialog,
 * in its words. Rendered only while open.
 */
export function ImportSkillDialog({
  mode,
  onClose,
  onImported,
}: {
  mode: ImportMode;
  onClose: () => void;
  onImported: (skill: ImportedSkillRef) => void;
}) {
  const t = useTranslations('chatSkills.import');
  // The browser's own file field speaks its language: a button and the file's name in ours.
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = mode === 'upload' ? !!file : url.trim().length > 0;

  async function submit() {
    if (!ready || busy) return;
    if (mode === 'upload' && file && file.size > MAX_UPLOAD) {
      setProblem(t('tooLarge'));
      return;
    }
    setBusy(true);
    setProblem(null);
    let init: RequestInit;
    if (mode === 'upload' && file) {
      const form = new FormData();
      form.append('file', file);
      init = { method: 'POST', body: form };
    } else {
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      };
    }
    const res = await fetch('/api/chat/skills/import', init).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      skill?: ImportedSkillRef;
    } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok || !body.skill) {
      setProblem(body?.error ?? t('failed'));
      return;
    }
    toast.success(body.skill.requested ? t('requested') : t('imported'));
    onImported(body.skill);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md" data-slot="import-skill">
        <DialogTitle>{t(mode === 'upload' ? 'uploadTitle' : 'githubTitle')}</DialogTitle>
        <DialogDescription>{t(mode === 'upload' ? 'uploadBody' : 'githubBody')}</DialogDescription>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode === 'upload' ? (
            <>
              <Label htmlFor="skill-file">{t('file')}</Label>
              <input
                id="skill-file"
                ref={picker}
                type="file"
                accept=".md,.zip,text/markdown,application/zip"
                data-action="skills.importFile"
                className="sr-only"
                onChange={(e) => {
                  setProblem(null);
                  setFile(e.target.files?.[0] ?? null);
                }}
              />
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-action="skills.importChoose"
                  onClick={() => picker.current?.click()}
                >
                  {t('choose')}
                </Button>
                <span
                  data-slot="import-file-name"
                  className="truncate text-[13px] text-muted-foreground"
                >
                  {file ? file.name : t('noFile')}
                </span>
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="skill-url">{t('url')}</Label>
              <Input
                id="skill-url"
                type="url"
                inputMode="url"
                value={url}
                placeholder={t('urlPlaceholder')}
                data-action="skills.importUrl"
                onChange={(e) => {
                  setProblem(null);
                  setUrl(e.target.value);
                }}
              />
            </>
          )}
          <p className="text-xs text-muted-foreground">{t('licenses')}</p>
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            data-action="skills.importCancel"
            disabled={busy}
            onClick={onClose}
          >
            {t('cancel')}
          </Button>
          <Button
            data-action="skills.importSubmit"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? <LoadingDots label={t('working')} /> : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
