'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useBrandStore } from '@/state/useBrandStore';
import { PlanCard } from '@/components/agentic/PlanCard';
import { RunSteps } from '@/components/agentic/RunSteps';
import { ApprovalCard } from '@/components/agentic/ApprovalCard';
import { QuestionAnswered, QuestionCard } from '@/components/agentic/QuestionCard';
import { AgentHead } from '@/components/agentic/AgentCard';
import { ResultCard } from '@/components/agentic/ResultCard';
import { DenialCard } from '@/components/agentic/DenialCard';
import { ErrorCard } from '@/components/agentic/ErrorCard';
import { RunsTray, RunsTrayView } from '@/components/agentic/RunsTray';
import { NextMoves } from '@/components/chat/run/NextMoves';
import {
  APPROVAL,
  APPROVAL_HEAD,
  DENIAL_FOOTNOTE,
  DENIALS,
  FAILED,
  NEXT_MOVES,
  PUBLISH,
  PUSH_APPROVAL,
  QUALITY_PLAN,
  QUESTIONS,
  RESULT,
  RUN_STEPS,
  SHOPPING_PLAN,
  TASKS_PLAN,
  TRAY,
} from './_cardSamples';

const noop = () => {};
/** Ask your Admin in the preview: answers after a moment, as B2's request will. */
const sendLater = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="grid gap-6">{children}</div>
    </section>
  );
}

/** One card in one state, its state's name above it, at the conversation's width. */
function State({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 max-w-[760px]">
      <figcaption className="mb-2 text-xs text-muted-foreground">{caption}</figcaption>
      {children}
    </figure>
  );
}

/**
 * The run cards for design sign-off (Chat P0, D2): each card in each state,
 * with the approved mockups' sample data, and the runs tray, also live.
 */
