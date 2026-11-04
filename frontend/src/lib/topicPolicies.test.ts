import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The row rules on topics and topic_suggestions as every migration leaves
 * them, applied in order: a `create policy` adds one, a `drop policy` takes
 * it away. Read from the migration files, so a later migration that loosens
 * a rule again fails here.
 */
const dir = join(__dirname, '../../../supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

interface Policy {
  command: string;
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
        new RegExp(`^create policy "([^"]+)" ${on}(?:as \\w+ )?(?:for (\\w+))?`, 'i'),
      );
      if (create) {
        policies.set(create[1], { command: (create[2] ?? 'all').toLowerCase(), body: text });
      }
    }
  }
  return policies;
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

describe.each(['topics', 'topic_suggestions'])('%s row rules', (table) => {
  const policies = [...policiesOf(table).values()];

  it('lets every member of the organization read', () => {
    const reads = policies.filter((p) => p.command === 'select');
    expect(reads).toHaveLength(1);
    expect(managersOnly(reads[0].body)).toBe(false);
    expect(reads[0].body).toMatch(/organization_id/);
  });

  it('keeps every change to admins and managers', () => {
    const writes = policies.filter((p) => p.command !== 'select');
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(managersOnly(write.body), write.body).toBe(true);
  });
});

describe('topics row rules', () => {
  it('cover adding, changing and deleting', () => {
    const commands = [...policiesOf('topics').values()].map((p) => p.command).sort();
    expect(commands).toEqual(['delete', 'insert', 'select', 'update']);
  });
});

describe('topic_suggestions row rules', () => {
  it('leave adding and deleting to the server', () => {
    const commands = [...policiesOf('topic_suggestions').values()].map((p) => p.command).sort();
    expect(commands).toEqual(['select', 'update']);
  });
});
