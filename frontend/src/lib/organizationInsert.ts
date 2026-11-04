import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { slugify } from '@/lib/slug';

/** Postgres' unique_violation: here, a slug another organization already has. */
const UNIQUE_VIOLATION = '23505';

/**
 * Create an organization with the signed-in person's own session, as
 * onboarding does, and return its id. The id is chosen here, so the row isn't
 * read back: the person reads their organization once their profile joins it.
 * A slug that's taken is tried once more with a time suffix.
 */
export async function insertOrganization(
  supabase: SupabaseClient<Database>,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const base = slugify(trimmed) || `org-${Date.now()}`;

  for (const slug of [base, `${base}-${Date.now()}`]) {
    const id = crypto.randomUUID();
    const { error } = await supabase.from('organizations').insert({ id, name: trimmed, slug });
    if (!error) return id;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }
  throw new Error('Failed to create organization');
}
