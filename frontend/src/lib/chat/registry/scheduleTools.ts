import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { createChatSchedule } from '@/lib/actions/chatSchedules';
import { percentOf } from '@/lib/chat/agentView';
import { readRunEstimate } from '@/lib/chat/schedule/estimate';
import {
  PROMPT_MAX,
  newSchedule,
  scheduleInputSchema as inputSchema,
} from '@/lib/chat/schedule/input';
import {
  DELIVER_CHOICES,
  checkNewSchedule,
  deliverWords,
  madeStep,
  type DeliverChoice,
  type MadeSchedule,
} from '@/lib/chat/schedule/store';
import {
  WHEN_MAX_LENGTH,
  readWhen,
  whenHint,
  whenPhrase,
  type WhenWords,
} from '@/lib/chat/schedule/when';
import { FIXTURE_IDS, defineTool, type CardFormValues, type ChatToolContext } from './defineTool';

/**
 * Chat's scheduling row (CHAT-20 §9 row 78, CHAT-12; W3-02): a job Chat
 * runs by itself later or on repeat, in a chat of its own, as the person who
 * made it. Never without their click: a card in every mode (always_card,
 * Ask; an Admin may set it to Never, not Always), editable before it is
 * made — the job's title, what Chat does each run, When (read again, with
 * its next run), Deliver to and "Notify only if the answer changed". Admins
 * and Managers (CHAT-20 §4). MCP has no tool for it: Scheduled is a page.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules' });
const whenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

const now = () => new Date();

const makerOf = (ctx: ChatToolContext) => ({
  userId: ctx.userId,
  organizationId: ctx.organizationId ?? '',
  timezone: ctx.timezone ?? 'UTC',
  runId: ctx.chat?.runId ?? null,
});

/** The card's lines under its fields: the model it runs on, and about what a run uses. */
async function cardNotes(organizationId: string, deliver: DeliverChoice): Promise<string[]> {
  const estimate = await readRunEstimate(organizationId);
  const usage =
    estimate.kind === 'share'
      ? t('card.usage', { share: percentOf(estimate.share) })
      : estimate.kind === 'own_key'
        ? t('card.ownKey')
        : estimate.kind === 'unknown'
          ? t('card.usageUnknown')
          : null;
  return [t('card.model'), usage, deliver === 'chat' ? null : t('card.emailTo')].filter(
    (note): note is string => !!note,
  );
}

/** A form value as text, or the input's own when it isn't one. */
const textOf = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

export const SCHEDULE_TOOLS = [
  defineTool({
    name: 'create_schedule',
    class: 'write',
    area: 'scheduling',
    description:
      'Schedule work for Chat to do by itself, in a chat of its own: once at a time, ready by a time (it starts now), or on repeat, at most once a day. Only when the person asked for scheduled or repeated work. The person checks and edits it on a card before it is made; results go to the job’s chat and Inbox, and by email when asked.',
    // A card in every mode; an Admin may turn it off (Never), never on by itself (CHAT-12 item 8).
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'scheduleJob',
    route: null,
    mcpTool: null,
    specRow: '78',
    stepKind: 'schedule',
    inputSchema,
    precheck: async (ctx, input) => {
      const checked = await checkNewSchedule(makerOf(ctx), newSchedule(input), now());
      return checked.ok ? null : checked;
    },
    // Through the person's session, as the app's own changes (lib/actions/chatSchedules.ts).
    run: (ctx, input) =>
      createChatSchedule(newSchedule(input), {
        timezone: ctx.timezone ?? 'UTC',
        runId: ctx.chat?.runId ?? null,
      }),
    target: (input) => input.title,
    form: {
      async fields(input, ctx) {
        const reading = readWhen(input.when, { now: ctx.now, timeZone: ctx.timezone });
        // A phrase that reads is shown as a date or rule, so it reads the same when the card is
        // approved later ("in 3 days" stays the day it was).
        const when = reading.ok ? whenPhrase(reading.when, ctx.timezone) : input.when;
        const hint = whenHint(when, ctx.timezone, ctx.now, whenT);
        const recurring = reading.ok && reading.when.kind === 'recurring';
        return {
          kind: 'schedule',
          zone: ctx.timezone,
          submit: t('card.submit'),
          fields: [
            {
              name: 'title',
              kind: 'text',
              label: t('card.title'),
              value: input.title,
              maxLength: 120,
              required: true,
            },
            {
              name: 'prompt',
              kind: 'textarea',
              label: t('card.prompt'),
              value: input.prompt ?? '',
              maxLength: PROMPT_MAX,
              required: !input.skill,
              ...(input.skill ? { hint: `/${input.skill}` } : {}),
            },
            {
              name: 'when',
              kind: 'text',
              label: t('card.when'),
              value: when,
              maxLength: WHEN_MAX_LENGTH,
              required: true,
              hint: hint.hint,
            },
            {
              name: 'deliver',
              kind: 'choice',
              label: t('card.deliver'),
              value: input.deliver_to,
              options: DELIVER_CHOICES.map((choice) => ({
                value: choice,
                label: deliverWords(choice),
              })),
            },
            {
              name: 'changeOnly',
              kind: 'toggle',
              label: t('card.changeOnly'),
              value: recurring && input.change_only,
              hint: t('card.changeOnlyHint'),
            },
          ],
          notes: await cardNotes(ctx.organizationId, input.deliver_to),
        };
      },
      apply(input, values: CardFormValues, ctx) {
        const when = textOf(values.when, input.when).trim();
        const reading = readWhen(when, { now: ctx.now, timeZone: ctx.timezone });
        if (!reading.ok)
          return { ok: false, error: whenHint(when, ctx.timezone, ctx.now, whenT).hint };
        const deliver = textOf(values.deliver, input.deliver_to);
        const prompt = textOf(values.prompt, input.prompt ?? '').trim();
        return {
          ok: true,
          input: {
            ...input,
            title: textOf(values.title, input.title),
            when,
            prompt: prompt || undefined,
            deliver_to: deliver,
            // "Notify only if the answer changed" is for recurring jobs only.
            change_only:
              reading.when.kind === 'recurring' &&
              (typeof values.changeOnly === 'boolean' ? values.changeOnly : input.change_only),
          },
        };
      },
    },
    doneStep: (_input, output) =>
      output && typeof output === 'object' && (output as { ok?: unknown }).ok === true
        ? madeStep(output as MadeSchedule)
        : null,
    fixture: {
      input: {
        brand_id: FIXTURE_IDS.brand,
        title: 'Weekly visibility report',
        when: 'every Monday at 9:00',
        skill: 'report',
      },
    },
  }),
];
