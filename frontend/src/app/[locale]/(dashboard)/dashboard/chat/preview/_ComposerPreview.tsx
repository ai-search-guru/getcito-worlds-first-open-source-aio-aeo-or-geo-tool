'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChatComposer } from '@/components/chat/composer/ChatComposer';
import { RoleProvider } from '@/components/context/RoleProvider';
import type { ChatMode } from '@/lib/chat/precedence';
import type { ChatReference } from '@/lib/chat/references';

/** How long the preview's pretend run answers. */
const RUN_MS = 6000;

/** The mockup's chips and starters (CHAT-02 variants table). */
const HOME_CHIPS = [
  { key: 'brand', label: 'GetCito' },
  { key: 'range', label: 'Last 30 days' },
];
const PANEL_CHIPS = [
  { key: 'page', label: 'Visibility' },
  { key: 'brand', label: 'GetCito' },
  { key: 'range', label: 'Last 30 days' },
  { key: 'platform', label: 'All platforms' },
];
/** The mockup's @ menu (#atmenu): the page's chart and metric, then what the brand has. */
const PAGE_REFERENCES: ChatReference[] = [
  { type: 'chart', id: 'visibility-by-platform', label: 'Visibility by platform' },
  { type: 'metric', id: 'share-of-voice', label: 'Share of voice' },
];
const BRAND_REFERENCES: ChatReference[] = [
  { type: 'table', id: 'citations-aio', label: 'Citations · Google AI Overviews' },
  { type: 'page', id: 'https://getcito.com/pricing', label: 'getcito.com/pricing' },
  { type: 'task', id: 'faq-pricing', label: 'Add FAQ block to /pricing' },
];
/** The preview's search: the mockup's rows that match, after a moment. */
const searchReferences = (query: string) =>
  new Promise<ChatReference[]>((resolve) =>
    setTimeout(
      () =>
        resolve(
          BRAND_REFERENCES.filter((r) => r.label.toLowerCase().includes(query.toLowerCase())),
        ),
      300,
    ),
  );

/** The preview's files go nowhere: each is "up" after a moment. */
const previewUploader = {
  upload: (file: File) =>
    new Promise<{ ok: true; id: string }>((resolve) =>
      setTimeout(() => resolve({ ok: true, id: `preview-${file.name}` }), 1200),
    ),
  remove: () => {},
};

const DOCK_CHIPS = [
  { key: 'brand', label: 'GetCito' },
  { key: 'area', label: 'Action Center' },
];

/**
 * The composer (W1-10) for design sign-off: Chat home's, an open chat's dock
 * with a pretend run (Stop and steering), and an Analyst's read-only one.
 * Nothing is sent: a send starts a run of a few seconds here.
 */
export function ComposerPreview() {
  const t = useTranslations('chatComposer.preview');
  const [mode, setMode] = useState<ChatMode>('auto');
  const [homeChips, setHomeChips] = useState(HOME_CHIPS);
  const [panelChips, setPanelChips] = useState(PANEL_CHIPS);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    setRunning(true);
    timer.current = setTimeout(() => setRunning(false), RUN_MS);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    setRunning(false);
    toast(t('stopped'));
  };

  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="mb-4 text-sm font-semibold">
        {t('title')}
        <span className="ml-2 font-normal text-muted-foreground">{t('note')}</span>
      </h2>
      <div className="grid gap-8">
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">{t('home')}</figcaption>
          <div className="mx-auto w-full max-w-[720px]">
            <ChatComposer
              variant="home"
              mode={mode}
              onModeChange={setMode}
              fullAutoOpen
              chips={homeChips}
              onRemoveChip={(key) => setHomeChips((all) => all.filter((c) => c.key !== key))}
              ghost={t('homeGhost')}
              references={PAGE_REFERENCES}
              searchReferences={searchReferences}
              uploader={previewUploader}
              onSend={(text) => {
                toast(t('sent', { text }));
                run();
              }}
            />
          </div>
        </figure>
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">
            {running ? t('dockRunning') : t('dock')}
          </figcaption>
          <div className="mx-auto w-full max-w-[720px]">
            <ChatComposer
              mode={mode}
              onModeChange={setMode}
              fullAutoOpen={false}
              running={running}
              chips={DOCK_CHIPS}
              ghost={t('dockGhost')}
              onSend={() => run()}
              onStop={stop}
              onSteer={(text) => {
                toast(t('steered', { text }));
                run();
              }}
            />
          </div>
        </figure>
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">{t('readOnly')}</figcaption>
          <div className="mx-auto w-full max-w-[400px]">
            <RoleProvider role="analyst">
              <ChatComposer
                variant="panel"
                mode="auto"
                onModeChange={() => {}}
                fullAutoOpen
                chips={panelChips}
                onRemoveChip={(key) => setPanelChips((all) => all.filter((c) => c.key !== key))}
                ghost={t('panelGhost')}
                onSend={() => run()}
              />
            </RoleProvider>
          </div>
        </figure>
      </div>
    </section>
  );
}
