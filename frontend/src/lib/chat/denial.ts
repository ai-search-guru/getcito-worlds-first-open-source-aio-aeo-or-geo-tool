import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { TeamRole } from '@/components/context/RoleProvider';
import { PLANS, type PlanId } from '@/config/plans';
import type { NextPlan, PlanFacts } from './planFacts';
import type { ToolDenial } from './precedence';
import type { ChatTool } from './registry/defineTool';

/**
 * The out-of-permission answer (CHAT-20 §4c), built on the server from the
 * precedence's denial, never by the model, which only puts the parts into a
 * sentence. Four parts: what was asked, why not (the rule and where it is
 * set), who can (by role, never a person), and what to do next. MCP and
 * email hosts get the same structure.
 *
 * It names nothing outside the person's scope: a brand they can't access
 * gets "I can only see the brands shared with you", without the brand's
 * name, the call's target or a word on whether it exists. Words from
 * messages/en.json, in English as the rest of what the server writes.
 */

/** The rule behind a denial: §4c's role, plan and policy, and the workspace's own states. */
export type DenialRuleKind = 'brand' | 'workspace' | 'demo' | 'policy' | 'plan' | 'role';

/** The next steps a denial offers, as buttons (§4c part 4). */
export type DenialNextAction =
  'ask_admin' | 'see_access' | 'upgrade' | 'choose_plan' | 'compare_plans' | 'open_policy';

export interface ChatDenial {
  code: ToolDenial['code'];
  /** 402 for a read-only workspace and the demo brand, as the app's own writes answer; else 403. */
  status: 402 | 403;
  /** 1. What was asked: the tool's words, and its target unless that is out of scope. */
  asked: string;
  /** 2. Why not, and where the rule is set (null: nowhere to change it). */
  rule: { kind: DenialRuleKind; detail: string; source: string | null };
  /** 3. Who can, by role. */
  whoCanRoles: TeamRole[];
  whoCan: string;
  /** 4. What to do next. */
  nextActions: DenialNextAction[];
  /** For a plan gate: the plan it needs and the step up (§7a); none on Enterprise. */
  plan?: { needs: PlanId; current: PlanId; isTrial: boolean; nextPlan: NextPlan | null };
}

export interface DenialInput {
  tool: ChatTool;
  /** The person's live role, the one the precedence decided with; null without a context (no_access). */
  role: TeamRole | null;
  /** Null without a context (no_access). */
  plan: PlanFacts | null;
  /** What the call was about, in names the person can see ("Pricing FAQ"). */
  target?: string | null;
}

const t = createTranslator({ locale: 'en', messages, namespace: 'chatDenial' });
const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });
const roleT = createTranslator({ locale: 'en', messages, namespace: 'settings' });

const roleName = (role: TeamRole) => roleT(`team_role_${role}`);
const planName = (id: PlanId) => PLANS[id].name;

/** Admins never get "Ask your Admin"; everyone else does. */
const askOrOwn = (role: TeamRole | null, own: DenialNextAction[]): DenialNextAction[] =>
  role === 'admin' ? own : ['ask_admin', ...own];

const roleList = new Intl.ListFormat('en-US', { type: 'conjunction' });

/** "Admins can do this.", "Admins and Managers can do this." */
function whoCanText(roles: TeamRole[]): string {
  return t('whoCan.roles', { roles: roleList.format(roles.map((r) => t(`rolesPlural.${r}`))) });
}

/** The four parts of a denial, for the person whose call it refused. */
export function buildDenial(denial: ToolDenial, input: DenialInput): ChatDenial {
  const { tool, ...rest } = input;
  // Every row has its label: the registry's test fails one without.
  return buildActionDenial(denial, { ...rest, action: toolT(`${tool.labelKey}.name` as never) });
}

/**
 * The same four parts for a request that isn't a registry row, its action
 * named in words: an agent's create, change or Run now on Chat's API
 * (CHAT-21 §K item 51).
 */
