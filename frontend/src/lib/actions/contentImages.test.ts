import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Who may upload an image and how much (00272): the app's gate, not the bucket's. */

let user: { id: string } | null;
let profile: { organization_id: string } | null;
let org: { subscription_status: string } | null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : org, error: null }),
      };
      return chain;
    },
  }),
}));
/** content_image_uploads: the addresses given. */
type Given = { id: string; organization_id: string; path: string; created_at: string };
let given: Given[];
let noteFails: boolean;
const uploadsTable = {
  insert: (row: { organization_id: string; path: string }) => ({
    select: () => ({
      single: async () => {
        if (noteFails) return { data: null, error: { message: 'down' } };
        const kept = { id: `g${given.length + 1}`, created_at: new Date().toISOString(), ...row };
        given.push(kept);
        return { data: { id: kept.id }, error: null };
      },
    }),
  }),
  select: () => {
    let org = '';
    const chain = {
      eq: (_column: string, value: string) => ((org = value), chain),
      gt: async (_column: string, since: string) => ({
        count: given.filter((g) => g.organization_id === org && g.created_at > since).length,
        error: null,
      }),
    };
    return chain;
  },
  delete: () => ({
    eq: (column: 'id' | 'organization_id', value: string) => {
      const drop = (gone: (g: Given) => boolean) => {
        given = given.filter((g) => !gone(g));
        return { error: null };
      };
      return {
        lt: async (_column: string, before: string) =>
          drop((g) => g.organization_id === value && g.created_at < before),
        then: (resolve: (result: unknown) => void) => resolve(drop((g) => g[column] === value)),
      };
    },
  }),
};
const createSignedUploadUrl = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => uploadsTable,
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (...args: unknown[]) => createSignedUploadUrl(bucket, ...args),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://store.example/public/${bucket}/${path}` },
        }),
      }),
    },
  },
}));
let cloud: boolean;
vi.mock('@/config/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/plans')>()),
  isCloud: () => cloud,
}));

const { prepareImageUpload } = await import('./contentImages');
const { IMAGE_UPLOADS_PER_DAY } = await import('@/lib/content/imageUploadTypes');

/** Addresses given to org-1, `count` of them, each `hoursAgo` old. */
const givenBefore = (count: number, hoursAgo: number): Given[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `old${hoursAgo}-${i}`,
    organization_id: 'org-1',
    path: `org-1/${i}.png`,
    created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  }));

beforeEach(() => {
  user = { id: 'u1' };
  profile = { organization_id: 'org-1' };
  org = { subscription_status: 'active' };
  cloud = true;
  given = [];
  noteFails = false;
  createSignedUploadUrl.mockReset().mockImplementation(async (_bucket: string, path: string) => ({
    data: { path, token: 'tok', signedUrl: 'https://store.example/sign' },
    error: null,
  }));
});

describe('prepareImageUpload', () => {
  it("names the image in its organization's folder, and gives a one-time address for it", async () => {
    const ticket = await prepareImageUpload('image/webp');
    expect(ticket).toEqual({
      path: expect.stringMatching(/^org-1\/[0-9a-f-]{36}\.webp$/),
      token: 'tok',
      url: expect.stringMatching(/^https:\/\/store\.example\/public\/content-images\/org-1\//),
    });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      'content-images',
      (ticket as { path: string }).path,
    );
  });

  it('takes only the bucket’s types', async () => {
    expect(await prepareImageUpload('image/svg+xml')).toEqual({ error: 'type' });
    expect(await prepareImageUpload('constructor')).toEqual({ error: 'type' });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('needs an active or trialing subscription on the cloud', async () => {
    org = { subscription_status: 'canceled' };
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'plan' });
    org = { subscription_status: 'trialing' };
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
  });

  it('counts each address given on the cloud, so asking in a loop stops at the day’s cap', async () => {
    given = givenBefore(IMAGE_UPLOADS_PER_DAY - 1, 1);
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
    expect(given).toHaveLength(IMAGE_UPLOADS_PER_DAY);
    // Not yet used, it counts: the next one is refused, and isn't kept.
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'limit' });
    expect(given).toHaveLength(IMAGE_UPLOADS_PER_DAY);
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it('leaves out, and clears, the addresses given more than a day ago', async () => {
    given = givenBefore(IMAGE_UPLOADS_PER_DAY, 25);
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
    expect(given).toHaveLength(1);
  });

  it('has no limits on a self-host', async () => {
    cloud = false;
    org = null;
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
    expect(given).toEqual([]);
  });

  it('fails with no session or organization, or when storage does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    user = null;
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    user = { id: 'u1' };
    profile = null;
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    profile = { organization_id: 'org-1' };
    noteFails = true;
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    noteFails = false;
    createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    error.mockRestore();
  });
});
