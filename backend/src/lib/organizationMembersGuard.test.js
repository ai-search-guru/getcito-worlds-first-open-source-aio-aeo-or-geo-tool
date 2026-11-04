import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * organization_has_other_members (00228) is how the profile guard checks that
 * a person's first organization has nobody else in it yet. It reads every
 * organization's members (security definer), and signed-in people can call
 * it, so on its own it answered "does this organization have other members?"
 * about anyone's organization. Since 00437 it answers only inside a trigger
 * (the guard) or for the service role. Read from the SQL, as the other
 * migration tests here do: the repository has no database tests.
 */

const dir = new URL('../../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** A migration's SQL without its comments, on one line. */
const read = (file) =>
  readFileSync(new URL(file, dir), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The last definition of a function, across every migration: its header and body. */
function lastFunction(name) {
  let last = null;
  const definition = new RegExp(
    `create (?:or replace )?function "?public"?\\."?${name}"?\\s*\\(([^$]*?)\\$\\$(.*?)\\$\\$`,
    'gi',
  );
  for (const file of files) {
    for (const m of read(file).matchAll(definition)) {
      last = { file, header: m[1].toLowerCase(), body: m[2] };
    }
  }
  if (!last) throw new Error(`No function ${name}`);
  return last;
}

/** Every grant and revoke on a function, in migration order. */
function privilegesOf(name) {
  const on = new RegExp(`^(grant|revoke) .* on function public\\.${name}\\(uuid, uuid\\)`, 'i');
  return files.flatMap((file) =>
    read(file)
      .split(';')
      .map((text) => text.trim())
      .filter((text) => on.test(text)),
  );
}

describe('organization_has_other_members', () => {
  const fn = lastFunction('organization_has_other_members');

  it('answers only inside a trigger or for the service role', () => {
    expect(fn.body).toMatch(
      /and \(pg_catalog\.pg_trigger_depth\(\) > 0 or \(select auth\.role\(\)\) = 'service_role'\)/,
    );
  });

  it('still counts the organization’s other members, as 00228 did', () => {
    expect(fn.body).toMatch(
      /^ ?select exists \( select 1 from public\.profiles p where p\.organization_id = p_org and p\.id <> p_except /,
    );
    expect(fn.header).toMatch(/returns boolean language sql stable security definer/);
    expect(fn.header).toMatch(/set search_path = ''/);
  });

  it('stays callable by signed-in people (the guard runs as them) and not by anon', () => {
    const last = privilegesOf('organization_has_other_members').slice(-2);
    expect(last[0]).toMatch(/^revoke all on function .* from public, anon$/i);
    expect(last[1]).toMatch(/^grant execute on function .* to authenticated, service_role$/i);
  });

  it('is still what the profile guard asks, as the person, from its trigger', () => {
    const guard = lastFunction('guard_profile_server_columns');
    expect(guard.header).toMatch(/returns trigger/);
    expect(guard.header).not.toMatch(/security definer/);
    expect(guard.body).toMatch(
      /or public\.organization_has_other_members\(new\.organization_id, new\.id\)/,
    );
  });
});
