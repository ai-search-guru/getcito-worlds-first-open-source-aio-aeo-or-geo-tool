import { NextResponse } from 'next/server';
import { PLANS } from '@/config/plans';
import { workAreasOf, type WorkAreaId } from '@/lib/menuAccess';
import { createClient } from '@/lib/supabase/server';
import { modeDenial } from '../agentRules';
import { readAgentContext, type AgentContext } from '../agents';
import { planGateLock } from '../planFacts';
import { chatActor } from '../runApi';
import { AGENT_PRESETS, FULL_AUTO_PLAN, presetGate, type PresetLock } from './catalog';

/**
 * What Agent Center's Ready to use cards say about the workspace's plan
 * (AGENTS plan §5): a ready preset whose mode the plan keeps closed shows
 * the plan it needs and the one the workspace is on, by planGateLock as
 * Chat's tools are gated; one an Admin turned off in Settings › Chat says
 * so. Plan names only, never a price. Server only: the plan facts hold the
 * AI budgets.
 */

export function presetLocksFor(
  ctx: Pick<AgentContext, 'plan' | 'settings' | 'viewer'>,
): Record<string, PresetLock> {
  const locks: Record<string, PresetLock> = {};
  for (const preset of AGENT_PRESETS) {
    if (preset.status !== 'ready') continue;
    const needs = planGateLock(ctx.plan, presetGate(preset));
    const denial = modeDenial(preset.mode, ctx.plan, ctx.settings, ctx.viewer.role);
    if (needs || denial?.denial.code === 'plan_locked') {
      locks[preset.id] = {
        kind: 'plan',
        plan: PLANS[needs ?? FULL_AUTO_PLAN].name,
        current: ctx.plan.planName,
      };
    } else if (denial) {
      locks[preset.id] = { kind: 'policy' };
    }
  }
  return locks;
}

/** The signed-in person's locks; none when they can't be read (New agent checks again). */
export async function readPresetLocks(): Promise<Record<string, PresetLock>> {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return {};
    const ctx = await readAgentContext(actor);
    return ctx ? presetLocksFor(ctx) : {};
  } catch (err) {
    console.error('[chat/agents] could not read the ready-to-use agents’ plan locks:', err);
    return {};
  }
}

/**
 * The signed-in person's work areas (Settings › Menu access, 00374): the
 * Ready to use cards made for them come first, marked For your role. None
 * when they can't be read; the cards then keep the catalog's order.
 */
export async function readMyWorkAreas(): Promise<WorkAreaId[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('work_areas')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return workAreasOf((data?.work_areas as string[] | null | undefined) ?? null);
  } catch (err) {
    console.error('[chat/agents] could not read the person’s work areas:', err);
    return [];
  }
}
