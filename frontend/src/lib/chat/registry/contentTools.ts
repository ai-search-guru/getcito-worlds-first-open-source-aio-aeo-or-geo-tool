import { z } from 'zod';
import { publishDraftToCms, sendDraftToCms } from '@/lib/actions/cmsSend';
import { takeDownDraft } from '@/lib/actions/cmsTakeDown';
import { updateContentDraft } from '@/lib/actions/contentDrafts';
import { actorOf } from '@/lib/chat/actor/access';
import { updateContentDraftFor } from '@/lib/chat/actor/drafts';
import { CHAT_CMS_TARGETS, CMS_NAMES } from '@/lib/content/cmsNames';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool } from './defineTool';
import { draftPage, draftTitle, pageChanges } from './targets';

/**
 * Chat's Content Library rows beyond create_draft (CHAT-20 §9 rows 55, 58):
 * changing a draft (a WRITE), and sending one to the brand's CMS as a draft
 * (an EXECUTE in the publishing group: it leaves GetCito). Each calls a
 * server action over the editor's own path, as the signed-in member; a
 * change also has its write for a run without a session (runFor). Both
 * are Admins' and Managers' (DECISIONS T: an Analyst's Chat only creates
 * drafts; the API sends pages for Admins and Managers). Publishing a new page
 * live in Webflow, WordPress or Wix (publish_cms, row 59, AUTONOMOUS-GO-LIVE
 * PR 9) is an EXECUTE too; Framer publishes whole sites, so it isn't offered.
 * The send and the publish are the rows an agent an Admin allowed may take
 * on its own (AUTONOMOUS-GO-LIVE §4 rows 1 and 2, their goLive): the engine
 * sends them through the API's internal route as the run's person, after
 * its checks. Taking a published page down (unpublish_cms, PR 10) is always
 * the person's click: outside the go-live groups, a Manager may even while
 * publishing is off for Managers, as it only lowers what is live.
 */

const ITEM = FIXTURE_IDS.item;

