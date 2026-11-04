import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Authors (CE-037): what the actions write. RLS decides who may
 * change an author or a brand's default; no row back is a refusal.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER = '33333333-3333-4333-8333-333333333333';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: [string, unknown][];
}
let calls: Call[] = [];
/** What a write or read of each table answers. */
let answers: Record<
  string,
  { data: unknown; count?: number; error: null | { message: string; code?: string } }
> = {};

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const answer = () => answers[`${table}.${call.op}`] ?? { data: null, error: null };
  const chain = {
    select: () => chain,
    insert: (row: unknown) => Object.assign(call, { op: 'insert', row }) && chain,
    update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
    upsert: (row: unknown) => Object.assign(call, { op: 'upsert', row }) && chain,
    delete: () => Object.assign(call, { op: 'delete' }) && chain,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      call.filters.push([`is ${column}`, value]);
      return chain;
    },
    order: () => chain,
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: builder,
  })),
}));

const {
  deleteContentAuthor,
  getContentAuthors,
  saveContentAuthor,
  setBrandByline,
  setDefaultAuthor,
} = await import('./contentAuthors');

const writes = () => calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  calls = [];
  answers = {
    'profiles.select': { data: { organization_id: ORG, role: 'analyst' }, error: null },
    'content_authors.insert': { data: { id: ADA }, error: null },
    'content_authors.update': { data: { id: ADA }, error: null },
    'content_authors.delete': { data: [{ id: ADA }], error: null },
  };
});

describe('getContentAuthors', () => {
  it("reads the workspace's authors with the brands each is the default for", async () => {
    answers['content_authors.select'] = {
      data: [
        {
          id: ADA,
          name: 'Ada',
          title: null,
          bio: null,
          photo_url: null,
          same_as: null,
          user_id: ME,
          created_by: OTHER,
        },
      ],
      error: null,
    };
    answers['brands.select'] = {
      data: [{ id: ACME, name: 'Acme', content_byline: true }],
      error: null,
    };
    answers['content_drafts.select'] = { data: null, count: 2, error: null };
    answers['content_author_defaults.select'] = {
      data: [{ brand_id: ACME, author_id: ADA }],
      error: null,
    };
    const read = await getContentAuthors({ pages: true });
    expect(read).toEqual({
      authors: [
        {
          id: ADA,
          name: 'Ada',
          title: null,
          bio: null,
          photoUrl: null,
          sameAs: [],
          userId: ME,
          createdBy: OTHER,
          defaultFor: [ACME],
          pages: 2,
        },
      ],
      brands: [{ id: ACME, name: 'Acme', bylineInContent: true }],
      me: { id: ME, role: 'analyst' },
    });
  });

  it("counts each author's Library pages only when asked", async () => {
    answers['content_authors.select'] = {
      data: [{ id: ADA, name: 'Ada', same_as: [], user_id: null, created_by: null }],
      error: null,
    };
    expect((await getContentAuthors())!.authors[0].pages).toBeNull();
    expect(calls.some((c) => c.table === 'content_drafts')).toBe(false);

    answers['content_drafts.select'] = { data: null, count: 4, error: null };
    expect((await getContentAuthors({ pages: true }))!.authors[0].pages).toBe(4);
    expect(calls.find((c) => c.table === 'content_drafts')!.filters).toEqual([
      ['author_id', ADA],
      ['is archived_at', null],
    ]);
  });

  it('reads nothing for a member without an organization', async () => {
    answers['profiles.select'] = { data: { organization_id: null, role: 'admin' }, error: null };
    expect(await getContentAuthors()).toBeNull();
  });
});

