import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { ASK_TOOL, recommendedLabel, type AskAnswer, type AskToolInput } from '../asks';
import { insertStep, type StepRow } from '../engineStore';

/**
 * A scheduled job's run, nobody watching it (CHAT-12 item 12): a question
 * the model asks takes the Recommended option by itself, and the answer
 * lists what was assumed at its top. The run's other parts are the Chat
 * engine's as in any chat; its changes still wait as cards (a run no
 * session is behind, engine.ts askWithoutSession). The engine calls these
 * for a chat that is a job's (chat_conversations.schedule_id). Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.run' });

/** An option of a question, as the engine kept it. */
interface AskOption {
  label: string;
  detail?: string;
  recommended: boolean;
}

/**
 * The question answered with its Recommended option, kept as a person's
 * skipped one is (its step done, "Nobody was watching · used {option}";
 * chat_asks answered, via the card), and what the model reads: the option
 * to go on with and that the answer lists it as assumed. Answers the step,
 * for its event, and the option taken.
 */
export async function answerUnattended(
  runId: string,
  call: { toolCallId: string },
  input: AskToolInput,
  options: readonly AskOption[],
  position: number,
  stepPosition: number,
): Promise<{ step: StepRow; assumed: string; value: Json }> {
  const assumed = recommendedLabel({ options: [...options] });
  const picked = options.findIndex((option) => option.label === assumed);
  const step = await insertStep(runId, {
    position: stepPosition,
    kind: 'ask',
    status: 'done',
    label: input.question,
    detail: t('assumed', { option: assumed }),
    tool: ASK_TOOL,
    debug: { toolCallId: call.toolCallId, unattended: true },
  });
  const answer: AskAnswer = {
    selected: picked >= 0 ? [picked] : [],
    other: null,
    skipped: false,
    via: 'card',
  };
  const { error } = await supabaseAdmin.from('chat_asks').insert({
    run_id: runId,
    step_id: step.id,
    position,
    question: input.question,
    options_json: options as unknown as Json,
    allow_other: input.allow_other ?? false,
    multi: input.multi ?? false,
    answer_json: answer as unknown as Json,
    answered_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Chat could not keep a question: ${error.message}`);
  return {
    step,
    assumed,
    value: {
      from: 'nobody',
      unattended: true,
      use: assumed,
      note: 'Nobody is watching this scheduled run, so the recommended option was taken. Go on with it, and list it among your assumptions at the top of your answer, in the answer’s language.',
    },
  };
}

/** Whether an answer names an assumption already: its label, case and spacing aside. */
const folded = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The answer with what the run assumed at its top (CHAT-12 item 12): the
 * model lists them as told; any it left out are put first here, one line,
 * so a reader never misses a choice made for them. No assumptions: the
 * answer as it is.
 */
export function withAssumptions(text: string, assumptions: readonly string[] | undefined): string {
  const said = folded(text);
  const missing = [...new Set(assumptions ?? [])].filter(
    (label) => label && !said.includes(folded(label)),
  );
  if (missing.length === 0) return text;
  const line = t('assumptions', { list: missing.join('; ') });
  return text ? `${line}\n\n${text}` : line;
}