export const CONTENT_TOOLS = [
  defineTool({
    name: 'update_draft',
    class: 'write',
    area: 'content',
    description:
      'Change a draft in the Content Library (its id from list_content_drafts): its title, its page as HTML, or both. History keeps the page before the change. Only what the person asked to change; send the whole page when changing it.',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C2',
    labelKey: 'reviseDraft',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '55',
    inputSchema: z
      .object({
        draft_id: contentUuid.describe('The draft, from list_content_drafts.'),
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional().describe('Its new title.'),
        body_html: z
          .string()
          .max(MAX_BODY_HTML_LENGTH)
          .optional()
          .describe('The whole page as HTML, changed.'),
      })
      .refine((input) => input.title !== undefined || input.body_html !== undefined, {
        message: 'Change the title, the page, or both.',
      }),
    run: (_ctx, input) =>
      updateContentDraft(input.draft_id, { title: input.title, bodyHtml: input.body_html }),
    sessionFree: true,
    runFor: async (ctx, input) =>
      updateContentDraftFor(actorOf(ctx), input.draft_id, {
        title: input.title,
        bodyHtml: input.body_html,
      }),
    target: async (input) => {
      const now = await draftPage(input.draft_id);
      if (!now) return input.title ? `“${input.title}”` : null;
      const title =
        input.title && input.title !== now.title
          ? `“${now.title}” → “${input.title}”`
          : `“${now.title}”`;
      // What the page's change does, in short: its words and headings.
      return input.body_html !== undefined
        ? `${title} · ${pageChanges(now.bodyHtml, input.body_html)}`
        : title;
    },
    fixture: { input: { draft_id: ITEM, title: 'Pricing FAQ for teams' } },
  }),
  defineTool({
    name: 'push_cms_draft',
    // It leaves GetCito and has no Undo (a CMS item can't be taken back from here; an
    // item updated in Framer or Webflow goes live with the site's next publish): an
    // EXECUTE, so only the person's click sends it, in every mode, Full auto included,
    // and no Admin "Always" lifts it; only an agent an Admin allowed sends it on its own
    // (goLive). In the publishing group: an Admin's "Managers can't go live" for
    // publishing stops a Manager's send too.
    class: 'execute',
    executeGroup: 'publishing',
    area: 'content',
    description:
      "Send a Library draft to the brand's connected CMS as a draft there (Webflow, WordPress, Framer or Wix): nothing goes live. A page that is live already, or a send to the brand's webhook, goes from the Content Editor. Its slug and meta are what it kept from its last send, else the page's. Only when the person asked for this page to go to that CMS.",
    minRole: 'manager',
    // A connection, not a plan: the API says when the brand hasn't one (not_connected).
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'sendToCms',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '58',
    inputSchema: z.object({
      draft_id: contentUuid.describe('The draft, from list_content_drafts.'),
      destination: z.enum(CHAT_CMS_TARGETS).describe('The CMS the brand connected.'),
    }),
    run: (_ctx, input) => sendDraftToCms(input.draft_id, input.destination),
    goLive: (input) => ({ kind: 'cms_draft', draftId: input.draft_id, target: input.destination }),
    target: async (input) => {
      const title = await draftTitle(input.draft_id);
      return [title ? `“${title}”` : null, `→ ${CMS_NAMES[input.destination]}`]
        .filter(Boolean)
        .join(' ');
    },
    fixture: { input: { draft_id: ITEM, destination: 'webflow' } },
  }),
  defineTool({
    name: 'publish_cms',
    // It goes live on the brand's site: an EXECUTE, only the person's click, or an agent an
    // Admin let go live on its own (goLive). New pages only; a live page is the editor's.
    class: 'execute',
    executeGroup: 'publishing',
    area: 'content',
    description:
      "Publish a new Library page live on the brand's site through its connected CMS (Webflow, WordPress or Wix): it goes live at once. The page is written into its CMS draft first, as Send to CMS writes it. Not for a page that is live already (the Content Editor changes it), nor Framer, which publishes the whole site. Only when the person asked for this page to go live.",
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'publishToCms',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '59',
    inputSchema: z.object({
      draft_id: contentUuid.describe('The draft, from list_content_drafts.'),
      destination: z
        .enum(['webflow', 'wordpress', 'wix'])
        .describe('The CMS the brand connected: Webflow, WordPress or Wix.'),
    }),
    run: (_ctx, input) => publishDraftToCms(input.draft_id, input.destination),
    goLive: (input) => ({ kind: 'publish', draftId: input.draft_id, target: input.destination }),
    target: async (input) => {
      const title = await draftTitle(input.draft_id);
      return [title ? `“${title}”` : null, `→ ${CMS_NAMES[input.destination]}`]
        .filter(Boolean)
        .join(' ');
    },
    fixture: { input: { draft_id: ITEM, destination: 'webflow' } },
  }),
  defineTool({
    name: 'unpublish_cms',
    // Takes a page that went live back down to a draft in its CMS (§6.4): an EXECUTE, only
    // ever the person's click, never an agent on its own (no goLive, no group).
    class: 'execute',
    executeGroup: null,
    area: 'content',
    description:
      'Take a page published through GetCito (Webflow, WordPress or Wix) down to a draft in that CMS: it leaves the site at once, and links and AI answers that cited it may still point to it for a while. Only when the person asked for this page to come down.',
    minRole: 'manager',
    planGate: null,
    brandOf: { lookup: 'content_drafts', idField: 'draft_id' },
    costClass: 'C1',
    labelKey: 'takeDownFromCms',
    route: '/dashboard/content/library',
    mcpTool: null,
    specRow: '59',
    inputSchema: z.object({
      draft_id: contentUuid.describe('The published draft, from list_content_drafts.'),
    }),
    run: (_ctx, input) => takeDownDraft(input.draft_id),
    target: async (input) => {
      const title = await draftTitle(input.draft_id);
      return title ? `“${title}”` : null;
    },
    fixture: { input: { draft_id: ITEM } },
  }),
];
