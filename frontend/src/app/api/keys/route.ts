import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateApiKey } from '@/lib/mcpAuth';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, prefix, last_used_at, revoked_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: data ?? [] });
}

/**
 * Open while the workspace is read-only (2026-10-14 decision): a key costs
 * nothing, and on a read-only workspace it only reads — the MCP surface
 * answers subscription_inactive to everything but list_ and get_ tools.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? '').trim().slice(0, 80);
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const { token, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      user_id: user.id,
      name,
      prefix,
      key_hash: hash,
    })
    .select('id, name, prefix, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not create key' }, { status: 500 });
  }

  return NextResponse.json({
    key: { ...data, token },
  });
}