describe('saveContentAuthor', () => {
  it('adds an author to the workspace, as the member when it is them', async () => {
    await saveContentAuthor({
      name: '  Ada Lovelace ',
      title: '',
      sameAs: ['https://x.com/ada', 'https://x.com/ada'],
      isMe: true,
    });
    expect(writes()).toEqual([
      {
        table: 'content_authors',
        op: 'insert',
        row: {
          name: 'Ada Lovelace',
          title: null,
          bio: null,
          photo_url: null,
          same_as: ['https://x.com/ada'],
          user_id: ME,
          organization_id: ORG,
          created_by: ME,
        },
        filters: [],
      },
    ]);
  });

  it('adds someone who is no member without a link', async () => {
    await saveContentAuthor({ name: 'Grace' });
    expect(writes()[0].row).not.toHaveProperty('user_id');
  });

  it('says so when the member is another author already', async () => {
    answers['content_authors.insert'] = {
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    };
    expect(await saveContentAuthor({ name: 'Ada', isMe: true })).toEqual({
      error: 'already_author',
    });
  });

  it('refuses a link that is not https, writing nothing', async () => {
    await expect(saveContentAuthor({ name: 'Ada', sameAs: ['http://x.com/ada'] })).rejects.toThrow(
      'invalid',
    );
    await expect(
      saveContentAuthor({ name: 'Ada', photoUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow('invalid');
    expect(writes()).toEqual([]);
  });

  it("unlinks the member's own author in the same save when they untick it", async () => {
    answers['content_authors.select'] = { data: { user_id: ME }, error: null };
    await saveContentAuthor({ id: ADA, name: 'Ada', isMe: false });
    expect(writes()).toEqual([
      {
        table: 'content_authors',
        op: 'update',
        row: { name: 'Ada', title: null, bio: null, photo_url: null, same_as: [], user_id: null },
        filters: [['id', ADA]],
      },
    ]);
  });

  it("keeps another member's link when an admin saves their author", async () => {
    answers['content_authors.select'] = { data: { user_id: OTHER }, error: null };
    await saveContentAuthor({ id: ADA, name: 'Ada', isMe: false });
    expect(writes()).toHaveLength(1);
    expect(writes()[0].row).not.toHaveProperty('user_id');
  });

  it('fails when RLS lets no row through', async () => {
    answers['content_authors.select'] = { data: { user_id: null }, error: null };
    answers['content_authors.update'] = { data: null, error: null };
    await expect(saveContentAuthor({ id: ADA, name: 'Ada' })).rejects.toThrow('forbidden');
    answers['content_authors.select'] = { data: null, error: null };
    await expect(saveContentAuthor({ id: ADA, name: 'Ada' })).rejects.toThrow('not_found');
  });
});

describe('deleteContentAuthor', () => {
  it('deletes by id, and fails when nothing was deleted', async () => {
    await deleteContentAuthor(ADA);
    expect(writes()).toEqual([{ table: 'content_authors', op: 'delete', filters: [['id', ADA]] }]);
    answers['content_authors.delete'] = { data: [], error: null };
    await expect(deleteContentAuthor(ADA)).rejects.toThrow('forbidden');
    await expect(deleteContentAuthor('nope')).rejects.toThrow('invalid');
  });
});

describe('setDefaultAuthor', () => {
  it("sets a brand's default as the member, or clears it for the team byline", async () => {
    await setDefaultAuthor(ACME, ADA);
    expect(writes()[0]).toMatchObject({
      table: 'content_author_defaults',
      op: 'upsert',
      row: { brand_id: ACME, author_id: ADA, updated_by: ME },
    });
    await setDefaultAuthor(ACME, null);
    expect(writes()[1]).toEqual({
      table: 'content_author_defaults',
      op: 'delete',
      filters: [['brand_id', ACME]],
    });
  });

  it('refuses an id that is not one, and passes a refusal on', async () => {
    await expect(setDefaultAuthor('acme', ADA)).rejects.toThrow('invalid');
    await expect(setDefaultAuthor(ACME, 'ada')).rejects.toThrow('invalid');
    expect(writes()).toEqual([]);
    answers['content_author_defaults.upsert'] = {
      data: null,
      error: { message: 'new row violates row-level security policy' },
    };
    await expect(setDefaultAuthor(ACME, ADA)).rejects.toThrow(/row-level security/);
  });
});

describe('setBrandByline', () => {
  it("turns a brand's Add byline to content on or off, and fails when RLS lets no row through", async () => {
    answers['brands.update'] = { data: [{ id: ACME }], error: null };
    await setBrandByline(ACME, true);
    expect(writes()).toEqual([
      { table: 'brands', op: 'update', row: { content_byline: true }, filters: [['id', ACME]] },
    ]);
    answers['brands.update'] = { data: [], error: null };
    await expect(setBrandByline(ACME, false)).rejects.toThrow('forbidden');
    await expect(setBrandByline('acme', true)).rejects.toThrow('invalid');
    expect(writes()).toHaveLength(2);
  });
});
