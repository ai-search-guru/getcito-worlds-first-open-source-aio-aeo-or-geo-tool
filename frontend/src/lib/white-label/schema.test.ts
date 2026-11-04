// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, LOGO_TYPES, WHITE_LABEL_BUCKET } from './kit';

/**
 * White label's tables as 00429 leaves them: who reads and writes the kit,
 * where a brand's client logo lives, and the private bucket the logos go
 * to. Read from the SQL, as lib/chat/schema.test.ts reads Chat's: the
 * repository has no database tests.
 */

const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
const file = readdirSync(dir).find((name) => name.startsWith('00429_'));
if (!file) throw new Error('No migration 00429');
/** The migration's SQL, without its comments. */
const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');

/** A policy's text, from its name to the end of its statement. */
function policy(name: string): string {
  const m = sql.match(new RegExp(`create policy "${name}"[^;]*;`));
  if (!m) throw new Error(`No policy ${name}`);
  return m[0].replace(/\s+/g, ' ');
}

const MEMBER = 'select p.organization_id from public.profiles p where p.id = auth.uid()';
const ADMIN = `${MEMBER} and p.role = 'admin'::public.user_role`;

describe('the bucket', () => {
  const m = sql.match(
    /insert into storage\.buckets[^;]*?values\s*\(\s*'([^']+)',\s*'[^']+',\s*(true|false),\s*(\d+),\s*array\[([^\]]*)\]/,
  );

  it('is private, takes the app’s logo types and keeps the app’s limit', () => {
    expect(m?.[1]).toBe(WHITE_LABEL_BUCKET);
    expect(m?.[2]).toBe('false');
    expect(Number(m?.[3])).toBe(LOGO_MAX_BYTES);
    expect([...(m?.[4] ?? '').matchAll(/'([^']+)'/g)].map((t) => t[1]).sort()).toEqual(
      Object.keys(LOGO_TYPES).sort(),
    );
  });

  it('gives members no policy on it: the app hands out the addresses', () => {
    expect(sql).not.toMatch(/on storage\.objects/);
  });
});

describe('white_label_kits', () => {
  it('turns row level security on and keeps one kit per workspace', () => {
    expect(sql).toMatch(/alter table public\.white_label_kits enable row level security/);
    expect(sql).toMatch(
      /organization_id uuid primary key references public\.organizations\(id\) on delete cascade/,
    );
  });

  it('lets members read the kit, and only its admins write it', () => {
    expect(policy('white_label_kits: member select')).toContain(
      `using ( organization_id in ( ${MEMBER} ) )`,
    );
    const insert = policy('white_label_kits: admin insert');
    const update = policy('white_label_kits: admin update');
    expect(insert).toContain('for insert');
    expect(insert).toContain(ADMIN);
    expect(update).toContain('for update');
    expect(update.split(ADMIN)).toHaveLength(3);
    // No delete for members, and nothing for anonymous visitors.
    expect(sql).not.toMatch(/create policy[^;]*on public\.white_label_kits\s+for delete/);
    expect(sql).toMatch(
      /grant select, insert, update on table public\.white_label_kits to authenticated;/,
    );
    expect(sql).not.toMatch(/grant [^;]*on table public\.white_label_kits to anon/);
  });

  it('stamps who changed it from the session, so nobody names someone else', () => {
    expect(sql).toMatch(/new\.updated_by := auth\.uid\(\)/);
    expect(sql).toMatch(/before insert or update on public\.white_label_kits/);
  });

  it('keeps the logo in the workspace’s folder, the color as #rrggbb and the words short', () => {
    expect(sql).toContain("starts_with(logo_path, organization_id::text || '/kit/')");
    expect(sql).toContain("accent_color ~ '^#[0-9a-f]{6}$'");
    expect(sql).toContain('char_length(company_name) between 1 and 100');
    expect(sql).toContain('char_length(footer_text) between 1 and 200');
  });
});

describe('brands.client_logo_path', () => {
  it('keeps a brand’s client logo in that brand’s folder', () => {
    expect(sql).toMatch(
      /alter table public\.brands\s+add column if not exists client_logo_path text/,
    );
    expect(sql).toContain(
      "starts_with(client_logo_path, organization_id::text || '/brands/' || id::text || '/')",
    );
  });

  it('follows the brands policies: no policy of its own', () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.brands\b/);
  });
});
