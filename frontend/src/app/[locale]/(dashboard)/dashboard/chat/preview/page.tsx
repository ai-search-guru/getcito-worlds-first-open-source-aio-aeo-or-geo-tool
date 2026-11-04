import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { isChatStaff } from '@/lib/chat/staff';
import {
  AGENT_AVATAR_STATES,
  AgentAvatar,
  type AgentAvatarSize,
} from '@/components/agentic/AgentAvatar';
import { STATUS_PILL_STATES, StatusPill } from '@/components/agentic/StatusPill';
import { APPROVAL_PILL_KINDS, ApprovalPill } from '@/components/agentic/ApprovalPill';
import { STEP_MARKER_STATES, StepMarker } from '@/components/agentic/StepMarker';
import { LIST_DOT_STATES, ListDot, ListProgress } from '@/components/agentic/ListDot';
import { DotLegend } from '@/components/agentic/DotLegend';
import { NewPill } from '@/components/agentic/NewPill';
import { AttentionCount, AttentionDot } from '@/components/agentic/AttentionBadge';
import { DoneTick } from '@/components/agentic/DoneTick';
import { CardsPreview } from './_CardsPreview';
import { ComposerPreview } from './_ComposerPreview';
import { RunPreview } from './_RunPreview';

const AVATAR_SIZES: readonly AgentAvatarSize[] = ['md', 'sm', 'xs'];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  /** A short muted line beside the title. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="mb-4 text-sm font-semibold">
        {title}
        {note && <span className="ml-2 font-normal text-muted-foreground">{note}</span>}
      </h2>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-5">{children}</div>
    </section>
  );
}

/** One piece in one state, its name under it. */
function Sample({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      <div className="flex min-h-10 items-center justify-center gap-3">{children}</div>
      {caption && (
        <figcaption className="text-xs whitespace-nowrap text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** Every shared agent piece in every state, side by side, in this theme. */
function ChatPiecesPreview() {
  const t = useTranslations('agentic.preview');
  const tStep = useTranslations('agentic.step');
  const tDot = useTranslations('agentic.dot');
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <p className="text-sm text-muted-foreground">{t('motion')}</p>
      </div>

      <Section title={t('sections.avatar')} note={t('avatarSizes')}>
        {AGENT_AVATAR_STATES.map((state) => (
          <Sample key={state} caption={t(`avatarStates.${state}`)}>
            {AVATAR_SIZES.map((size) => (
              <AgentAvatar key={size} state={state} size={size} />
            ))}
          </Sample>
        ))}
      </Section>

      <Section title={t('sections.avatarList')} note={t('avatarListNote')}>
        {AGENT_AVATAR_STATES.map((state) => (
          <Sample key={state} caption={t(`avatarStates.${state}`)}>
            <AgentAvatar state={state} tone="muted" />
          </Sample>
        ))}
      </Section>

      <Section title={t('sections.statusPill')}>
        {STATUS_PILL_STATES.map((state) => (
          <Sample key={state}>
            <StatusPill state={state} />
          </Sample>
        ))}
      </Section>

      <Section title={t('sections.approvalPill')}>
        {APPROVAL_PILL_KINDS.map((kind) => (
          <Sample key={kind}>
            <ApprovalPill kind={kind} className="w-[104px]" />
          </Sample>
        ))}
      </Section>

      <Section title={t('sections.steps')}>
        {STEP_MARKER_STATES.map((state, i) => (
          <Sample key={state} caption={tStep(state)}>
            <StepMarker number={i + 1} state={state} />
          </Sample>
        ))}
      </Section>

      <Section title={t('sections.dots')}>
        {LIST_DOT_STATES.map((state) => (
          <Sample key={state} caption={tDot(state)}>
            <ListDot state={state} />
          </Sample>
        ))}
        <Sample caption={t('progress')}>
          <ListProgress value={30} className="w-28" />
        </Sample>
        <Sample caption={t('legend')}>
          <DotLegend />
        </Sample>
      </Section>

      <Section title={t('sections.newPill')}>
        <Sample>
          <NewPill />
        </Sample>
      </Section>

      <Section title={t('sections.attention')}>
        <Sample caption={t('onIcon')}>
          <span className="relative inline-flex size-8 items-center justify-center rounded-lg bg-sidebar text-sidebar-foreground">
            <Sparkles aria-hidden className="size-[17px]" />
            <AttentionDot needsYou={1} className="absolute top-0.5 right-0.5" />
          </span>
        </Sample>
        <Sample caption={t('countNeedsYou')}>
          <AttentionCount count={3} needsYou={1} />
        </Sample>
        <Sample caption={t('countNone')}>
          <AttentionCount count={3} />
        </Sample>
      </Section>

      <Section title={t('sections.tick')}>
        <Sample caption={t('size', { size: 20 })}>
          <DoneTick />
        </Sample>
        <Sample caption={t('size', { size: 16 })}>
          <DoneTick size="sm" />
        </Sample>
        <Sample caption={t('tickPop')}>
          <DoneTick pop />
        </Sample>
      </Section>

      <ComposerPreview />

      <RunPreview />

      <CardsPreview />
    </div>
  );
}

/**
 * Chat's shared agent pieces and run cards for design sign-off (Chat P0, D1
 * and D2). Only for GetCito staff (STAFF_EMAILS, lib/chat/staff.ts, as
 * Chat's Debug view), with the new Chat on for their workspace
 * (CHAT_AGENTIC); for anyone else, a customer's Admin too, the page isn't
 * there. Not linked from the menu.
 */
export default async function ChatPiecesPreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  if (!isChatStaff(user)) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!chatAgenticEnabled(profile?.organization_id)) notFound();

  return <ChatPiecesPreview />;
}
