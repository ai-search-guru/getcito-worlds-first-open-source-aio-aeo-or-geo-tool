// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { TeamRole } from '@/components/context/RoleProvider';
import type { ChatTool } from './defineTool';
import { clientEventProblems, type ChatEvent } from '../events';

/**
 * The registry's rows (CHAT-20 §9, §21): each has its label and a fixture,
 * names are unique, an EXECUTE is always a click, and each row calls the
 * function it names — a READ the MCP data function, a WRITE the server
 * action the app's own button calls — with nothing between.
 */

const calls = vi.hoisted(() => [] as { from: string; args: unknown[] }[]);
const tracked = vi.hoisted(() => {
  const track = (from: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ from, args });
      return { from };
    });
  return {
    track,
    /** Every function a module exports, tracked; its constants as they are. */
    all: (prefix: string, mod: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(mod).map(([key, value]) => [
          key,
          typeof value === 'function' ? track(`${prefix}.${key}`) : value,
        ]),
      ),
  };
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/data', async (importOriginal) =>
  tracked.all('mcp/data', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/content', async (importOriginal) =>
  tracked.all('mcp/content', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/mentions', async (importOriginal) =>
  tracked.all('mcp/mentions', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/account', async (importOriginal) =>
  tracked.all('mcp/account', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/navigation', async (importOriginal) =>
  tracked.all('mcp/navigation', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/promptReads', async (importOriginal) =>
  tracked.all('mcp/prompt-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/overviewReads', async (importOriginal) =>
  tracked.all('mcp/overview-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/actionCenterReads', async (importOriginal) =>
  tracked.all('mcp/action-center-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/googleReads', async (importOriginal) =>
  tracked.all('mcp/google-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/workspaceReads', async (importOriginal) =>
  tracked.all('mcp/workspace-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/pages', async (importOriginal) =>
  tracked.all('mcp/pages', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/why', async (importOriginal) =>
  tracked.all('mcp/why', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/brandFactsReads', async (importOriginal) =>
  tracked.all('mcp/brand-facts-reads', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/mcp/whatsNew', async (importOriginal) =>
  tracked.all('mcp/whats-new', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/actions/content', () => ({
  updateOpportunityStatus: tracked.track('actions/content.updateOpportunityStatus'),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  createContentDraft: tracked.track('actions/content-drafts.createContentDraft'),
  updateContentDraft: tracked.track('actions/content-drafts.updateContentDraft'),
}));
vi.mock('@/lib/chat/actor/drafts', () => ({
  createContentDraftFor: tracked.track('chat/actor/drafts.createContentDraftFor'),
  updateContentDraftFor: tracked.track('chat/actor/drafts.updateContentDraftFor'),
}));
vi.mock('@/lib/chat/actor/apiWrites', () => ({
  updateOpportunityStatusFor: tracked.track('chat/actor/api-writes.updateOpportunityStatusFor'),
  dismissSuggestionFor: tracked.track('chat/actor/api-writes.dismissSuggestionFor'),
}));
vi.mock('@/lib/chat/actor/actionCenter', () => ({
  createChatActionFor: tracked.track('chat/actor/action-center.createChatActionFor'),
  checkChatActionCoverFor: tracked.track('chat/actor/action-center.checkChatActionCoverFor'),
}));
vi.mock('@/lib/actions/cmsSend', () => ({
  sendDraftToCms: tracked.track('actions/cms-send.sendDraftToCms'),
  publishDraftToCms: tracked.track('actions/cms-send.publishDraftToCms'),
}));
vi.mock('@/lib/actions/cmsTakeDown', () => ({
  takeDownDraft: tracked.track('actions/cms-take-down.takeDownDraft'),
}));
vi.mock('@/lib/actions/reports', () => ({
  createReport: tracked.track('actions/reports.createReport'),
}));
vi.mock('@/lib/actions/audits', () => ({
  startSiteAudits: tracked.track('actions/audits.startSiteAudits'),
  getAuditQuota: tracked.track('actions/audits.getAuditQuota'),
}));
vi.mock('@/lib/actions/promptSuggestions', () => ({
  dismissSuggestion: tracked.track('actions/prompt-suggestions.dismissSuggestion'),
}));
vi.mock('@/lib/actions/chatSchedules', () => ({
  createChatSchedule: tracked.track('actions/chat-schedules.createChatSchedule'),
}));
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: tracked.track('actions/chat-access-requests.requestAccess'),
}));
vi.mock('@/lib/actions/chatSkills', () => ({
  saveChatSkill: tracked.track('actions/chat-skills.saveChatSkill'),
}));
vi.mock('@/lib/actions/chatMemory', () => ({
  saveChatMemory: tracked.track('actions/chat-memory.saveChatMemory'),
  forgetChatMemory: tracked.track('actions/chat-memory.forgetChatMemory'),
}));
vi.mock('@/lib/actions/prompt', () => ({
  addTopicPrompts: tracked.track('actions/prompt.addTopicPrompts'),
  pauseBrandPrompts: tracked.track('actions/prompt.pauseBrandPrompts'),
}));
vi.mock('@/lib/actions/topic', () => ({
  addBrandTopic: tracked.track('actions/topic.addBrandTopic'),
  renameBrandTopic: tracked.track('actions/topic.renameBrandTopic'),
}));
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitors: tracked.track('actions/competitor.addCompetitors'),
  removeBrandCompetitor: tracked.track('actions/competitor.removeBrandCompetitor'),
}));
vi.mock('@/lib/actions/chatActionCenter', () => ({
  createChatAction: tracked.track('actions/chat-action-center.createChatAction'),
  attachToAction: tracked.track('actions/chat-action-center.attachToAction'),
  attachFileToTask: tracked.track('actions/chat-action-center.attachFileToTask'),
  setTaskReadyForReview: tracked.track('actions/chat-action-center.setTaskReadyForReview'),
  checkChatActionCover: tracked.track('actions/chat-action-center.checkChatActionCover'),
}));

const { CHAT_TOOLS, chatTool, chatToolByKey, registryCatalog } = await import('./tools');
const chatTool_ = (name: string) => chatTool(name)!;
const { BRAND_LOOKUP_TABLES, FIXTURE_IDS, defineTool, runsWithoutSession } =
  await import('./defineTool');
const { DEFAULT_CHAT_SETTINGS, allowedRoles, allowedTools } = await import('../precedence');
const { planFactsFromOrgRow } = await import('../planFacts');

const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'admin' as const,
};
const labels = (messages as Record<string, unknown>).chatTools as Record<string, unknown>;
/** The rows that make their change for a run with no session (sessionFree), in the registry's order. */
const SESSION_FREE = [
  'create_draft',
  'update_opportunity',
  'dismiss_prompt_suggestion',
  'create_action',
  'update_draft',
];
/** A run's place, as runLoggedWrite gives a write. */
const place = {
  conversationId: 'chat-1',
  runId: 'run-1',
  approvalKey: 'step-1',
  executionMode: 'automated' as const,
};

/** What keeps a row out of the registry: a missing label, a fixture its schema refuses. */
function rowProblems(tool: ChatTool, chatTools: Record<string, unknown> = labels): string[] {
  const problems: string[] = [];
  const label = chatTools?.[tool.labelKey] as Record<string, unknown> | undefined;
  for (const part of ['name', 'step']) {
    const text = label?.[part];
    if (typeof text !== 'string' || !text.trim()) {
      problems.push(`no chatTools.${tool.labelKey}.${part} in en.json`);
    }
  }
  if (!tool.fixture || !('input' in tool.fixture)) problems.push('no fixture');
  else if (!tool.inputSchema.safeParse(tool.fixture.input).success) {
    problems.push("its fixture doesn't pass its input schema");
  }
  return problems;
}

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
const dashboardDir = path.join(__dirname, '../../../app/[locale]/(dashboard)');
function pageExists(route: string): boolean {
  let dirs = [dashboardDir];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const children = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
      return children
        .filter((d) => d.name === segment || /^\[[^.\]]+\]$/.test(d.name))
        .map((d) => path.join(dir, d.name));
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

const readRow = {
  name: 'read_test',
  class: 'read' as const,
  area: 'brands' as const,
  description: 'test',
  minRole: 'analyst' as const,
  planGate: null,
  brandOf: null,
  costClass: 'C0' as const,
  labelKey: 'brands',
  route: null,
  mcpTool: null,
  specRow: '0',
  inputSchema: z.object({}),
  run: async () => null,
  fixture: { input: {} },
};

beforeEach(() => {
  calls.length = 0;
});

describe('the Chat tool registry', () => {
  it('has a label and a valid fixture on every row', () => {
    const problems = CHAT_TOOLS.flatMap((tool) =>
      rowProblems(tool).map((problem) => `${tool.name}: ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it('fails a row whose label is missing or whose fixture is', () => {
    const row = defineTool({ ...readRow, labelKey: 'notALabel' });
    expect(rowProblems(row)).toEqual([
      'no chatTools.notALabel.name in en.json',
      'no chatTools.notALabel.step in en.json',
    ]);
    const noFixture = { ...defineTool(readRow), fixture: undefined } as unknown as ChatTool;
    expect(rowProblems(noFixture)).toEqual(['no fixture']);
    const badFixture = defineTool({
      ...readRow,
      inputSchema: z.object({ brand_id: z.string() }),
      fixture: { input: {} as { brand_id: string } },
    });
    expect(rowProblems(badFixture)).toEqual(["its fixture doesn't pass its input schema"]);
  });

  it('gives every tool its own name and its own label', () => {
    const names = CHAT_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const keys = CHAT_TOOLS.map((tool) => tool.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the tools' names out of the label keys, which reach the browser", () => {
    // Every page gets all of en.json; a function name never reaches a customer (CHAT-03).
    const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const tool of CHAT_TOOLS) {
      expect(tool.labelKey).not.toContain('_');
      expect(tool.labelKey).not.toBe(camel(tool.name));
    }
  });

  it('finds a row by its name, and nothing for a name without one', () => {
    expect(chatTool('list_brands')?.class).toBe('read');
    expect(chatTool('delete_brand')).toBeUndefined();
  });

  it('points every route at a page of the app', () => {
    const missing = CHAT_TOOLS.filter((tool) => tool.route && !pageExists(tool.route));
    expect(missing.map((tool) => `${tool.name} → ${tool.route}`)).toEqual([]);
  });

  it.each(CHAT_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s calls its own function with the fixture, and returns what it returns',
    async (_name, tool) => {
      const result = await tool.run(ctx, tool.inputSchema.parse(tool.fixture.input));
      expect(calls).toHaveLength(1);
      expect(result).toEqual({ from: calls[0].from });
      if (tool.class === 'read') {
        // The MCP data functions, scoped to the signed-in member's organization.
        expect(calls[0].from).toMatch(/^mcp\//);
        expect(calls[0].args[0]).toBe(ctx);
      } else {
        // The app's server actions, through the member's own session.
        expect(calls[0].from).toMatch(/^actions\//);
      }
    },
  );

  it('hands the app the same arguments its pages pass', async () => {
    const run = (name: string, input: unknown) => {
      const tool = chatTool(name)!;
      return tool.run(ctx, tool.inputSchema.parse(input));
    };
    const { brand, item } = FIXTURE_IDS;

    await run('dismiss_prompt_suggestion', { suggestion_id: item });
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'dismissed',
      reason: 'wrong_angle',
    });
    // A reason goes only with a dismissal.
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'reviewed',
      reason: 'wrong_angle',
    });
    await run('create_draft', {
      brand_id: brand,
      title: ' Pricing FAQ ',
      page_type: 'docs_faq',
      source: { kind: 'opportunity', id: item },
    });
    await run('add_prompts', { brand_id: brand, topic_id: item, prompts: [' crm pricing '] });
    await run('pause_prompts', { brand_id: brand, prompt_ids: [item] });
    await run('add_topic', { brand_id: brand, name: ' Pricing ' });
    await run('rename_topic', { topic_id: item, name: 'Plans' });
    await run('add_competitors', { brand_id: brand, competitors: [{ name: 'Peec AI' }] });
    await run('remove_competitor', { brand_id: brand, competitor_id: item });
    // With the run's place (its chat, run and approval) for Action History, §10a.
    const place = {
      conversationId: 'conv-1',
      runId: 'run-1',
      approvalKey: 'step-1',
      executionMode: 'assisted' as const,
    };
    const runInChat = (name: string, input: unknown) => {
      const tool = chatTool_(name);
      return tool.run({ ...ctx, chat: place }, tool.inputSchema.parse(input));
    };
    await runInChat('create_action', {
      brand_id: brand,
      title: 'Win back pricing citations',
      category: 'recover',
      why: 'Lost 6 citations on /pricing.',
      prompt_ids: [item],
      pages: ['/pricing'],
      tasks: [
        { title: 'Add a FAQ to /pricing', type: 'on_page', url: '/pricing', done_when: 'Live' },
      ],
    });
    await runInChat('attach_to_action', { action_id: item, finding: 'Lost 6 citations.' });
    await runInChat('attach_file_to_task', { brand_id: brand, task_id: item, file_id: item });
    await runInChat('set_task_ready_for_review', { brand_id: brand, task_id: item });
    await run('update_draft', { draft_id: item, body_html: '<h1>FAQ</h1>' });
    await run('push_cms_draft', { draft_id: item, destination: 'wordpress' });
    await run('publish_cms', { draft_id: item, destination: 'wix' });
    await run('build_report', {
      brand_id: brand,
      template: 'competitor_benchmark',
      date_from: '2026-10-01',
      date_to: '2026-10-31',
    });
    await run('run_site_audit', { brand_id: brand, urls: [' https://acme.example/a '] });
    await run('save_skill', {
      name: 'pricing-faq',
      description: ' Writes a pricing FAQ. ',
      instructions: 'Read the pricing page.',
    });

    expect(calls.map((call) => [call.from, call.args])).toEqual([
      ['actions/prompt-suggestions.dismissSuggestion', [item]],
      ['actions/content.updateOpportunityStatus', [item, 'dismissed', 'wrong_angle']],
      ['actions/content.updateOpportunityStatus', [item, 'reviewed', undefined]],
      [
        'actions/content-drafts.createContentDraft',
        [
          brand,
          {
            method: 'create',
            title: 'Pricing FAQ',
            pageType: 'docs_faq',
            typePicked: false,
            source: { kind: 'opportunity', id: item },
            bodyHtml: undefined,
            sourceUrl: undefined,
            // Made in Chat (00463, W4-10); no chat in this context.
            origin: 'chat',
            conversationId: null,
          },
        ],
      ],
      ['actions/prompt.addTopicPrompts', [brand, item, ['crm pricing']]],
      ['actions/prompt.pauseBrandPrompts', [brand, [item]]],
      ['actions/topic.addBrandTopic', [brand, 'Pricing']],
      ['actions/topic.renameBrandTopic', [item, 'Plans']],
      ['actions/competitor.addCompetitors', [brand, [{ name: 'Peec AI', domain: '' }]]],
      ['actions/competitor.removeBrandCompetitor', [brand, item]],
      [
        'actions/chat-action-center.createChatAction',
        [
          brand,
          {
            title: 'Win back pricing citations',
            category: 'recover',
            why: 'Lost 6 citations on /pricing.',
            entities: { prompts: [item], pages: ['/pricing'], competitors: [], platforms: [] },
            tasks: [
              {
                title: 'Add a FAQ to /pricing',
                type: 'on_page',
                url: '/pricing',
                done_when: 'Live',
              },
            ],
          },
          place,
          false,
        ],
      ],
      [
        'actions/chat-action-center.attachToAction',
        [item, { finding: 'Lost 6 citations.', note: undefined, sources: undefined }, place],
      ],
      ['actions/chat-action-center.attachFileToTask', [brand, item, item, place]],
      ['actions/chat-action-center.setTaskReadyForReview', [brand, item, place]],
      [
        'actions/content-drafts.updateContentDraft',
        [item, { title: undefined, bodyHtml: '<h1>FAQ</h1>' }],
      ],
      ['actions/cms-send.sendDraftToCms', [item, 'wordpress']],
      ['actions/cms-send.publishDraftToCms', [item, 'wix']],
      [
        'actions/reports.createReport',
        [brand, { dateFrom: '2026-10-01', dateTo: '2026-10-31', template: 'competitor_benchmark' }],
      ],
      ['actions/audits.startSiteAudits', [brand, ['https://acme.example/a']]],
      [
        'actions/chat-skills.saveChatSkill',
        [
          {
            name: 'pricing-faq',
            description: 'Writes a pricing FAQ.',
            instructions: 'Read the pricing page.',
          },
        ],
      ],
    ]);
  });

  it('makes the drafts’ changes for a run without a session as its person, always', async () => {
    expect(CHAT_TOOLS.filter((tool) => tool.sessionFree).map((tool) => tool.name)).toEqual(
      SESSION_FREE,
    );
    for (const name of ['create_draft', 'update_draft']) {
      expect(runsWithoutSession(chatTool_(name)), name).toBe(true);
    }
    const brand = FIXTURE_IDS.brand;
    const item = FIXTURE_IDS.item;
    const create = chatTool_('create_draft');
    const start = create.inputSchema.parse(create.fixture.input);
    await create.run(ctx, start);
    await create.runFor!(ctx, start);
    const update = chatTool_('update_draft');
    await update.runFor!(ctx, update.inputSchema.parse({ draft_id: item, title: 'Plans' }));

    const person = { userId: 'user-1', organizationId: 'org-1' };
    const [viaSession, viaRun, change] = calls.map((call) => [call.from, call.args] as const);
    expect(viaSession[0]).toBe('actions/content-drafts.createContentDraft');
    // The same start the session's call gets, for the run's person.
    expect(viaRun).toEqual(['chat/actor/drafts.createContentDraftFor', [person, ...viaSession[1]]]);
    expect(viaRun[1]).toEqual([person, brand, expect.objectContaining({ typePicked: false })]);
    expect(change).toEqual([
      'chat/actor/drafts.updateContentDraftFor',
      [person, item, { title: 'Plans', bodyHtml: undefined }],
    ]);
    // Made in the run's chat; an agent's run's own write is the agent's (00463, W4-10).
    calls.length = 0;
    const CHAT = 'cccccccc-0000-4000-8000-000000000001';
    const inChat = {
      ...ctx,
      chat: {
        conversationId: CHAT,
        runId: 'run-1',
        agentRunId: 'agent-run-1',
        approvalKey: 'k',
        executionMode: 'automated' as const,
      },
    };
    await create.run(inChat, start);
    await create.runFor!(inChat, start);
    expect(calls[0].args[1]).toMatchObject({ origin: 'chat', conversationId: CHAT });
    expect(calls[1].args[2]).toMatchObject({ origin: 'agent', conversationId: CHAT });
    // A context with no workspace has no one to act for.
    await expect(create.runFor!({ ...ctx, organizationId: null }, start)).rejects.toThrow(
      /workspace/,
    );
  });

  it('writes through the API server for a run without a session as its person, while that way is open', async () => {
    const through = ['update_opportunity', 'dismiss_prompt_suggestion', 'create_action'];
    // Closed: no CHAT_ACTING_SECRET, or one shorter than the server takes.
    for (const secret of ['', 'x'.repeat(31)]) {
      vi.stubEnv('CHAT_ACTING_SECRET', secret);
      for (const name of through) expect(runsWithoutSession(chatTool_(name)), name).toBe(false);
    }
    vi.stubEnv('CHAT_ACTING_SECRET', 'x'.repeat(32));
    for (const name of through) expect(runsWithoutSession(chatTool_(name)), name).toBe(true);
    vi.unstubAllEnvs();

    const item = FIXTURE_IDS.item;
    const brand = FIXTURE_IDS.brand;
    const run = async (name: string, input: unknown) => {
      const tool = chatTool_(name);
      await tool.runFor!(ctx, tool.inputSchema.parse(input));
    };
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'dismissed',
      reason: 'wrong_angle',
    });
    await run('update_opportunity', {
      opportunity_id: item,
      status: 'reviewed',
      reason: 'wrong_angle',
    });
    await run('dismiss_prompt_suggestion', { suggestion_id: item });
    const send = chatTool_('create_action');
    const proposal = send.inputSchema.parse(send.fixture.input);
    await send.runFor!({ ...ctx, chat: place }, proposal);
    await send.precheckFor!(ctx, proposal);

    // The run's person, from its context: never the input's.
    const person = { userId: 'user-1', organizationId: 'org-1' };
    expect(calls.map((call) => [call.from, call.args])).toEqual([
      [
        'chat/actor/api-writes.updateOpportunityStatusFor',
        [person, item, 'dismissed', 'wrong_angle'],
      ],
      // A reason goes only with a dismissal, as the session's call has it.
      ['chat/actor/api-writes.updateOpportunityStatusFor', [person, item, 'reviewed', undefined]],
      ['chat/actor/api-writes.dismissSuggestionFor', [person, item]],
      [
        'chat/actor/action-center.createChatActionFor',
        [person, brand, expect.objectContaining({ title: proposal.title }), place, false],
      ],
      [
        'chat/actor/action-center.checkChatActionCoverFor',
        [person, brand, expect.objectContaining({ pages: ['/pricing'] }), 'recover'],
      ],
    ]);
    // Never the session's actions.
    expect(calls.some((call) => call.from.startsWith('actions/'))).toBe(false);
  });

  it("checks Send to Action Center's duplicate before its card, and lets Create anyway go only where it may", async () => {
    const send = chatTool_('create_action');
    const input = send.inputSchema.parse(send.fixture.input);
    const { checkChatActionCover } = await import('@/lib/actions/chatActionCenter');
    const check = vi.mocked(checkChatActionCover);
    const duplicate = (canCreateAnyway: boolean) => ({
      ok: false as const,
      reason: 'duplicate' as const,
      message: 'AC-1258 already covers this.',
      action_id: FIXTURE_IDS.item,
      action_no: 1258,
      can_create_anyway: canCreateAnyway,
    });

    check.mockResolvedValueOnce({ ok: true });
    await expect(send.precheck!(ctx, input)).resolves.toBeNull();
    expect(check).toHaveBeenLastCalledWith(
      FIXTURE_IDS.brand,
      { prompts: [], pages: ['/pricing'], competitors: [], platforms: [] },
      'recover',
    );
    check.mockResolvedValueOnce(duplicate(false));
    await expect(send.precheck!(ctx, input)).resolves.toMatchObject({ reason: 'duplicate' });
    // Create anyway: past a partial overlap only.
    const anyway = { ...input, create_anyway: true };
    check.mockResolvedValueOnce(duplicate(true));
    await expect(send.precheck!(ctx, anyway)).resolves.toBeNull();
    check.mockResolvedValueOnce(duplicate(false));
    await expect(send.precheck!(ctx, anyway)).resolves.toMatchObject({ reason: 'duplicate' });
  });

  it('shows on its card what is frozen once made, and its Open once made (CHAT-09 18, 18b)', async () => {
    const send = chatTool_('create_action');
    const input = send.inputSchema.parse({
      ...send.fixture.input,
      goal: 'Get /pricing cited again',
      platforms: ['google-aio'],
      tasks: [
        {
          title: 'Add a FAQ to /pricing',
          type: 'on_page',
          url: '/pricing',
          done_when: 'Live',
          change: { after: 'Q: Which plan tracks Gemini? A: Growth and up.' },
        },
        { title: 'Pitch G2 a review', type: 'outreach', where: 'g2.com', done_when: 'Sent' },
      ],
    });
    expect(send.target!(input, { organizationId: 'org-1' })).toBe(
      '“Win back pricing citations on /pricing” · Recover · 2 tasks',
    );
    await expect(send.cardDetails!(input, { organizationId: 'org-1' })).resolves.toEqual({
      items: [
        {
          title: 'Add a FAQ to /pricing',
          detail: 'On-page · /pricing · Done when: Live',
          body: 'Q: Which plan tracks Gemini? A: Growth and up.',
        },
        { title: 'Pitch G2 a review', detail: 'Outreach · g2.com · Done when: Sent' },
      ],
      why: 'Google AI Overviews stopped citing /pricing for 2 pricing prompts this week.',
      goal: 'Get /pricing cited again',
      targets: [
        { kind: 'prompts', values: [] },
        { kind: 'pages', values: ['/pricing'] },
        { kind: 'competitors', values: [] },
        { kind: 'platforms', values: ['Google AI Overviews'] },
      ],
    });
    // Create anyway is the person's choice: a card in every mode (CHAT-09 18a).
    expect(send.alwaysCardWhen!({ ...input, create_anyway: true })).toBe(true);
    expect(send.alwaysCardWhen!(input)).toBe(false);
    const href = `/dashboard/action-center/actions/${FIXTURE_IDS.item}`;
    expect(
      send.resultCard!(input, { ok: true, action_id: FIXTURE_IDS.item, action_no: 1271, href }),
    ).toEqual({
      kind: 'action_created',
      actionNo: 1271,
      title: 'Win back pricing citations on /pricing',
      href,
    });
    expect(send.resultCard!(input, { ok: false, reason: 'duplicate' })).toBeNull();
    const add = chatTool_('attach_to_action');
    expect(
      add.resultCard!(add.inputSchema.parse(add.fixture.input), {
        ok: true,
        action_no: 1258,
        href,
      }),
    ).toMatchObject({ kind: 'action_added', actionNo: 1258 });
  });

  it('never offers a tool that marks a task done (CHAT-09 item 15)', () => {
    const names = CHAT_TOOLS.map((tool) => tool.name).join(' ');
    expect(names).not.toMatch(/complete|mark_done|dismiss_action|delete_action|close_task/);
  });

  it('refuses what the update and draft writes are not for', () => {
    const update = chatTool('update_opportunity')!.inputSchema;
    // Only reviewed or dismissed (CHAT-20 §9 row 49), not the rest of the workflow.
    expect(update.safeParse({ opportunity_id: FIXTURE_IDS.item, status: 'done' }).success).toBe(
      false,
    );
    const draft = chatTool('create_draft')!.inputSchema;
    const base = {
      brand_id: FIXTURE_IDS.brand,
      title: 'Pricing',
      page_type: 'pricing',
      source: { kind: 'content' },
    };
    expect(draft.safeParse(base).success).toBe(true);
    expect(draft.safeParse({ ...base, source_url: 'ftp://example.com' }).success).toBe(false);
    expect(draft.safeParse({ ...base, page_type: 'press_release' }).success).toBe(false);
  });
});

describe('approval policies', () => {
  it('lets a read run, and starts every write here at Ask (auto allowed in Full auto)', () => {
    for (const tool of CHAT_TOOLS) {
      if (tool.class === 'read') {
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['on', 'on']);
      } else if (tool.class === 'write' && (tool.flags.alwaysCard || tool.flags.costCard)) {
        // Ask your Admin, or a cost said first: a card in every mode (CHAT-20 rows 37, 80a).
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['ask', 'ask']);
      } else if (tool.class === 'write') {
        expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['ask_full_auto', 'always']);
      }
    }
  });

  it('opens daily work to every role and keeps the rest with Admins and Managers', () => {
    // The role model of 2026-10-29, as the server (#1763), MCP (#1762) and RLS have each write.
    const writes = CHAT_TOOLS.filter((t) => t.class !== 'read');
    expect(Object.fromEntries(writes.map((t) => [t.name, allowedRoles(t)]))).toEqual({
      create_draft: ['admin', 'manager', 'analyst', 'agency_partner'],
      update_opportunity: ['admin', 'manager'],
      dismiss_prompt_suggestion: ['admin', 'manager', 'analyst'],
      request_access: ['admin', 'manager', 'analyst', 'agency_partner'],
      // The brand's tracking setup (W2-06): Admins and Managers, as the app (00382, #1762).
      add_prompts: ['admin', 'manager'],
      pause_prompts: ['admin', 'manager'],
      add_topic: ['admin', 'manager'],
      rename_topic: ['admin', 'manager'],
      add_competitors: ['admin', 'manager'],
      remove_competitor: ['admin', 'manager'],
      // Chat's Action Center changes (W2-10): Admins and Managers, as the server's routes.
      create_action: ['admin', 'manager'],
      attach_to_action: ['admin', 'manager'],
      attach_file_to_task: ['admin', 'manager'],
      set_task_ready_for_review: ['admin', 'manager'],
      // Content, reports and Site Audit (W2-07, DECISIONS T): an Analyst only saves drafts.
      update_draft: ['admin', 'manager'],
      push_cms_draft: ['admin', 'manager'],
      publish_cms: ['admin', 'manager'],
      // Take down (AUTONOMOUS-GO-LIVE PR 10): as the API's route, a Manager even while publishing is off.
      unpublish_cms: ['admin', 'manager'],
      build_report: ['admin', 'manager'],
      run_site_audit: ['admin', 'manager'],
      // Scheduled work (CHAT-20 §4: Admins and Managers create schedules).
      create_schedule: ['admin', 'manager'],
      // A skill of one's own (W3-06, CHAT-13 v2): Admins and Managers save skills.
      save_skill: ['admin', 'manager'],
      // Memory (W3-11, CHAT-14 item 25): every role has its Me; the store checks the scope.
      save_memory: ['admin', 'manager', 'analyst', 'agency_partner'],
      forget_memory: ['admin', 'manager', 'analyst', 'agency_partner'],
    });
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'read')) {
      expect(allowedRoles(tool)).toEqual(['admin', 'manager', 'analyst', 'agency_partner']);
    }
  });

  it('files the page create_draft saved as the draft keeps it: cleaned (CHAT-06)', () => {
    const draft = CHAT_TOOLS.find((t) => t.name === 'create_draft')!;
    const made = draft.deliverable!(
      {
        title: 'Pricing FAQ',
        body_html:
          '<h1>Pricing FAQ</h1><script>fetch("https://evil.example")</script><img src="https://getcito.com/a.png" onerror="alert(1)">',
      } as never,
      FIXTURE_IDS.brand,
    )!;
    expect(made.body).not.toMatch(/<script/i);
    expect(made.body).not.toMatch(/onerror/i);
    expect(made.body).toContain('<h1>Pricing FAQ</h1>');
  });

  it('says where every row that takes a brand or an object finds its brand', () => {
    // Memory's lines (W3-11): a Me or Workspace line has no brand, so the store checks a
    // Brand line's brand itself (memory/store.ts), never the precedence's brand rule.
    const OWN_BRAND_CHECK = new Set(['save_memory', 'forget_memory']);
    const problems = CHAT_TOOLS.filter((tool) => !OWN_BRAND_CHECK.has(tool.name)).flatMap(
      (tool) => {
        const fields = Object.keys(tool.inputSchema.shape);
        const ids = fields.filter((field) => field === 'id' || field.endsWith('_id'));
        const brandOf = tool.brandOf;
        if (fields.includes('brand_id')) {
          return brandOf && 'input' in brandOf ? [] : [`${tool.name}: takes brand_id`];
        }
        if (ids.length > 0) {
          return brandOf && 'lookup' in brandOf && ids.includes(brandOf.idField)
            ? []
            : [`${tool.name}: takes ${ids.join(', ')}, so its brand is looked up`];
        }
        return brandOf === null ? [] : [`${tool.name}: names no brand or object`];
      },
    );
    expect(problems).toEqual([]);
    for (const tool of CHAT_TOOLS) {
      if (tool.brandOf && 'lookup' in tool.brandOf) {
        expect(BRAND_LOOKUP_TABLES).toContain(tool.brandOf.lookup);
      }
    }
    // A row can't name a field its input lacks.
    expect(() => defineTool({ ...readRow, brandOf: { input: 'brand_id' } })).toThrow(
      /brand_id, which its input lacks/,
    );
  });

  it('marks the reads about no brand that list every brand the person can access (00436)', () => {
    // A chat they run in has touched each of those brands (touchedBrands.ts).
    expect(
      CHAT_TOOLS.filter((tool) => tool.namesBrands)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['list_brands', 'list_connections']);
    expect(() =>
      defineTool({
        ...readRow,
        inputSchema: z.object({ brand_id: z.string() }),
        brandOf: { input: 'brand_id' },
        namesBrands: true,
        fixture: { input: { brand_id: 'x' } },
      }),
    ).toThrow(/doesn't name every brand/);
  });

  it('leaves roles out only of a row open to every role, and never an Admin', () => {
    const write = { ...readRow, class: 'write' as const, defaultPolicy: 'ask', maxPolicy: 'ask' };
    expect(
      defineTool({ ...write, excludeRoles: ['agency_partner'] } as never).excludeRoles,
    ).toEqual(['agency_partner']);
    expect(defineTool(readRow).excludeRoles).toEqual([]);
    expect(() =>
      defineTool({ ...write, minRole: 'manager', excludeRoles: ['analyst'] } as never),
    ).toThrow(/every role/);
    expect(() => defineTool({ ...write, excludeRoles: ['admin'] } as never)).toThrow(/Admin/);
  });

  it('keeps every execute at a click', () => {
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'execute')) {
      expect([tool.defaultPolicy, tool.maxPolicy]).toEqual(['click', 'click']);
    }
    const execute = defineTool({
      ...readRow,
      name: 'publish_test',
      class: 'execute',
      executeGroup: 'publishing',
    });
    expect([execute.defaultPolicy, execute.maxPolicy]).toEqual(['click', 'click']);
    expect(execute.executeGroup).toBe('publishing');
    // Every execute is in a go-live group, so the Managers' switch covers it.
    expect(() => defineTool({ ...readRow, class: 'execute' } as never)).toThrow(/go-live group/);
    // A row that asks for less than a click isn't defined at all.
    expect(() =>
      defineTool({ ...readRow, class: 'execute', defaultPolicy: 'always' } as never),
    ).toThrow(/click/);
    expect(() =>
      defineTool({ ...readRow, class: 'execute', maxPolicy: 'ask_full_auto' } as never),
    ).toThrow(/click/);
  });

  it('runs only a write for its person without a session, and only with its runFor', () => {
    const write = { ...readRow, class: 'write' as const, defaultPolicy: 'ask', maxPolicy: 'ask' };
    const runFor = async () => null;
    expect(defineTool({ ...write, sessionFree: true, runFor } as never).sessionFree).toBe(true);
    // Its way, and a check of its own for such a run, only with it; that check beside the row's.
    const precheck = async () => null;
    const open = () => true;
    expect(() => defineTool({ ...write, runForOpen: open } as never)).toThrow(/session-free/);
    expect(() => defineTool({ ...write, precheck, precheckFor: precheck } as never)).toThrow(
      /session-free/,
    );
    expect(() =>
      defineTool({ ...write, sessionFree: true, runFor, precheckFor: precheck } as never),
    ).toThrow(/its precheck/);
    const closed = defineTool({
      ...write,
      sessionFree: true,
      runFor,
      runForOpen: () => false,
    } as never);
    expect(runsWithoutSession(closed)).toBe(false);
    expect(runsWithoutSession(defineTool({ ...write, sessionFree: true, runFor } as never))).toBe(
      true,
    );
    expect(runsWithoutSession(defineTool(write as never))).toBe(false);
    expect(() => defineTool({ ...write, sessionFree: true } as never)).toThrow(/runFor/);
    expect(() => defineTool({ ...write, runFor } as never)).toThrow(/runFor/);
    // A read reads as the person already; an execute waits for their click.
    expect(() => defineTool({ ...readRow, sessionFree: true, runFor })).toThrow(/only a write/);
    expect(() =>
      defineTool({
        ...readRow,
        class: 'execute',
        executeGroup: 'publishing',
        sessionFree: true,
        runFor,
      }),
    ).toThrow(/only a write/);
  });

  it('lets only an execute go live on its own, and only one whose input names no outside target (AUTONOMOUS-GO-LIVE §6.3)', () => {
    const goLive = () => ({ kind: 'cms_draft' as const, draftId: 'd', target: 'webflow' as const });
    const execute = {
      ...readRow,
      name: 'publish_test',
      class: 'execute' as const,
      executeGroup: 'publishing' as const,
    };
    // Ids and fixed choices only: a draft, the CMS the brand connected, a switch.
    const own = defineTool({
      ...execute,
      inputSchema: z.object({
        draft_id: z.string().regex(/^[0-9a-f-]{36}$/),
        guid: z.guid().optional(),
        destination: z.enum(['webflow', 'wordpress']),
        live: z.boolean().default(false),
      }),
      fixture: { input: { draft_id: FIXTURE_IDS.item, destination: 'webflow' } },
      goLive,
    });
    expect(own.flags.goLiveOnOwn).toBe(true);
    // A field that takes an address, a mail address, a site, free text or a list of them.
    for (const field of [
      z.string(),
      z.string().url(),
      z.email(),
      z.string().max(300).optional(),
      z.array(z.guid()),
      z.object({ url: z.string() }),
    ]) {
      expect(() =>
        defineTool({
          ...execute,
          inputSchema: z.object({ draft_id: z.guid(), to: field }),
          goLive,
        } as never),
      ).toThrow(/takes no free text \(to\)/);
    }
    // Never a read or a write, which aren't clicks to lift.
    expect(() => defineTool({ ...readRow, goLive })).toThrow(/only an execute/);
    expect(() =>
      defineTool({ ...readRow, class: 'write', defaultPolicy: 'ask', maxPolicy: 'ask', goLive }),
    ).toThrow(/only an execute/);
    // The registry: Send to CMS may, every other row may not.
    const onItsOwn = CHAT_TOOLS.filter((tool) => tool.flags.goLiveOnOwn).map((tool) => tool.name);
    expect(onItsOwn).toEqual(['push_cms_draft', 'publish_cms']);
    // Take down (PR 10): an EXECUTE outside the go-live groups, which never goes live itself.
    expect(chatTool('unpublish_cms')).toMatchObject({ class: 'execute', executeGroup: null });
    expect(() => defineTool({ ...execute, executeGroup: null, goLive } as never)).toThrow(
      /outside the groups never goes live/,
    );
    expect(chatTool('publish_cms')?.goLive?.({ draft_id: 'd', destination: 'wordpress' })).toEqual({
      kind: 'publish',
      draftId: 'd',
      target: 'wordpress',
    });
    expect(chatTool('push_cms_draft')?.goLive?.({ draft_id: 'd', destination: 'wix' })).toEqual({
      kind: 'cms_draft',
      draftId: 'd',
      target: 'wix',
    });
  });

  it("refuses a write's policy past what its flags allow", () => {
    const write = { ...readRow, class: 'write' as const };
    expect(() =>
      defineTool({ ...write, defaultPolicy: 'always', maxPolicy: 'ask_full_auto' }),
    ).toThrow(/past its maximum/);
    // An always_card write shows its card in every mode, Full auto too (CHAT-20 §3a).
    expect(() =>
      defineTool({
        ...write,
        defaultPolicy: 'ask',
        maxPolicy: 'ask_full_auto',
        flags: { alwaysCard: true },
      }),
    ).toThrow(/without a card/);
    expect(
      defineTool({ ...write, defaultPolicy: 'ask', maxPolicy: 'ask', flags: { alwaysCard: true } })
        .flags,
    ).toEqual({ alwaysCard: true, costCard: false, adminMayTurnOff: false, goLiveOnOwn: false });
    expect(() => defineTool({ ...write, defaultPolicy: 'on', maxPolicy: 'on' } as never)).toThrow(
      /asked/,
    );
  });
});

describe('registryCatalog', () => {
  it('lists every row as plain data, in registry order, with no code in it', () => {
    const catalog = registryCatalog();
    expect(catalog.map((entry) => entry.key)).toEqual(CHAT_TOOLS.map((tool) => tool.labelKey));
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'area',
          'class',
          'costClass',
          'defaultPolicy',
          'excludeRoles',
          'flags',
          'key',
          'maxPolicy',
          'minRole',
          'planGate',
          'route',
        ].sort(),
      );
    }
  });

  it('never carries a tool name to the browser, internal or MCP', () => {
    // CHAT-03 item 22: no name in any value, and no key A1's event rule refuses.
    const names = new Set(CHAT_TOOLS.flatMap((tool) => [tool.name, tool.mcpTool ?? '']));
    const values: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
      else values.push(value);
    };
    const catalog = registryCatalog();
    walk(catalog);
    expect(values.filter((value) => typeof value === 'string' && names.has(value))).toEqual([]);
    const asEvent = { type: 'next_moves', seq: 1, data: { catalog } } as unknown as ChatEvent;
    expect(clientEventProblems(asEvent)).toEqual([]);
  });

  it('leads a key from the browser back to its row on the server', () => {
    for (const tool of CHAT_TOOLS) expect(chatToolByKey(tool.labelKey)).toBe(tool);
    expect(chatToolByKey('list_brands')).toBeUndefined();
  });

  it('describes a row as it is defined, without sharing its objects', () => {
    const row = defineTool({ ...readRow, planGate: { feature: 'prompt_volumes' } });
    const [entry] = registryCatalog([row]);
    expect(entry).toMatchObject({
      key: 'brands',
      class: 'read',
      defaultPolicy: 'on',
      planGate: { feature: 'prompt_volumes' },
      flags: { alwaysCard: false, costCard: false, adminMayTurnOff: false, goLiveOnOwn: false },
    });
    expect(entry.planGate).not.toBe(row.planGate);
    expect(entry.flags).not.toBe(row.flags);
  });
});

describe("the model's tool list on the registry's rows", () => {
  // CHAT-20 §21: the list equals the rows the role, plan, brand access and policy allow.
  const facts = (row: Parameters<typeof planFactsFromOrgRow>[0], cloud = true) => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', cloud ? 'true' : 'false');
    try {
      return planFactsFromOrgRow(row);
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const list = (
    role: TeamRole,
    plan: ReturnType<typeof facts>,
    scope = { brandId: FIXTURE_IDS.brand as string | null, brandIsDemo: false },
    brandAccess: 'all' | string[] = 'all',
  ) =>
    allowedTools(
      CHAT_TOOLS,
      {
        organizationId: 'org-1',
        role,
        plan,
        settings: DEFAULT_CHAT_SETTINGS,
        mode: 'full_auto',
        surface: 'chat',
        autoChoices: new Set(),
        brandAccess,
        injectionDetected: false,
      },
      scope,
    ).map((tool) => tool.name);

  const reads = CHAT_TOOLS.filter((tool) => tool.class === 'read').map((tool) => tool.name);
  // The WRITEs and the EXECUTEs (push_cms_draft, publish_cms), in the registry's order.
  const writes = CHAT_TOOLS.filter((tool) => tool.class !== 'read').map((tool) => tool.name);
  const starter = facts({ plan: 'starter', subscription_status: 'active' });
  const growth = facts({ plan: 'growth', subscription_status: 'active' });
  const withoutShopping = reads.filter((name) => name !== 'get_shopping_visibility');

  it('gives every role the reads its plan opens, and Analysts and Agency partners daily work only', () => {
    // Memory (W3-11): everyone keeps their own Me.
    const memory = ['save_memory', 'forget_memory'];
    expect(list('analyst', starter)).toEqual([
      ...withoutShopping,
      'create_draft',
      'dismiss_prompt_suggestion',
      'request_access',
      ...memory,
    ]);
    expect(list('agency_partner', growth)).toEqual([
      ...reads,
      'create_draft',
      'request_access',
      ...memory,
    ]);
    expect(list('manager', starter)).toEqual([...withoutShopping, ...writes]);
    expect(list('admin', growth)).toEqual([...reads, ...writes]);
    expect(list('analyst', facts(null, false))).toEqual([
      ...reads,
      'create_draft',
      'dismiss_prompt_suggestion',
      'request_access',
      ...memory,
    ]);
  });

  it('lists reads only on a read-only workspace and on the demo brand', () => {
    const ended = facts({ plan: 'growth', subscription_status: 'canceled' });
    expect(list('admin', ended)).toEqual(withoutShopping);
    expect(list('admin', growth, { brandId: FIXTURE_IDS.brand, brandIsDemo: true })).toEqual(reads);
  });

  it("lists nothing for a brand outside the person's scope", () => {
    expect(list('agency_partner', growth, undefined, [])).toEqual([]);
    expect(list('agency_partner', growth, undefined, [FIXTURE_IDS.brand])).toEqual([
      ...reads,
      'create_draft',
      'request_access',
      'save_memory',
      'forget_memory',
    ]);
  });
});
