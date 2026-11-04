import { z } from 'zod';
import { saveChatSkill } from '@/lib/actions/chatSkills';
import { MAX_BYTES, MAX_DESCRIPTION, MAX_NAME, SKILL_NAME } from '../skills/format';
import { MAX_TITLE } from '../skills/store';
import { defineTool } from './defineTool';

/**
 * Chat's skill WRITE row (CHAT-20 §9 row 75, CHAT-13 item 12): saving a
 * skill of the person's own, through the server action that checks it
 * (lib/actions/chatSkills.ts, skills/store.ts). Admins and Managers; the
 * plan's My skills limit is checked when it saves ("Limits open"). Its card
 * shows the instructions in full, so what is kept is what the person read.
 * Sharing it and adding an imported skill are an Admin's, on the Skills
 * page (W3-07, W3-09), not Chat's.
 */

export const SKILL_TOOLS = [
  defineTool({
    name: 'save_skill',
    class: 'write',
    area: 'skills',
    description:
      "Save how-to instructions the person asked to keep as a skill of their own: a /name, what it does and when to use it, and its steps. It stays private to them until an Admin shares it, and it only shapes how Chat works: it adds no tool and skips no card. Only when the person asks to save a skill; leave out numbers, customer data and this chat's facts.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    // The workspace's, not a brand's.
    brandOf: null,
    costClass: 'C0',
    labelKey: 'newSkill',
    route: null,
    mcpTool: null,
    specRow: '75',
    inputSchema: z.object({
      name: z
        .string()
        .max(MAX_NAME)
        .regex(SKILL_NAME)
        .describe(
          'Its /command without the slash: lowercase letters, digits and single hyphens ("pricing-faq").',
        ),
      title: z
        .string()
        .trim()
        .min(1)
        .max(MAX_TITLE)
        .optional()
        .describe('A short display title ("Pricing FAQ"); the name with spaces when left out.'),
      description: z
        .string()
        .trim()
        .min(1)
        .max(MAX_DESCRIPTION)
        .describe('What it does and when to use it, in one or two sentences.'),
      instructions: z
        .string()
        .trim()
        .min(1)
        .max(MAX_BYTES)
        .describe('Its steps in Markdown: what to read, what to do, what the result looks like.'),
    }),
    run: (_ctx, input) => saveChatSkill(input),
    target: (input) => `/${input.name}`,
    cardDetails: (input) => ({
      items: [
        {
          title: input.title ?? input.name.replace(/-/g, ' '),
          detail: input.description,
          body: input.instructions,
        },
      ],
    }),
    fixture: {
      input: {
        name: 'pricing-faq',
        description: 'Writes a pricing FAQ in our tone. Use it for pricing pages.',
        instructions: 'Read the pricing page first. Answer each question in two sentences.',
      },
    },
  }),
];
