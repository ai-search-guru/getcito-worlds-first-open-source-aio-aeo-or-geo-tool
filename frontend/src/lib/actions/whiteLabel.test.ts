// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, type PlanId } from '@/config/plans';

/**
 * White label's actions (00429): who may change the kit and a brand's client
 * logo, on which plan, what a logo must be, and the read-only refusal.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const BRAND = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

let user: { id: string } | null;
let profile: { organization_id: string; role: string } | null;
let kit: Record<string, unknown> | null;
let brand: { organization_id: string; client_logo_path: string | null; is_demo: boolean } | null;
let planId: PlanId;
let upserts: { table: string; row: Record<string, unknown> }[];
let updates: { table: string; row: Record<string, unknown>; id: string }[];
let writeError: { message: string } | null;
/** The objects in the bucket, by path. */
let objects: Map<string, Uint8Array>;
let removed: string[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const read = () => {
        if (table === 'profiles') return profile;
        if (table === 'white_label_kits') return kit;
        if (table === 'brands') return brand;
        return null;
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: read(), error: null }),
      };
      return {
        ...chain,
        upsert: async (row: Record<string, unknown>) => {
          upserts.push({ table, row });
          return { error: writeError };
        },
        update: (row: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            updates.push({ table, row, id });
            return { error: writeError };
          },
        }),
      };
    },
  }),
}));

const createSignedUploadUrl = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { full_name: 'Ada Admin' }, error: null }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: (path: string) => createSignedUploadUrl(path),
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://store.example/sign/${path}` },
          error: null,
        }),
        download: async (path: string) => {
          const bytes = objects.get(path);
          return bytes
            ? { data: new Blob([bytes as BlobPart]), error: null }
            : { data: null, error: { message: 'not found' } };
        },
        remove: async (paths: string[]) => {
          removed.push(...paths);
          paths.forEach((p) => objects.delete(p));
          return { error: null };
        },
      }),
    },
  },
}));

vi.mock('@/lib/guards/planGuard', () => ({
  getOrgPlan: async () => PLANS[planId],
}));

const assertWritable = vi.hoisted(() => vi.fn());
vi.mock('@/lib/subscriptionGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscriptionGuard')>()),
  assertWritable,
}));

const { SubscriptionInactiveError, DemoBrandError } = await import('@/lib/subscriptionGuard');
const actions = await import('./whiteLabel');

const kitLogo = `${ORG}/kit/${ID}.png`;
const clientLogo = `${ORG}/brands/${BRAND}/${ID}.png`;

beforeEach(() => {
  user = { id: 'u1' };
  profile = { organization_id: ORG, role: 'admin' };
  kit = null;
  brand = { organization_id: ORG, client_logo_path: null, is_demo: false };
  planId = 'growth';
  upserts = [];
  updates = [];
  writeError = null;
  objects = new Map([
    [kitLogo, PNG],
    [clientLogo, PNG],
  ]);
  removed = [];
  assertWritable.mockReset().mockResolvedValue(undefined);
  createSignedUploadUrl.mockReset().mockImplementation(async (path: string) => ({
    data: { path, token: 'tok' },
    error: null,
  }));
});

