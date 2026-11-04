'use server';

import { z } from 'zod';
import { authorInput, type AuthorInput, type AuthorsRead } from '@/lib/content/authors';
import { readContentAuthors } from '@/lib/content/authorsRead';
import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * Settings › Authors (Content Editor Quality spec §9, CE-037): the real
 * people a page is by, in the workspace (content_authors, 00256). Anyone
 * adds one; whoever added it, the author themself or an admin edits or
 * deletes it (RLS); only a member links or unlinks themself; admins and
 * managers set each brand's default. The Content Agent never writes them.
 */

/** The member is another author already (content_authors_member, a unique violation). */
const ALREADY_AUTHOR = '23505';

/**
 * The workspace's authors, its brands and the member reading; null when
 * signed out. `pages` counts each author's pages (Settings' column); the
 * editor doesn't need it.
 */
export async function getContentAuthors(
  options: { pages?: boolean } = {},
): Promise<AuthorsRead | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.organization_id) return null;

  return readContentAuthors(supabase, profile.organization_id, {
    me: { id: auth.user.id, role: profile.role ?? 'analyst' },
    pages: options.pages,
  });
}

/**
 * Adds an author, or saves one the member may edit; its id. `isMe` links the
 * author to the member, and unticked unlinks it when it was them; another
 * member's link stays.
 */
export async function saveContentAuthor(
  input: AuthorInput,
): Promise<{ id: string } | { error: 'already_author' }> {
  await assertWritable();
  const parsed = authorInput.safeParse(input);
  if (!parsed.success) throw new Error('invalid');
  const { id, name, title, bio, photoUrl, sameAs, isMe } = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('not_found');
  const values = {
    name,
    title: title || null,
    bio: bio || null,
    photo_url: photoUrl || null,
    same_as: [...new Set(sameAs)],
  };
  if (id) {
    const { data: current, error: readError } = await supabase
      .from('content_authors')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error('not_found');
    const link = isMe
      ? { user_id: auth.user.id }
      : current.user_id === auth.user.id
        ? { user_id: null }
        : {};
    // RLS lets whoever added it, the author or an admin through; no row back is a refusal.
    const { data, error } = await supabase
      .from('content_authors')
      .update({ ...values, ...link })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error?.code === ALREADY_AUTHOR) return { error: 'already_author' };
    if (error) throw new Error(error.message);
    if (!data) throw new Error('forbidden');
    return { id: data.id };
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.organization_id) throw new Error('not_found');
  const { data, error } = await supabase
    .from('content_authors')
    .insert({
      ...values,
      ...(isMe ? { user_id: auth.user.id } : {}),
      organization_id: profile.organization_id,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error?.code === ALREADY_AUTHOR) return { error: 'already_author' };
  if (error) throw new Error(error.message);
  return { id: data.id };
}

/** Deletes an author the member may delete: one they added or are, or any as an admin. */
export async function deleteContentAuthor(id: string): Promise<void> {
  await assertWritable();
  if (!z.guid().safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.from('content_authors').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}

/**
 * Add byline to content (Quality spec §9, CE-057): a brand whose CMS has
 * no author field puts one byline line under the H1 in its exports. Admins
 * and managers (brands: admin/manager update); a brand they can't change
 * is refused.
 */
export async function setBrandByline(brandId: string, on: boolean): Promise<void> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || typeof on !== 'boolean') throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ content_byline: on })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}

/** A brand's default author, or none (the organization byline): admins and managers. */
export async function setDefaultAuthor(brandId: string, authorId: string | null): Promise<void> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || (authorId && !z.guid().safeParse(authorId).success)) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('not_found');
  const { error } = authorId
    ? await supabase.from('content_author_defaults').upsert(
        {
          brand_id: brandId,
          author_id: authorId,
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id' },
      )
    : await supabase.from('content_author_defaults').delete().eq('brand_id', brandId);
  if (error) throw new Error(error.message);
}
