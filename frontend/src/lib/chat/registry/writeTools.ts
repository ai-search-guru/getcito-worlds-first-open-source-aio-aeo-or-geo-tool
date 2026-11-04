import { z } from 'zod';
import { updateOpportunityStatus } from '@/lib/actions/content';
import { createContentDraft } from '@/lib/actions/contentDrafts';
import { actorOf } from '@/lib/chat/actor/access';
import { actingOpen } from '@/lib/chat/actor/api';
import { dismissSuggestionFor, updateOpportunityStatusFor } from '@/lib/chat/actor/apiWrites';
import { createContentDraftFor } from '@/lib/chat/actor/drafts';
import { dismissSuggestion } from '@/lib/actions/promptSuggestions';
import { requestAccess } from '@/lib/actions/chatAccessRequests';
import { ACCESS_REQUEST_RULES } from '@/lib/chat/accessRequests';
import { escapeHtml } from '@/lib/content/attachments';
import { sanitizeDraftHtml } from '@/lib/content/sanitizeDraftHtml';
import { PAGE_TYPES, type DraftMethod, type DraftStart, type PageType } from '@/lib/content/drafts';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { contentUuid, isHttpUrl } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool, type ChatToolContext } from './defineTool';

/**
 * Chat's first WRITE rows (CHAT-20 §9), enough to try the approval flow.
 * Each one calls the server action the app's own button calls, so a change
 * made through Chat is the change the page makes: as the signed-in member,
 * through their session, with the read-only workspace check those actions
 * already run. They need that session: a run with no request behind it
 * (a schedule, CHAT-12) can't call them as they are. A sessionFree row has
 * runFor too, the same change for that run, as its person (lib/chat/actor):
 * a draft with the service role, an opportunity's status or a dismissed
 * suggestion through the API server as them, while that way is open.
 *
 * minRole follows the role model of 2026-10-29: daily work (drafts, tasks,
 * audits, reports) is open to every role; settings, deleting, adding prompts
 * and costly work stay with Admins and Managers. Where the server leaves a
 * role out of daily work, excludeRoles says so.
 */

const BRAND = FIXTURE_IDS.brand;
const ITEM = FIXTURE_IDS.item;

/**
 * A create_draft call's start, as New content gives one, made in the run's
 * chat (00463, W4-10): an agent's run's drafts are the agent's. A write in
 * the person's own session may only say chat (00463's guard), so `agent`
 * only on the run's own write (runFor).
 */
function draftStart(
  input: {
    method: DraftMethod;
    title: string;
    page_type: PageType;
    source: DraftStart['source'];
    body_html?: string;
    source_url?: string;
  },
  chat: ChatToolContext['chat'],
  { asRun }: { asRun: boolean },
): DraftStart {
  return {
    method: input.method,
    title: input.title,
    pageType: input.page_type,
    // The model's pick is a guess, as Start's is: the type follows the page (CE-023).
    typePicked: false,
    source: input.source,
    bodyHtml: input.body_html,
    sourceUrl: input.source_url,
    origin: asRun && chat?.agentRunId ? 'agent' : 'chat',
    conversationId: chat?.conversationId ?? null,
  };
}

