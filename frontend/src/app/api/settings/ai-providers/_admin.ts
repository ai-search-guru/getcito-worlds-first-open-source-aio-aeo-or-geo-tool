import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Who calls /api/settings/ai-providers and its Test: the signed-in person
 * with their organization; a change needs an admin.
 */

export async function getCallerAndOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) return { error: 'No organization' as const };

  return {
    user,
    profile: profile as { id: string; role: string; organization_id: string },
  };
}

export type Caller = Exclude<Awaited<ReturnType<typeof getCallerAndOrg>>, { error: string }>;

/** The caller when they may change the keys, or the response that says why not. */
export async function getAdmin(): Promise<Caller | NextResponse> {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }
  if (ctx.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can manage AI provider keys' }, { status: 403 });
  }
  return ctx;
}
