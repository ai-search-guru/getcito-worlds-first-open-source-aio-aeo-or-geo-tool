import { z } from 'zod';
import {
  getChatPolicyFor,
  getPlanFactsFor,
  listConnectionsFor,
  listMembersFor,
} from '@/lib/mcp/workspaceReads';
import { defineTool } from './defineTool';

/**
 * Chat's workspace reads (CHAT-20 §9 rows 5, 8, 9 and 10; Chat Wave 1
 * W1-16): about the organization, not a brand. Nothing secret: e-mails for
 * Admins only, no key or token, no AI budget in dollars.
 */

const none = z.object({});

export const ACCOUNT_READS = [
  defineTool({
    name: 'list_members',
    class: 'read',
    area: 'account',
    description:
      'The workspace\'s members: name, role and brand access (e-mails for Admins only). For "who is on my team" and "who can approve this" questions.',
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'members',
    route: '/dashboard/settings/team',
    mcpTool: null,
    specRow: '8',
    inputSchema: none,
    run: (ctx) => listMembersFor(ctx),
    fixture: { input: {} },
  }),
  defineTool({
    name: 'list_connections',
    class: 'read',
    area: 'account',
    description:
      "What each brand the person may use has connected (Search Console, Analytics, CMS sites, a workflow webhook, catalog sources), with the account and access; whose sign-in failed; what it could still connect; the tools coming soon; the workspace's AI provider keys (whether set, never the key) and the person's own GetCito API keys (names and last use, never the key). Connecting is done by an Admin in Settings › Integrations.",
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    namesBrands: true,
    costClass: 'C0',
    labelKey: 'connections',
    route: '/dashboard/chat/connections',
    mcpTool: null,
    specRow: '9',
    inputSchema: none,
    run: (ctx) => listConnectionsFor(ctx),
    fixture: { input: {} },
  }),
  defineTool({
    name: 'get_chat_policy',
    class: 'read',
    area: 'account',
    description:
      "Chat's rules in this workspace: the Admin's policy per tool, whether members may use Full auto and \"Don't ask again\", what Managers may take live, and the person's own \"Don't ask again\" ticks.",
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'chatPolicy',
    route: '/dashboard/settings/roles-access',
    mcpTool: null,
    specRow: '10',
    inputSchema: none,
    run: (ctx) => getChatPolicyFor(ctx),
    fixture: { input: {} },
  }),
  defineTool({
    name: 'get_plan_facts',
    class: 'read',
    area: 'account',
    description:
      "The workspace's plan: its name and price, trial or not, what it includes and limits (counts), and what the next plan adds. Never an AI budget in dollars.",
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C0',
    labelKey: 'planFacts',
    route: '/dashboard/settings/billing',
    mcpTool: null,
    specRow: '5',
    inputSchema: none,
    run: (ctx) => getPlanFactsFor(ctx),
    fixture: { input: {} },
  }),
];