export function CardsPreview() {
  const t = useTranslations('agentic.preview.cards');
  const s = (key: string) => t(`states.${key}` as never);
  const brandId = useBrandStore((state) => state.activeBrandId);
  const stepOf = (n: number) => ({ n, total: 6 });

  return (
    <div data-slot="cards-preview" className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Group title={t('sections.plan')}>
        <State caption={s('planAuto')}>
          <PlanCard {...TASKS_PLAN} mode="auto" onStart={noop} />
        </State>
        <State caption={s('planFullAuto')}>
          <PlanCard {...SHOPPING_PLAN} mode="full_auto" onStart={noop} onConnect={noop} />
        </State>
        <State caption={s('planReadOnly')}>
          <PlanCard {...QUALITY_PLAN} mode="auto" canStart={false} onAskAdmin={noop} />
        </State>
      </Group>

      <Group title={t('sections.runSteps')}>
        <State caption={s('stepsRunning')}>
          <RunSteps status="running" steps={RUN_STEPS.running} workingMs={41_000} />
        </State>
        <State caption={s('stepsWaiting')}>
          <RunSteps status="waiting" steps={RUN_STEPS.waiting} workingMs={63_000} />
        </State>
        <State caption={s('stepsDone')}>
          <RunSteps status="done" steps={RUN_STEPS.done} workingMs={72_000} sources={4} />
        </State>
        <State caption={s('stepsSingle')}>
          <RunSteps status="done" steps={RUN_STEPS.single} workingMs={4_000} sources={1} />
        </State>
        <State caption={s('stepsStopped')}>
          <RunSteps status="stopped" steps={RUN_STEPS.stopped} workingMs={41_000} />
        </State>
        <State caption={s('stepsError')}>
          <RunSteps status="error" steps={RUN_STEPS.error} workingMs={30_000} />
        </State>
      </Group>

      <Group title={t('sections.approval')}>
        <State caption={s('pendingDontAsk')}>
          <AgentHead state="waiting" {...APPROVAL_HEAD} />
          <ApprovalCard
            {...APPROVAL}
            step={stepOf(4)}
            canDontAskAgain
            onApprove={noop}
            onSkip={noop}
          />
        </State>
        <State caption={s('pendingNoDontAsk')}>
          <ApprovalCard {...PUSH_APPROVAL} step={stepOf(5)} onApprove={noop} onSkip={noop} />
        </State>
        <State caption={s('saving')}>
          <ApprovalCard {...APPROVAL} step={stepOf(4)} canDontAskAgain status="saving" />
        </State>
        <State caption={s('error')}>
          <ApprovalCard
            {...PUSH_APPROVAL}
            step={stepOf(5)}
            status="error"
            error="Webflow didn’t answer. Nothing was changed."
            onApprove={noop}
            onSkip={noop}
          />
        </State>
        <State caption={s('approved')}>
          <ApprovalCard {...APPROVAL} step={stepOf(4)} status="approved" />
        </State>
        <State caption={s('skipped')}>
          <ApprovalCard {...APPROVAL} step={stepOf(4)} status="skipped" />
        </State>
      </Group>

      <Group title={t('sections.question')}>
        <State caption={s('questionPending')}>
          <QuestionCard ask={QUESTIONS.page} onAnswer={noop} />
        </State>
        <State caption={s('questionMulti')}>
          <QuestionCard ask={QUESTIONS.topics} onAnswer={noop} />
        </State>
        <State caption={s('saving')}>
          <QuestionCard ask={QUESTIONS.page} status="saving" onAnswer={noop} />
        </State>
        <State caption={s('questionAnswered')}>
          <QuestionAnswered question={QUESTIONS.page.question} answer="/features" />
        </State>
        <State caption={s('questionSkipped')}>
          <QuestionAnswered
            question={QUESTIONS.topics.question}
            answer="Skipped · used Plans and prices"
          />
        </State>
      </Group>

      <Group title={t('sections.execute')}>
        <State caption={s('executePending')}>
          <ApprovalCard
            kind="execute"
            {...PUBLISH}
            disabledReason={undefined}
            step={stepOf(6)}
            onPreview={noop}
            onApprove={noop}
          />
        </State>
        <State caption={s('executeDisabled')}>
          <ApprovalCard kind="execute" {...PUBLISH} step={stepOf(6)} onPreview={noop} />
        </State>
        <State caption={s('executeSaving')}>
          <ApprovalCard
            kind="execute"
            {...PUBLISH}
            disabledReason={undefined}
            step={stepOf(6)}
            status="saving"
            onPreview={noop}
          />
        </State>
        <State caption={s('executeDone')}>
          <ApprovalCard kind="execute" {...PUBLISH} step={stepOf(6)} status="approved" />
        </State>
      </Group>

      <Group title={t('sections.result')}>
        <State caption={s('nextMoves')}>
          <NextMoves moves={NEXT_MOVES} onPick={noop} />
        </State>
        <State caption={s('resultDone')}>
          <ResultCard
            state="done"
            {...RESULT.done}
            generatedAt={RESULT.generatedAt}
            dataAsOf={RESULT.dataAsOf}
            timeZone={RESULT.timeZone}
            run={{ steps: RUN_STEPS.done, workingMs: 340_000, sources: 4 }}
            kpis={[...RESULT.kpis]}
            files={[...RESULT.files]}
            note={RESULT.note}
            primary={RESULT.primary}
          />
        </State>
        <State caption={s('resultNeedsClick')}>
          <ResultCard
            state="needsClick"
            {...RESULT.needsClick}
            generatedAt={RESULT.generatedAt}
            dataAsOf={RESULT.dataAsOf}
            timeZone={RESULT.timeZone}
            kpis={[...RESULT.kpis]}
            files={[...RESULT.files]}
            note={RESULT.note}
            primary={RESULT.primary}
            before={
              <ApprovalCard
                kind="execute"
                {...PUBLISH}
                disabledReason={undefined}
                step={stepOf(6)}
                onPreview={noop}
                onApprove={noop}
              />
            }
          />
        </State>
      </Group>

      <Group title={t('sections.denial')}>
        <State caption={s('denialRole')}>
          <DenialCard
            {...DENIALS.role}
            askedItems={[...DENIALS.role.askedItems]}
            nextActions={[...DENIALS.role.nextActions]}
            footnote={DENIAL_FOOTNOTE}
            onAskAdmin={sendLater}
          />
        </State>
        <State caption={s('denialPlan')}>
          <DenialCard
            {...DENIALS.plan}
            nextActions={[...DENIALS.plan.nextActions]}
            extra={{ ...DENIALS.plan.extra, items: [...DENIALS.plan.extra.items] }}
            footnote={DENIAL_FOOTNOTE}
          />
        </State>
        <State caption={s('denialPolicy')}>
          <DenialCard
            {...DENIALS.policy}
            nextActions={[...DENIALS.policy.nextActions]}
            footnote={DENIAL_FOOTNOTE}
            onAskAdmin={sendLater}
          />
        </State>
      </Group>

      <Group title={t('sections.failed')}>
        <State caption={s('failedStep')}>
          <ErrorCard
            title={FAILED.title}
            reason={FAILED.reason}
            steps={FAILED.steps}
            failedStep={2}
            onRetry={noop}
            extraAction={
              <Button data-action="integrations.connect" variant="outline" onClick={noop}>
                {FAILED.connect}
              </Button>
            }
          />
        </State>
        <State caption={s('failedRun')}>
          <ErrorCard title={TASKS_PLAN.title} reason={FAILED.runReason} steps={[]} onRetry={noop} />
        </State>
      </Group>

      <Group title={t('sections.tray')}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
          <State caption={s('trayRuns')}>
            <RunsTrayView data={TRAY} />
          </State>
          <State caption={s('trayEmpty')}>
            <RunsTrayView data={{ runs: [], running: 0, needsYou: 0 }} />
          </State>
          <State caption={s('trayLive')}>
            <RunsTray brandId={brandId} />
          </State>
        </div>
      </Group>
    </div>
  );
}
