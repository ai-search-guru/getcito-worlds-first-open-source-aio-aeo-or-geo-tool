import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * How the server writes who sees which brands (BRAND-ACCESS PR 12, 00471),
 * read from the SQL as the other migration tests here are: accepting an
 * invitation joins the person with its role and brands in one transaction,
 * and an admin's Edit brands replaces a person's brands in one. Both are
 * the server's only.
 */

const sql = readFileSync(
  new URL('../../../supabase/migrations/00471_brand_access_team.sql', import.meta.url),
  'utf8',
)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ');

/** A function's header and body. */
function fn(name) {
  const m = sql.match(
    new RegExp(`create or replace function public\\.${name}\\(([^$]*?)\\$\\$(.*?)\\$\\$`, 'i'),
  );
  if (!m) throw new Error(`No function ${name}`);
  return { header: m[1], body: m[2] };
}

describe.each([
  ['accept_invitation', 'uuid, uuid'],
  ['set_member_brand_access', 'uuid, uuid, text, uuid\\[\\], uuid'],
])('%s', (name, args) => {
  it('runs as the server, which alone may call it', () => {
    const { header } = fn(name);
    expect(header).toMatch(/security invoker set search_path = ''/);
    expect(sql).toMatch(
      new RegExp(
        `revoke all on function public\\.${name}\\(${args}\\) from public, anon, authenticated`,
      ),
    );
    expect(sql).toMatch(
      new RegExp(`grant execute on function public\\.${name}\\(${args}\\) to service_role`),
    );
  });
});

describe('accept_invitation', () => {
  const { body } = fn('accept_invitation');

  it('takes only a pending, unexpired invitation, locked while it is used', () => {
    expect(body).toMatch(/from public\.invitations i where i\.id = p_invitation_id for update/);
    expect(body).toMatch(
      /if v_invitation\.status <> 'pending' or v_invitation\.expires_at < now\(\) then raise exception/,
    );
  });

  it('writes the brand scope with the role, never leaving it to the default', () => {
    expect(body).toMatch(
      /update public\.profiles set organization_id = v_invitation\.organization_id, role = v_invitation\.role, brand_scope = v_invitation\.brand_scope, onboarding_completed = true where id = p_user_id/,
    );
  });

  it('shares the brands named that still are the organization’s, after the person joined', () => {
    expect(body).toMatch(
      /insert into public\.member_brands \(organization_id, user_id, brand_id, granted_by\) select v_invitation\.organization_id, p_user_id, b\.id, v_invitation\.invited_by from public\.brands b where b\.id = any \(v_invitation\.brand_ids\) and b\.organization_id = v_invitation\.organization_id and not b\.is_demo/,
    );
    expect(body.indexOf('update public.profiles')).toBeLessThan(
      body.indexOf('insert into public.member_brands'),
    );
  });

  it('marks the invitation accepted in the same transaction', () => {
    expect(body).toMatch(
      /update public\.invitations set status = 'accepted', accepted_at = now\(\) where id = p_invitation_id/,
    );
  });
});

describe('set_member_brand_access', () => {
  const { body } = fn('set_member_brand_access');

  it('locks the person in the organization, and never narrows an admin', () => {
    expect(body).toMatch(
      /from public\.profiles p where p\.id = p_user_id and p\.organization_id = p_organization_id for update/,
    );
    expect(body).toMatch(/if v_role = 'admin' and p_brand_scope = 'selected' then raise exception/);
  });

  it('keeps exactly the organization’s brands named, at least one', () => {
    expect(body).toMatch(
      /where b\.id = any \(coalesce\(p_brand_ids, '\{\}'\)\) and b\.organization_id = p_organization_id and not b\.is_demo/,
    );
    expect(body).toMatch(/if cardinality\(v_brand_ids\) = 0 then raise exception/);
    expect(body).toMatch(
      /delete from public\.member_brands mb where mb\.user_id = p_user_id and not \(mb\.brand_id = any \(v_brand_ids\)\)/,
    );
    expect(body).toMatch(/on conflict \(user_id, brand_id\) do nothing/);
  });

  it('drops the shared brands for All brands', () => {
    expect(body).toMatch(
      /if p_brand_scope = 'all' then delete from public\.member_brands mb where mb\.user_id = p_user_id; return '\{\}'; end if;/,
    );
  });
});