describe('getWhiteLabelSettings', () => {
  it('shows the kit with a signed logo address, who changed it, and that it is in use', async () => {
    kit = {
      company_name: 'Acme Agency',
      accent_color: '#1d4ed8',
      footer_text: 'acme.com',
      logo_path: kitLogo,
      updated_at: '2026-10-31T09:00:00Z',
      updated_by: 'u1',
    };
    const read = await actions.getWhiteLabelSettings();
    expect(read).toEqual({
      ok: true,
      view: {
        available: true,
        requiredPlan: 'growth',
        canEdit: true,
        inUse: true,
        companyName: 'Acme Agency',
        accentColor: '#1d4ed8',
        footerText: 'acme.com',
        logoUrl: `https://store.example/sign/${kitLogo}`,
        updatedAt: '2026-10-31T09:00:00Z',
        updatedByName: 'Ada Admin',
      },
    });
  });

  it('locks it on Starter, names Growth, and lets only an admin change it', async () => {
    planId = 'starter';
    profile = { organization_id: ORG, role: 'manager' };
    kit = { company_name: 'Acme Agency', logo_path: null };
    const read = await actions.getWhiteLabelSettings();
    expect(read.ok && read.view).toMatchObject({
      available: false,
      requiredPlan: 'growth',
      canEdit: false,
      inUse: false,
    });
  });

  it('says it failed when no one is signed in', async () => {
    user = null;
    expect(await actions.getWhiteLabelSettings()).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('saveWhiteLabelKit', () => {
  const input = { companyName: ' Acme Agency ', accentColor: '#1D4ED8', footerText: '' };

  it('saves the kit for an admin on Growth, through their session', async () => {
    expect(await actions.saveWhiteLabelKit(input)).toEqual({ ok: true });
    expect(assertWritable).toHaveBeenCalledWith();
    expect(upserts).toEqual([
      {
        table: 'white_label_kits',
        row: {
          organization_id: ORG,
          company_name: 'Acme Agency',
          accent_color: '#1d4ed8',
          footer_text: null,
        },
      },
    ]);
  });

  it('refuses a manager or an analyst', async () => {
    for (const role of ['manager', 'analyst']) {
      profile = { organization_id: ORG, role };
      expect(await actions.saveWhiteLabelKit(input), role).toEqual({
        ok: false,
        failure: 'forbidden',
      });
    }
    expect(upserts).toEqual([]);
  });

  it('is locked on Starter', async () => {
    planId = 'starter';
    expect(await actions.saveWhiteLabelKit(input)).toEqual({ ok: false, failure: 'locked' });
    expect(upserts).toEqual([]);
  });

  it('refuses a color it can’t read or a name too long', async () => {
    expect(await actions.saveWhiteLabelKit({ ...input, accentColor: 'blue' })).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(await actions.saveWhiteLabelKit({ ...input, companyName: 'x'.repeat(101) })).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(upserts).toEqual([]);
  });

  it('answers read_only while the workspace is read-only, before anything else', async () => {
    assertWritable.mockRejectedValue(new SubscriptionInactiveError());
    expect(await actions.saveWhiteLabelKit(input)).toEqual({ ok: false, failure: 'read_only' });
    expect(upserts).toEqual([]);
  });

  it('says it failed when the write fails', async () => {
    writeError = { message: 'down' };
    expect(await actions.saveWhiteLabelKit(input)).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('the workspace’s logo', () => {
  it('gives an admin a one-time address in the workspace’s kit folder', async () => {
    const ticket = await actions.prepareWhiteLabelLogoUpload('image/svg+xml', 2_000);
    expect(ticket).toEqual({
      ok: true,
      path: expect.stringMatching(new RegExp(`^${ORG}/kit/[0-9a-f-]{36}\\.svg$`)),
      token: 'tok',
    });
  });

  it('gives none for a type or size the bucket doesn’t take, to a non-admin, or on Starter', async () => {
    expect(await actions.prepareWhiteLabelLogoUpload('image/gif', 2_000)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(await actions.prepareWhiteLabelLogoUpload('image/png', 2 * 1024 * 1024)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    profile = { organization_id: ORG, role: 'manager' };
    expect(await actions.prepareWhiteLabelLogoUpload('image/png', 2_000)).toEqual({
      ok: false,
      failure: 'forbidden',
    });
    profile = { organization_id: ORG, role: 'admin' };
    planId = 'starter';
    expect(await actions.prepareWhiteLabelLogoUpload('image/png', 2_000)).toEqual({
      ok: false,
      failure: 'locked',
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('sets the uploaded logo and deletes the one it replaces', async () => {
    const old = `${ORG}/kit/44444444-4444-4444-8444-444444444444.png`;
    kit = { logo_path: old };
    expect(await actions.setWhiteLabelLogo(kitLogo)).toEqual({ ok: true });
    expect(upserts).toEqual([
      { table: 'white_label_kits', row: { organization_id: ORG, logo_path: kitLogo } },
    ]);
    expect(removed).toEqual([old]);
  });

  it('removes the logo', async () => {
    kit = { logo_path: kitLogo };
    expect(await actions.setWhiteLabelLogo(null)).toEqual({ ok: true });
    expect(upserts[0].row).toEqual({ organization_id: ORG, logo_path: null });
    expect(removed).toEqual([kitLogo]);
  });

  it('refuses a path outside the workspace’s folder, one that never arrived, or bytes that aren’t a logo', async () => {
    expect(await actions.setWhiteLabelLogo(`${OTHER_ORG}/kit/${ID}.png`)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(
      await actions.setWhiteLabelLogo(`${ORG}/kit/55555555-5555-4555-8555-555555555555.png`),
    ).toEqual({ ok: false, failure: 'invalid' });
    const svg = `${ORG}/kit/${ID}.svg`;
    objects.set(svg, new TextEncoder().encode('<svg onload="alert(1)"></svg>'));
    expect(await actions.setWhiteLabelLogo(svg)).toEqual({ ok: false, failure: 'invalid' });
    // What isn't a logo is deleted.
    expect(removed).toEqual([svg]);
    expect(upserts).toEqual([]);
  });
});

describe('a brand’s client logo', () => {
  it('lets an admin or a manager see they may change it', async () => {
    profile = { organization_id: ORG, role: 'manager' };
    brand = { organization_id: ORG, client_logo_path: clientLogo, is_demo: false };
    expect(await actions.getBrandClientLogo(BRAND)).toEqual({
      ok: true,
      view: {
        available: true,
        requiredPlan: 'growth',
        canEdit: true,
        logoUrl: `https://store.example/sign/${clientLogo}`,
      },
    });
    profile = { organization_id: ORG, role: 'analyst' };
    const read = await actions.getBrandClientLogo(BRAND);
    expect(read.ok && read.view.canEdit).toBe(false);
  });

  it('gives a manager a one-time address in the brand’s folder, after the brand’s check', async () => {
    profile = { organization_id: ORG, role: 'manager' };
    const ticket = await actions.prepareBrandClientLogoUpload(BRAND, 'image/jpeg', 2_000);
    expect(ticket).toEqual({
      ok: true,
      path: expect.stringMatching(new RegExp(`^${ORG}/brands/${BRAND}/[0-9a-f-]{36}\\.jpg$`)),
      token: 'tok',
    });
    expect(assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
  });

  it('sets it through the person’s session and deletes the one it replaces', async () => {
    const old = `${ORG}/brands/${BRAND}/44444444-4444-4444-8444-444444444444.png`;
    brand = { organization_id: ORG, client_logo_path: old, is_demo: false };
    expect(await actions.setBrandClientLogo(BRAND, clientLogo)).toEqual({ ok: true });
    expect(updates).toEqual([
      { table: 'brands', row: { client_logo_path: clientLogo }, id: BRAND },
    ]);
    expect(removed).toEqual([old]);
  });

  it('refuses an analyst, a brand they can’t see, the demo brand and Starter', async () => {
    profile = { organization_id: ORG, role: 'analyst' };
    expect(await actions.setBrandClientLogo(BRAND, clientLogo)).toEqual({
      ok: false,
      failure: 'forbidden',
    });
    profile = { organization_id: ORG, role: 'admin' };
    brand = null;
    expect(await actions.setBrandClientLogo(BRAND, clientLogo)).toEqual({
      ok: false,
      failure: 'forbidden',
    });
    brand = { organization_id: ORG, client_logo_path: null, is_demo: false };
    assertWritable.mockRejectedValueOnce(new DemoBrandError());
    expect(await actions.setBrandClientLogo(BRAND, clientLogo)).toEqual({
      ok: false,
      failure: 'demo',
    });
    planId = 'starter';
    expect(await actions.setBrandClientLogo(BRAND, clientLogo)).toEqual({
      ok: false,
      failure: 'locked',
    });
    expect(updates).toEqual([]);
  });

  it('refuses a logo in another brand’s folder, and a brand id that isn’t one', async () => {
    expect(await actions.setBrandClientLogo(BRAND, `${ORG}/brands/${ID}/${ID}.png`)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(await actions.setBrandClientLogo('not-a-brand', null)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    expect(updates).toEqual([]);
  });
});

describe('getReportBranding', () => {
  const dataUrl = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

  it('gives none on Starter, without a kit, or with a kit that has neither a name nor a logo', async () => {
    planId = 'starter';
    kit = { company_name: 'Acme Agency', logo_path: null };
    expect(await actions.getReportBranding(BRAND)).toEqual({ ok: true, branding: null });
    planId = 'growth';
    kit = null;
    expect(await actions.getReportBranding(BRAND)).toEqual({ ok: true, branding: null });
    kit = { company_name: null, logo_path: null, accent_color: '#1d4ed8', footer_text: 'x' };
    expect(await actions.getReportBranding(BRAND)).toEqual({ ok: true, branding: null });
  });

  it('gives the kit in use, with its logo and the brand’s client logo as the images themselves', async () => {
    kit = {
      company_name: 'Acme Agency',
      accent_color: '#1d4ed8',
      footer_text: 'acme.com',
      logo_path: kitLogo,
    };
    brand = { organization_id: ORG, client_logo_path: clientLogo, is_demo: false };
    expect(await actions.getReportBranding(BRAND)).toEqual({
      ok: true,
      branding: {
        companyName: 'Acme Agency',
        accentColor: '#1d4ed8',
        footerText: 'acme.com',
        logo: dataUrl,
        clientLogo: dataUrl,
      },
    });
  });

  it('fails, rather than giving GetCito’s look, when a logo can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    kit = { company_name: 'Acme Agency', logo_path: `${ORG}/kit/${OTHER_ORG}.png` };
    expect(await actions.getReportBranding(BRAND)).toEqual({ ok: false, failure: 'failed' });
    expect(await actions.getReportBranding('not-a-brand')).toEqual({
      ok: false,
      failure: 'failed',
    });
  });
});

describe('getExportBranding', () => {
  it('gives the company while the kit is in use, and none on Starter or without a kit', async () => {
    kit = { company_name: 'Acme Agency', logo_path: null };
    expect(await actions.getExportBranding()).toEqual({
      ok: true,
      branding: { companyName: 'Acme Agency' },
    });
    kit = { company_name: null, logo_path: kitLogo };
    expect(await actions.getExportBranding()).toEqual({
      ok: true,
      branding: { companyName: null },
    });
    kit = { company_name: null, logo_path: null };
    expect(await actions.getExportBranding()).toEqual({ ok: true, branding: null });
    planId = 'starter';
    kit = { company_name: 'Acme Agency', logo_path: null };
    expect(await actions.getExportBranding()).toEqual({ ok: true, branding: null });
  });

  it('says it failed when no one is signed in', async () => {
    user = null;
    expect(await actions.getExportBranding()).toEqual({ ok: false, failure: 'failed' });
  });
});