export function buildActionDenial(
  denial: ToolDenial,
  input: Omit<DenialInput, 'tool'> & { action: string },
): ChatDenial {
  const { role, plan, action } = input;
  // Out of scope, the target may name the brand: only the tool's own words stay.
  const target = denial.code === 'brand_scope' ? null : input.target?.trim() || null;
  const asked = target ? t('askedTarget', { action, target }) : t('asked', { action });
  const base = { code: denial.code, asked };

  switch (denial.code) {
    case 'no_access':
      return {
        ...base,
        status: 403,
        rule: { kind: 'workspace', detail: t('rule.no_access'), source: null },
        whoCanRoles: ['admin'],
        whoCan: t('whoCan.noAccess'),
        nextActions: [],
      };
    case 'brand_scope':
      return {
        ...base,
        status: 403,
        rule: { kind: 'brand', detail: t('rule.brand_scope'), source: null },
        whoCanRoles: ['admin'],
        whoCan: t('whoCan.brands'),
        nextActions: askOrOwn(role, ['see_access']),
      };
    case 'subscription_inactive':
      return {
        ...base,
        status: 402,
        rule: {
          kind: 'workspace',
          detail: t('rule.subscription_inactive'),
          source: t('source.billing'),
        },
        whoCanRoles: ['admin'],
        whoCan: t('whoCan.choosePlan'),
        nextActions: role === 'admin' ? ['choose_plan'] : ['ask_admin'],
      };
    case 'demo_brand':
      return {
        ...base,
        status: 402,
        rule: { kind: 'demo', detail: t('rule.demo_brand'), source: null },
        whoCanRoles: [],
        whoCan: t('whoCan.demo'),
        nextActions: [],
      };
    case 'policy_never':
      return {
        ...base,
        status: 403,
        rule: {
          kind: 'policy',
          detail: t('rule.policy_never', { action }),
          source: t('source.chat'),
        },
        whoCanRoles: ['admin'],
        whoCan: whoCanText(['admin']),
        nextActions: role === 'admin' ? ['open_policy'] : ['ask_admin', 'see_access'],
      };
    case 'execute_off':
      return {
        ...base,
        status: 403,
        rule: {
          kind: 'policy',
          detail: t('rule.execute_off', { group: denial.group }),
          source: t('source.chat'),
        },
        whoCanRoles: ['admin'],
        whoCan: whoCanText(['admin']),
        nextActions: askOrOwn(role, ['see_access']),
      };
    case 'plan_locked': {
      // A plan gate is only decided with a context, which has the plan.
      if (!plan) throw new Error('A plan gate is refused with the plan it was decided on');
      const needs = planName(denial.needs);
      return {
        ...base,
        status: 403,
        rule: {
          kind: 'plan',
          detail: plan.isTrial
            ? t('rule.plan_locked_trial', { needs })
            : t('rule.plan_locked', { needs, current: plan.planName }),
          source: t('source.billing'),
        },
        whoCanRoles: ['admin'],
        whoCan: whoCanText(['admin']),
        nextActions: askOrOwn(role, [
          ...(role === 'admin'
            ? [plan.isTrial ? ('choose_plan' as const) : ('upgrade' as const)]
            : []),
          'compare_plans',
        ]),
        plan: {
          needs: denial.needs,
          current: plan.planId,
          isTrial: plan.isTrial,
          nextPlan: plan.nextPlan,
        },
      };
    }
    case 'forbidden_role': {
      const whoCanRoles = [...denial.roles];
      return {
        ...base,
        status: 403,
        rule: {
          kind: 'role',
          detail: t('rule.forbidden_role', {
            roleName: roleName(denial.role),
            rolePlural: t(`rolesPlural.${denial.role}`),
          }),
          source: t('source.roles'),
        },
        whoCanRoles,
        whoCan: whoCanText(whoCanRoles),
        nextActions: askOrOwn(role, ['see_access']),
      };
    }
  }
}
