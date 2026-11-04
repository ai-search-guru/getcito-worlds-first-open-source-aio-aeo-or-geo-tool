import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import type { ChatConfirmForm } from '../events';
import type { CardFormContext, CardFormValues } from '../registry/defineTool';
import {
  MAX_MEMORY_LINE,
  MEMORY_SCOPES,
  memoryRight,
  memoryTextProblem,
  normalizeMemoryText,
  type MemoryScope,
} from './rules';
import { brandNameOf, readMemoryViewer, scopeWords, visibleMemoryLine } from './store';

/**
 * The Remember and Forget cards (CHAT-14 items 7–8, 11; W3-12a), on the
 * editable approval card (ChatConfirm.form, W3-02):
 *
 *   - Remember: the line, editable, with its counter; where it goes (Me,
 *     the chat's brand, Workspace), the scopes the person's role doesn't
 *     change shown but off, and a Manager told a Workspace line goes to the
 *     Admins; and "Replaces: {old}" when it repeats or contradicts a line of
 *     that scope, which they may untick to keep both. Save, or Cancel.
 *   - Its step once made: "Saved to memory" with the scope under it, or
 *     "Sent to your Admins" for a Manager's Workspace line.
 *   - Forget: the plain approval card ("Remove from memory · “…” · Me"),
 *     then "Removed from memory".
 *
 * What the card sends back is checked by the save itself (memory/store.ts)
 * and against the row's schema (cardForm.ts). Server only.
 */

const cardT = createTranslator({ locale: 'en', messages, namespace: 'chatMemory.card' });
const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });
const memoryT = createTranslator({ locale: 'en', messages, namespace: 'chatMemory' });

/** save_memory's input, as its card reads and makes it. */
export interface SaveMemoryCardInput {
  scope: MemoryScope;
  text: string;
  brand_id?: string;
  replaces?: string;
}

/**
 * The Remember card's form for this input (item 7): the line, its scope
 * (off where the person's role doesn't change it, and Brand off without a
 * brand in the chat), and the line it replaces, when there is one.
 */
export async function memoryCardForm(
  input: SaveMemoryCardInput,
  ctx: CardFormContext,
): Promise<ChatConfirmForm> {
  const [viewer, brandName] = await Promise.all([
    readMemoryViewer({ userId: ctx.userId, organizationId: ctx.organizationId }),
    input.brand_id ? brandNameOf(ctx.organizationId, input.brand_id) : Promise.resolve(null),
  ]);
  // Only a line the person sees: never another person's Me line.
  const replaced =
    viewer && input.replaces ? await visibleMemoryLine(viewer, input.replaces) : null;
  const role = viewer?.role ?? 'analyst';
  const may = (scope: MemoryScope) => memoryRight(role, scope) !== null;
  return {
    kind: 'memory',
    fields: [
      {
        name: 'text',
        kind: 'textarea',
        label: cardT('text'),
        value: input.text,
        maxLength: MAX_MEMORY_LINE,
        required: true,
      },
      {
        name: 'scope',
        kind: 'choice',
        label: cardT('scope'),
        value: input.scope,
        options: MEMORY_SCOPES.map((scope) => ({
          value: scope,
          label: scopeWords(scope, scope === 'brand' ? brandName : null),
          ...(!may(scope) || (scope === 'brand' && !brandName) ? { disabled: true } : {}),
        })),
        // A Manager's Workspace line is a request (item 25): said before they pick it.
        ...(memoryRight(role, 'workspace') === 'request' ? { hint: cardT('managerHint') } : {}),
      },
      // A line of the scope it was read in: the browser hides it once another scope is picked.
      ...(replaced && replaced.scope === input.scope
        ? [
            {
              name: 'replace',
              kind: 'toggle' as const,
              label: cardT('replaces', { text: replaced.text }),
              value: true,
              hint: cardT('replaceHint'),
            },
          ]
        : []),
    ],
    submit: cardT('save'),
  };
}

/**
 * The input the Remember card's edits make (item 7): the edited line and
 * scope, and what it replaces only while the scope is still the replaced
 * line's and "Replaces" is ticked. A line memory can't keep is refused here,
 * in its words, so the card stays open; the save checks everything again.
 */
export function applyMemoryCard(
  input: SaveMemoryCardInput,
  values: CardFormValues,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const text = normalizeMemoryText(typeof values.text === 'string' ? values.text : input.text);
  const scope = MEMORY_SCOPES.find((s) => s === values.scope) ?? input.scope;
  const problem = memoryTextProblem(text);
  if (problem) {
    return {
      ok: false,
      error: memoryT(
        `refusal.${
          problem === 'empty'
            ? 'invalid'
            : problem === 'too_long'
              ? 'too_long'
              : problem === 'rules'
                ? 'rules'
                : 'blocked'
        }`,
        { line: MAX_MEMORY_LINE },
      ),
    };
  }
  if (scope === 'brand' && !input.brand_id)
    return { ok: false, error: memoryT('refusal.no_brand') };
  const keeps = !!input.replaces && scope === input.scope && values.replace !== false;
  return {
    ok: true,
    input: {
      scope,
      text,
      ...(input.brand_id ? { brand_id: input.brand_id } : {}),
      ...(keeps ? { replaces: input.replaces } : {}),
    },
  };
}

/** What a save made, as its answer reads (memory/store.ts SavedMemory). */
type SaveOutput = {
  saved?: boolean;
  requested?: boolean;
  scope?: string;
  brandName?: string | null;
} | null;

/**
 * The Remember card's step once made (item 8): "Saved to memory" with the
 * scope under it, or "Sent to your Admins" for a Manager's Workspace line.
 * Null for a refusal: the step says it in the refusal's words.
 */
export function memoryDoneStep(output: unknown): { label: string; detail?: string } | null {
  const made = output as SaveOutput;
  if (made?.requested) {
    return { label: cardT('sent'), detail: scopeWords('workspace') };
  }
  if (!made?.saved) return null;
  const scope = MEMORY_SCOPES.find((s) => s === made.scope) ?? 'user';
  return {
    label: toolT('memorySave.step'),
    detail: scopeWords(scope, made.brandName ?? null),
  };
}

/** The Forget card's step once made (item 11): "Removed from memory" with the line and its scope. */
export function forgetDoneStep(output: unknown): { label: string; detail?: string } | null {
  const removed = output as { text?: unknown; scope?: unknown } | null;
  if (typeof removed?.text !== 'string') return null;
  const scope = MEMORY_SCOPES.find((s) => s === removed.scope) ?? 'user';
  return {
    label: toolT('memoryForget.step'),
    detail: `“${removed.text}” · ${scopeWords(scope)}`,
  };
}