export const WRITE_TOOLS = [
  defineTool({
    name: 'create_draft',
    class: 'write',
    area: 'content',
    description:
      "Save a page as a new draft in the brand's Content Library, as New content does: its title, page type, what it starts from (an opportunity, a tracked prompt, a topic, or content to optimize) and, when there is one, its HTML.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // A draft is daily work; every member may already save one (content_drafts: member insert).
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C2',
    labelKey: 'saveDraft',
    route: '/dashboard/content/library',
    mcpTool: 'create_content_draft',
    specRow: '54',
    inputSchema: z.object({
      brand_id: contentUuid.describe('Brand id, from list_brands.'),
      title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).describe('The page title, its H1.'),
      page_type: z.enum(PAGE_TYPES),
      method: z
        .enum(['create', 'optimize'])
        .default('create')
        .describe('create: a new page; optimize: a new version of the page at source_url.'),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.enum(['opportunity', 'prompt', 'topic']), id: contentUuid }),
        z.object({ kind: z.literal('content') }),
      ]),
      body_html: z.string().max(MAX_BODY_HTML_LENGTH).optional().describe('The page as HTML.'),
      source_url: z
        .string()
        .trim()
        .max(2048)
        .refine(isHttpUrl, 'source_url must be an http(s) address')
        .optional()
        .describe('For optimize: the live page.'),
    }),
    run: (ctx, input) =>
      createContentDraft(input.brand_id, draftStart(input, ctx.chat, { asRun: false })),
    sessionFree: true,
    runFor: async (ctx, input) =>
      createContentDraftFor(
        actorOf(ctx),
        input.brand_id,
        draftStart(input, ctx.chat, { asRun: true }),
      ),
    // The page it saved (CHAT-06 item 6): a document, open in the Content Editor. Filed as the
    // draft keeps it: cleaned, so no script or handler a page it read slipped in goes out.
    deliverable: (input, output) =>
      typeof output === 'string' && output
        ? {
            title: input.title,
            type: 'document',
            formats: ['html', 'md', 'docx', 'pdf'],
            body: input.body_html
              ? sanitizeDraftHtml(input.body_html)
              : `<h1>${escapeHtml(input.title)}</h1>`,
            mimeType: 'text/html',
            fileName: 'page.html',
            href: `/dashboard/content/editor/${output}`,
            contentDraftId: output,
          }
        : null,
    fixture: {
      input: {
        brand_id: BRAND,
        title: 'Pricing FAQ',
        page_type: 'docs_faq',
        source: { kind: 'opportunity', id: ITEM },
      },
    },
  }),
  defineTool({
    name: 'update_opportunity',
    class: 'write',
    area: 'content',
    description:
      'Mark a content opportunity reviewed, or dismiss it, optionally saying why (not relevant, or the wrong angle).',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Dismissing is Admin and Manager work, as the server's content routes and RLS have it.
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_opportunities', idField: 'opportunity_id' },
    costClass: 'C0',
    labelKey: 'opportunityStatus',
    route: '/dashboard/content',
    mcpTool: 'update_opportunity_status',
    specRow: '49',
    inputSchema: z.object({
      opportunity_id: contentUuid.describe('Opportunity id, from list_content_opportunities.'),
      status: z.enum(['reviewed', 'dismissed']),
      reason: z
        .enum(['not_relevant', 'wrong_angle'])
        .optional()
        .describe('Why it is dismissed; only with dismissed.'),
    }),
    run: (_ctx, input) =>
      updateOpportunityStatus(
        input.opportunity_id,
        input.status,
        input.status === 'dismissed' ? input.reason : undefined,
      ),
    sessionFree: true,
    runFor: (ctx, input) =>
      updateOpportunityStatusFor(
        actorOf(ctx),
        input.opportunity_id,
        input.status,
        input.status === 'dismissed' ? input.reason : undefined,
      ),
    runForOpen: actingOpen,
    fixture: { input: { opportunity_id: ITEM, status: 'dismissed', reason: 'not_relevant' } },
  }),
  defineTool({
    name: 'dismiss_prompt_suggestion',
    class: 'write',
    area: 'prompts',
    description:
      'Dismiss a pending prompt suggestion so it leaves the suggestion list. Only when the user asked for that suggestion to go.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    // Admins, Managers and Analysts, as the server (#1763), MCP (#1762) and RLS allow.
    minRole: 'analyst',
    excludeRoles: ['agency_partner'],
    planGate: null,
    brandOf: { lookup: 'prompt_suggestions', idField: 'suggestion_id' },
    costClass: 'C0',
    labelKey: 'dismissSuggestion',
    route: '/dashboard/prompts/suggestions',
    mcpTool: 'dismiss_prompt_suggestion',
    specRow: '23',
    inputSchema: z.object({
      suggestion_id: contentUuid.describe('Suggestion id, from list_prompt_suggestions.'),
    }),
    run: (_ctx, input) => dismissSuggestion(input.suggestion_id),
    sessionFree: true,
    runFor: (ctx, input) => dismissSuggestionFor(actorOf(ctx), input.suggestion_id),
    runForOpen: actingOpen,
    fixture: { input: { suggestion_id: ITEM } },
  }),
  defineTool({
    name: 'request_access',
    class: 'write',
    area: 'account',
    description:
      "Ask the workspace's Admins for a change the person's role, the plan or the tool policy keeps Chat from making: what was asked, and the rule that refused it, as the out-of-permission answer gave them. Only when the person clicks Ask your Admin on that answer.",
    // Only the person's click sends it, in every mode (CHAT-20 row 80a: "Ask (fixed)").
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    // Every role in the row, as defineTool never leaves an Admin out; the engine doesn't offer it
    // to Admins, who have no one to ask (NOT_FOR_ADMINS), and the server turns an Admin's away.
    minRole: 'analyst',
    planGate: null,
    // About the person and the workspace: the chat it came from is the run's own.
    brandOf: null,
    costClass: 'C0',
    labelKey: 'askAdmin',
    route: '/dashboard/settings/roles-access',
    mcpTool: null,
    specRow: '80a',
    inputSchema: z.object({
      asked: z.string().trim().min(1).max(500).describe("What was asked, in the answer's words."),
      rule_kind: z.enum(ACCESS_REQUEST_RULES).describe('The rule that refused it.'),
      rule_detail: z.string().trim().max(500).optional().describe("The rule's words."),
      tool_key: z
        .string()
        .regex(/^[a-z][A-Za-z0-9]{1,63}$/)
        .optional()
        .describe("The refused tool's label key, when one was."),
    }),
    run: (_ctx, input) =>
      requestAccess({
        asked: input.asked,
        ruleKind: input.rule_kind,
        ruleDetail: input.rule_detail,
        toolKey: input.tool_key,
      }),
    fixture: { input: { asked: 'Add competitors · Peec AI', rule_kind: 'role' } },
  }),
];
