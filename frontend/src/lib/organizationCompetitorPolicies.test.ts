import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The row rules on organizations and competitors as every migration leaves
 * them, applied in order: a `create policy` adds one, a `drop policy` takes
 * it away. Read from the migration files, so a later migration that loosens
 * a rule again fails here (as topicPolicies.test.ts does for topics).
 */
const dir = join(__dirname, '../../../supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

interface Policy {
  command: string;
  roles: string;
  body: string;
}

function policiesOf(table: string): Map<string, Policy> {
  const policies = new Map<string, Policy>();
  const on = `on\\s+(?:"?public"?\\.)?"?${table}"?(?:\\s|$)`;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';')) {
      const text = statement.replace(/\s+/g, ' ').trim();
      const drop = text.match(new RegExp(`^drop policy (?:if exists )?"([^"]+)" ${on}`, 'i'));
      if (drop) policies.delete(drop[1]);
      const create = text.match(
        new RegExp(
          `^create policy "([^"]+)" ${on}(?:as \\w+ )?(?:for (\\w+) ?)?(?:to ([\\w", ]+?) (?=using|with))?`,
          'i',
        ),
      );
      if (create) {
        policies.set(create[1], {
          command: (create[2] ?? 'all').toLowerCase(),
          roles: (create[3] ?? 'public').replace(/"/g, '').toLowerCase(),
          body: text,
        });
      }
    }
  }
  return policies;
}

/** Whether the last grant statement on organizations for anon is a revoke. */
function anonLastGrant(): 'grant' | 'revoke' | null {
  let last: 'grant' | 'revoke' | null = null;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';')) {
      const text = statement.replace(/\s+/g, ' ').trim().toLowerCase();
      const m = text.match(
        /^(grant|revoke) [\w, ]+ on (?:table )?(?:"?public"?\.)?"?organizations"? (?:to|from) ([\w", ]+)$/,
      );
      if (m && m[2].replace(/"/g, '').split(/,\s*/).includes('anon')) {
        last = m[1] as 'grant' | 'revoke';
      }
    }
  }
  return last;
}

/** Only an admin or a manager of the brand's organization passes the rule. */
const managersOnly = (body: string) => {
  const roles = [...body.matchAll(/'(admin|manager|analyst|agency_partner|viewer)'/g)].map(
    (m) => m[1],
  );
  return (
    /auth"?\."?uid/.test(body) &&
    roles.length > 0 &&
    roles.every((r) => r === 'admin' || r === 'manager')
  );
};

describe('organizations row rules', () => {
  const policies = [...policiesOf('organizations').values()];

  it('let a signed-in person read only the organization their profile belongs to', () => {
    const reads = policies.filter((p) => p.command === 'select');
    expect(reads).toHaveLength(1);
    expect(reads[0].roles).toBe('authenticated');
    expect(reads[0].body).toMatch(/organization_id/);
    expect(reads[0].body).toMatch(/auth"?\."?uid/);
    expect(reads[0].body).not.toMatch(/\bor\b/i);
    expect(reads[0].body).not.toMatch(/not exists/i);
  });

  it('apply to signed-in people only', () => {
    for (const policy of policies) expect(policy.roles, policy.body).toBe('authenticated');
  });

  it('leave the anon role without access', () => {
    expect(anonLastGrant()).toBe('revoke');
  });
});

describe('competitors row rules', () => {
  const policies = [...policiesOf('competitors').values()];

  it('let every member of the organization read', () => {
    const reads = policies.filter((p) => p.command === 'select');
    expect(reads).toHaveLength(1);
    expect(managersOnly(reads[0].body)).toBe(false);
    expect(reads[0].body).toMatch(/organization_id/);
  });

  it('keep every change to admins and managers', () => {
    const writes = policies.filter((p) => p.command !== 'select');
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(managersOnly(write.body), write.body).toBe(true);
  });

  it('cover adding, changing and deleting', () => {
    expect(policies.map((p) => p.command).sort()).toEqual(['delete', 'insert', 'select', 'update']);
  });
});
