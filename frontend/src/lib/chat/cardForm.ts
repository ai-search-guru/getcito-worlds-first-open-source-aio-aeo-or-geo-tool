import { z } from 'zod';
import type { ChatConfirmForm } from './events';
import { maskIds } from './events';
import type { CardFormContext, CardFormValues, ChatTool } from './registry/defineTool';

/**
 * An editable approval card (ChatConfirm.form; W3-02): the form a row's card
 * shows, and the change its edited values make. First for a schedule
 * (CHAT-12 item 7); a skill's draft (W3-08) and a memory (W3-12a) use the
 * same card. The engine only connects these: the row says its fields and
 * how its values apply, and what they make is checked against the row's
 * input schema again, so an edit can never make a call the row wouldn't.
 */

/** Most fields a form has, and the longest text a value carries. */
const MAX_FIELDS = 12;
const MAX_VALUE = 20_000;

/** The values the browser sends with an Approve: field names to text or a tick. */
export const cardFormValuesInput = z
  .record(
    z.string().regex(/^[a-z][A-Za-z]{0,39}$/),
    z.union([z.string().max(MAX_VALUE), z.boolean()]),
  )
  .refine((values) => Object.keys(values).length <= MAX_FIELDS, 'Too many fields');

/** A card's text on one line where it is a name, ids shown as "…", at most `max` characters. */
const clip = (text: string, max: number) => {
  const masked = maskIds(text);
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
};

/**
 * The form a row's card shows for this input (`{ form }`), or nothing: a row
 * with no form, or one whose fields can't be read now (the card shows as a
 * plain approval, its change as the model asked for it).
 */
export async function cardFormOf(
  tool: Pick<ChatTool, 'form'>,
  input: Record<string, unknown>,
  ctx: CardFormContext,
): Promise<{ form?: ChatConfirmForm }> {
  if (!tool.form) return {};
  try {
    const form = await tool.form.fields(input as never, ctx);
    const fields = form.fields.slice(0, MAX_FIELDS).map((field) => ({
      ...field,
      label: clip(field.label, 120),
      value:
        typeof field.value === 'string'
          ? field.value.slice(0, field.maxLength ?? MAX_VALUE)
          : field.value,
      ...(field.hint ? { hint: clip(field.hint, 300) } : {}),
    }));
    return {
      form: {
        ...form,
        fields,
        submit: clip(form.submit, 60),
        ...(form.notes ? { notes: form.notes.slice(0, 4).map((note) => clip(note, 200)) } : {}),
      },
    };
  } catch (err) {
    console.error('[chat/engine] could not read a card’s form:', err);
    return {};
  }
}

/**
 * The input the card's edited values make (the row's `apply`), read by the
 * row's input schema: what the change runs with. Refused, with the reason
 * the card shows, when a value doesn't apply or the input it makes isn't one
 * the row takes.
 */
export function editedInput(
  tool: Pick<ChatTool, 'form' | 'inputSchema'>,
  input: Record<string, unknown>,
  values: CardFormValues,
  ctx: CardFormContext,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string | null } {
  if (!tool.form) return { ok: false, error: null };
  let applied;
  try {
    applied = tool.form.apply(input as never, values, ctx);
  } catch (err) {
    console.error('[chat/engine] could not apply a card’s edits:', err);
    return { ok: false, error: null };
  }
  if (!applied.ok) return { ok: false, error: applied.error };
  const parsed = tool.inputSchema.safeParse(applied.input);
  return parsed.success
    ? { ok: true, input: parsed.data as Record<string, unknown> }
    : { ok: false, error: null };
}
