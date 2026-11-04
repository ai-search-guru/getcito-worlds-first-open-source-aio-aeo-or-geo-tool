'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getOrgPlan } from '@/lib/guards/planGuard';
import { getMinimumPlanForFeature, hasFeature, type PlanId } from '@/config/plans';
import { assertWritable, DemoBrandError, SubscriptionInactiveError } from '@/lib/subscriptionGuard';
import {
  LOGO_MAX_BYTES,
  WHITE_LABEL_BUCKET,
  clientLogoFolder,
  isLogoPathIn,
  kitInUse,
  kitLogoFolder,
  kitTextSchema,
  logoBytesOk,
  logoExtension,
  logoTypeOf,
  type KitTextInput,
  type ReportBranding,
} from '@/lib/white-label/kit';

/**
 * White label (00429): Settings › White label (a workspace's kit) and a
 * brand's client logo in Brand settings. Everyone reads the kit; only an
 * Admin changes it, and Admins and Managers a brand's client logo, on a plan
 * with white label. A logo goes up to a one-time address the server gives
 * (the browser sends the file itself), then is set by its path, checked to
 * be what its type says. Logos are shown by short-lived signed addresses:
 * the bucket stays private.
 *
 * Every action answers { ok } and never throws for a refusal (#1777): the
 * page says what happened in plain words.
 */

export type WhiteLabelFailure =
  'read_only' | 'demo' | 'forbidden' | 'locked' | 'invalid' | 'failed';
export type WhiteLabelResult = { ok: true } | { ok: false; failure: WhiteLabelFailure };
/** Where one logo goes up: its path and the one-time token for it. */
export type LogoUploadTicket = { ok: true; path: string; token: string };

export interface WhiteLabelSettingsView {
  /** The plan has white label. */
  available: boolean;
  /** The lowest plan with it, for the upgrade path. */
  requiredPlan: PlanId;
  /** An Admin: the only one who changes the kit. */
  canEdit: boolean;
  /** The plan has it and the kit names a company or has a logo (kitInUse). */
  inUse: boolean;
  companyName: string | null;
  accentColor: string | null;
  footerText: string | null;
  /** The logo's signed address, for a few minutes; null without one. */
  logoUrl: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface ClientLogoView {
  available: boolean;
  requiredPlan: PlanId;
  /** An Admin or a Manager, and not the demo brand. */
  canEdit: boolean;
  logoUrl: string | null;
}

/**
 * The service-role client, imported once, when first needed: it is created
 * at module load and needs the service-role env, and pages that only name
 * their downloads import this module too (lib/white-label/exportName.ts).
 */
let adminClient: Promise<typeof import('@/lib/supabase/admin').supabaseAdmin> | null = null;
const admin = () => (adminClient ??= import('@/lib/supabase/admin').then((m) => m.supabaseAdmin));

/** How long a logo's signed address works: enough to show it on the page. */
const LOGO_URL_SECONDS = 10 * 60;

type Server = Awaited<ReturnType<typeof createClient>>;

interface Member {
  supabase: Server;
  userId: string;
  organizationId: string;
  role: string;
}

/** The signed-in person and their workspace, read through their session; null for none. */
async function member(): Promise<Member | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) return null;
  return {
    supabase,
    userId: user.id,
    organizationId: profile.organization_id,
    role: profile.role,
  };
}

const canManage = (role: string) => role === 'admin' || role === 'manager';

async function whiteLabelOn(organizationId: string): Promise<boolean> {
  return hasFeature(await getOrgPlan(organizationId), 'white_label');
}

/** A refused or failed check, as a result. */
function refusal(err: unknown): { ok: false; failure: WhiteLabelFailure } {
  if (err instanceof SubscriptionInactiveError) return { ok: false, failure: 'read_only' };
  if (err instanceof DemoBrandError) return { ok: false, failure: 'demo' };
  console.error('White label: the check failed:', err);
  return { ok: false, failure: 'failed' };
}

async function signedLogoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await (
    await admin()
  ).storage
    .from(WHITE_LABEL_BUCKET)
    .createSignedUrl(path, LOGO_URL_SECONDS);
  if (error || !data) {
    console.error('White label: could not sign a logo address:', error?.message);
    return null;
  }
  return data.signedUrl;
}

/** The one-time address for a new logo in `folder`, or a failure. */
async function logoUploadTicket(
  folder: string,
  type: string,
): Promise<LogoUploadTicket | { ok: false; failure: WhiteLabelFailure }> {
  const path = `${folder}${randomUUID()}.${logoExtension(type)}`;
  const { data, error } = await (
    await admin()
  ).storage
    .from(WHITE_LABEL_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error('White label: could not prepare a logo upload:', error?.message);
    return { ok: false, failure: 'failed' };
  }
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Whether the upload at `path` arrived and is what its name says: a PNG or
 * a JPEG by its signature, or an SVG that runs nothing. One that isn't is
 * deleted.
 */
async function uploadedLogoOk(path: string): Promise<boolean> {
  const type = logoTypeOf(path);
  const { data, error } = await (await admin()).storage.from(WHITE_LABEL_BUCKET).download(path);
  if (error || !data || !type) return false;
  const ok =
    data.size <= LOGO_MAX_BYTES && logoBytesOk(new Uint8Array(await data.arrayBuffer()), type);
  if (!ok) await removeLogo(path);
  return ok;
}

/** Deletes a logo nothing points to any more; a failure is only logged. */
async function removeLogo(path: string | null) {
  if (!path) return;
  const { error } = await (await admin()).storage.from(WHITE_LABEL_BUCKET).remove([path]);
  if (error) console.error('White label: could not delete an old logo:', error.message);
}

const uploadInput = z.object({
  type: z.string().refine((type) => logoExtension(type) !== null),
  size: z.number().int().positive().max(LOGO_MAX_BYTES),
});
const logoPathInput = z.string().min(1).max(300).nullable();
const brandIdInput = z.guid();

// ─── The workspace's kit ─────────────────────────────────────────────────────

/** Settings › White label: the kit, whether the plan has it, and who may change it. */
export async function getWhiteLabelSettings(): Promise<
  { ok: true; view: WhiteLabelSettingsView } | { ok: false; failure: 'failed' }
> {
  try {
    const me = await member();
    if (!me) return { ok: false, failure: 'failed' };
    const [available, read] = await Promise.all([
      whiteLabelOn(me.organizationId),
      me.supabase
        .from('white_label_kits')
        .select('company_name, accent_color, footer_text, logo_path, updated_at, updated_by')
        .eq('organization_id', me.organizationId)
        .maybeSingle(),
    ]);
    // Locked, the section shows the way to the plan: a kit it can't read doesn't matter.
    if (read.error && available) {
      console.error('White label: could not read the kit:', read.error.message);
      return { ok: false, failure: 'failed' };
    }
    const kit = read.error ? null : read.data;
    const [logoUrl, updatedBy] = await Promise.all([
      signedLogoUrl(kit?.logo_path ?? null),
      kit?.updated_by
        ? (await admin())
            .from('profiles')
            .select('full_name')
            .eq('id', kit.updated_by)
            .eq('organization_id', me.organizationId)
            .maybeSingle()
        : Promise.resolve(null),
    ]);
    return {
      ok: true,
      view: {
        available,
        requiredPlan: getMinimumPlanForFeature('white_label'),
        canEdit: me.role === 'admin',
        inUse: kitInUse(
          { companyName: kit?.company_name ?? null, logoPath: kit?.logo_path ?? null },
          available,
        ),
        companyName: kit?.company_name ?? null,
        accentColor: kit?.accent_color ?? null,
        footerText: kit?.footer_text ?? null,
        logoUrl,
        updatedAt: kit?.updated_at ?? null,
        updatedByName: (updatedBy?.data?.full_name as string | null | undefined) ?? null,
      },
    };
  } catch (err) {
    console.error('White label: could not read the settings:', err);
    return { ok: false, failure: 'failed' };
  }
}

/** The checks before an Admin changes the kit: their workspace, else why not. */
async function kitAdmin(): Promise<
  { ok: true; me: Member } | { ok: false; failure: WhiteLabelFailure }
> {
  const me = await member();
  if (!me) return { ok: false, failure: 'failed' };
  if (me.role !== 'admin') return { ok: false, failure: 'forbidden' };
  if (!(await whiteLabelOn(me.organizationId))) return { ok: false, failure: 'locked' };
  return { ok: true, me };
}

/** A one-time address for the workspace's new logo, under its own folder. */
export async function prepareWhiteLabelLogoUpload(
  type: string,
  size: number,
): Promise<LogoUploadTicket | { ok: false; failure: WhiteLabelFailure }> {
  try {
    await assertWritable();
  } catch (err) {
    return refusal(err);
  }
  try {
    if (!uploadInput.safeParse({ type, size }).success) return { ok: false, failure: 'invalid' };
    const admin = await kitAdmin();
    if (!admin.ok) return admin;
    return await logoUploadTicket(kitLogoFolder(admin.me.organizationId), type);
  } catch (err) {
    return refusal(err);
  }
}

/**
 * Sets the workspace's logo to one just uploaded (its path), or removes it
 * (null). The logo it replaces is deleted.
 */
export async function setWhiteLabelLogo(path: string | null): Promise<WhiteLabelResult> {
  try {
    await assertWritable();
  } catch (err) {
    return refusal(err);
  }
  try {
    const parsed = logoPathInput.safeParse(path);
    if (!parsed.success) return { ok: false, failure: 'invalid' };
    const admin = await kitAdmin();
    if (!admin.ok) return admin;
    const { supabase, organizationId } = admin.me;
    const next = parsed.data;
    if (next !== null) {
      if (!isLogoPathIn(next, kitLogoFolder(organizationId))) {
        return { ok: false, failure: 'invalid' };
      }
      if (!(await uploadedLogoOk(next))) return { ok: false, failure: 'invalid' };
    }
    const { data: before } = await supabase
      .from('white_label_kits')
      .select('logo_path')
      .eq('organization_id', organizationId)
      .maybeSingle();
    // Through the person's session: the kit's policies let only Admins write it.
    const { error } = await supabase
      .from('white_label_kits')
      .upsert(
        { organization_id: organizationId, logo_path: next },
        { onConflict: 'organization_id' },
      );
    if (error) {
      console.error('White label: could not save the logo:', error.message);
      return { ok: false, failure: 'failed' };
    }
    if (before?.logo_path && before.logo_path !== next) await removeLogo(before.logo_path);
    return { ok: true };
  } catch (err) {
    return refusal(err);
  }
}

/** Saves the kit's company name, main color and report footer; empty clears one. */
export async function saveWhiteLabelKit(input: KitTextInput): Promise<WhiteLabelResult> {
  try {
    await assertWritable();
  } catch (err) {
    return refusal(err);
  }
  try {
    const parsed = kitTextSchema.safeParse(input);
    if (!parsed.success) return { ok: false, failure: 'invalid' };
    const admin = await kitAdmin();
    if (!admin.ok) return admin;
    const { supabase, organizationId } = admin.me;
    const { error } = await supabase.from('white_label_kits').upsert(
      {
        organization_id: organizationId,
        company_name: parsed.data.companyName,
        accent_color: parsed.data.accentColor,
        footer_text: parsed.data.footerText,
      },
      { onConflict: 'organization_id' },
    );
    if (error) {
      console.error('White label: could not save the kit:', error.message);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true };
  } catch (err) {
    return refusal(err);
  }
}

// ─── A brand's client logo ───────────────────────────────────────────────────

interface BrandRead {
  organization_id: string;
  client_logo_path: string | null;
  is_demo: boolean;
}

/** The brand, read through the person's session: null when they can't see it. */
async function readBrand(supabase: Server, brandId: string): Promise<BrandRead | null> {
  const { data, error } = await supabase
    .from('brands')
    .select('organization_id, client_logo_path, is_demo')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the brand: ${error.message}`);
  return data;
}

/** Brand settings' client logo: the logo, the plan, and whether the person may change it. */
export async function getBrandClientLogo(
  brandId: string,
): Promise<{ ok: true; view: ClientLogoView } | { ok: false; failure: 'failed' }> {
  try {
    if (!brandIdInput.safeParse(brandId).success) return { ok: false, failure: 'failed' };
    const me = await member();
    if (!me) return { ok: false, failure: 'failed' };
    const brand = await readBrand(me.supabase, brandId);
    if (!brand) return { ok: false, failure: 'failed' };
    const [available, logoUrl] = await Promise.all([
      whiteLabelOn(me.organizationId),
      signedLogoUrl(brand.client_logo_path),
    ]);
    return {
      ok: true,
      view: {
        available,
        requiredPlan: getMinimumPlanForFeature('white_label'),
        canEdit: canManage(me.role) && !brand.is_demo,
        logoUrl,
      },
    };
  } catch (err) {
    console.error('White label: could not read the client logo:', err);
    return { ok: false, failure: 'failed' };
  }
}

/** The checks before a client logo changes: the person and their brand, else why not. */
async function brandManager(
  brandId: string,
): Promise<{ ok: true; me: Member; brand: BrandRead } | { ok: false; failure: WhiteLabelFailure }> {
  if (!brandIdInput.safeParse(brandId).success) return { ok: false, failure: 'invalid' };
  const me = await member();
  if (!me) return { ok: false, failure: 'failed' };
  if (!canManage(me.role)) return { ok: false, failure: 'forbidden' };
  const brand = await readBrand(me.supabase, brandId);
  if (!brand || brand.organization_id !== me.organizationId) {
    return { ok: false, failure: 'forbidden' };
  }
  if (brand.is_demo) return { ok: false, failure: 'demo' };
  if (!(await whiteLabelOn(me.organizationId))) return { ok: false, failure: 'locked' };
  return { ok: true, me, brand };
}

/** A one-time address for a brand's new client logo, under the brand's folder. */
export async function prepareBrandClientLogoUpload(
  brandId: string,
  type: string,
  size: number,
): Promise<LogoUploadTicket | { ok: false; failure: WhiteLabelFailure }> {
  try {
    await assertWritable({ brandId });
  } catch (err) {
    return refusal(err);
  }
  try {
    if (!uploadInput.safeParse({ type, size }).success) return { ok: false, failure: 'invalid' };
    const checked = await brandManager(brandId);
    if (!checked.ok) return checked;
    return await logoUploadTicket(clientLogoFolder(checked.me.organizationId, brandId), type);
  } catch (err) {
    return refusal(err);
  }
}

/**
 * Sets a brand's client logo to one just uploaded (its path), or removes it
 * (null). The logo it replaces is deleted.
 */
export async function setBrandClientLogo(
  brandId: string,
  path: string | null,
): Promise<WhiteLabelResult> {
  try {
    await assertWritable({ brandId });
  } catch (err) {
    return refusal(err);
  }
  try {
    const parsed = logoPathInput.safeParse(path);
    if (!parsed.success) return { ok: false, failure: 'invalid' };
    const checked = await brandManager(brandId);
    if (!checked.ok) return checked;
    const { me, brand } = checked;
    const next = parsed.data;
    if (next !== null) {
      if (!isLogoPathIn(next, clientLogoFolder(me.organizationId, brandId))) {
        return { ok: false, failure: 'invalid' };
      }
      if (!(await uploadedLogoOk(next))) return { ok: false, failure: 'invalid' };
    }
    // Through the person's session: the brands policies let Admins and Managers change it.
    const { error } = await me.supabase
      .from('brands')
      .update({ client_logo_path: next })
      .eq('id', brandId);
    if (error) {
      console.error('White label: could not save the client logo:', error.message);
      return { ok: false, failure: 'failed' };
    }
    if (brand.client_logo_path && brand.client_logo_path !== next) {
      await removeLogo(brand.client_logo_path);
    }
    return { ok: true };
  } catch (err) {
    return refusal(err);
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/** A logo, read from the bucket, as a data URL; null for no logo. */
async function logoDataUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const type = logoTypeOf(path);
  const { data, error } = await (await admin()).storage.from(WHITE_LABEL_BUCKET).download(path);
  if (error || !data || !type) throw new Error(`Could not read a logo: ${error?.message ?? path}`);
  return `data:${type};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`;
}

/**
 * The kit a brand's report is shown and downloaded with: the workspace's,
 * with the brand's client logo, when it is in use (kitInUse); null keeps
 * GetCito's look. The logos come as the images themselves, for the PDF the
 * browser draws. A failed read is a failure, not null: a PDF in GetCito's
 * look must not go to an agency's client by mistake.
 */
export async function getReportBranding(
  brandId: string,
): Promise<{ ok: true; branding: ReportBranding | null } | { ok: false; failure: 'failed' }> {
  try {
    if (!brandIdInput.safeParse(brandId).success) return { ok: false, failure: 'failed' };
    const me = await member();
    if (!me) return { ok: false, failure: 'failed' };
    if (!(await whiteLabelOn(me.organizationId))) return { ok: true, branding: null };
    const [read, brand] = await Promise.all([
      me.supabase
        .from('white_label_kits')
        .select('company_name, accent_color, footer_text, logo_path')
        .eq('organization_id', me.organizationId)
        .maybeSingle(),
      readBrand(me.supabase, brandId),
    ]);
    if (read.error) throw new Error(`Could not read the kit: ${read.error.message}`);
    const kit = read.data;
    if (!kit || !kitInUse({ companyName: kit.company_name, logoPath: kit.logo_path }, true)) {
      return { ok: true, branding: null };
    }
    const [logo, clientLogo] = await Promise.all([
      logoDataUrl(kit.logo_path),
      logoDataUrl(brand?.client_logo_path ?? null),
    ]);
    return {
      ok: true,
      branding: {
        companyName: kit.company_name,
        accentColor: kit.accent_color,
        footerText: kit.footer_text,
        logo,
        clientLogo,
      },
    };
  } catch (err) {
    console.error('White label: could not read a report’s kit:', err);
    return { ok: false, failure: 'failed' };
  }
}

// ─── Downloads ───────────────────────────────────────────────────────────────

/**
 * The kit a workspace's downloads are named with: its company name while
 * the kit is in use (kitInUse), null without one. Pages read it once a page
 * load (lib/white-label/exportName.ts); the AI Traffic export's route, on
 * the server, for each file.
 */
export async function getExportBranding(): Promise<
  { ok: true; branding: { companyName: string | null } | null } | { ok: false; failure: 'failed' }
> {
  try {
    const me = await member();
    if (!me) return { ok: false, failure: 'failed' };
    if (!(await whiteLabelOn(me.organizationId))) return { ok: true, branding: null };
    const { data, error } = await me.supabase
      .from('white_label_kits')
      .select('company_name, logo_path')
      .eq('organization_id', me.organizationId)
      .maybeSingle();
    if (error) {
      console.error('White label: could not read the kit for a download:', error.message);
      return { ok: false, failure: 'failed' };
    }
    const inUse =
      data !== null && kitInUse({ companyName: data.company_name, logoPath: data.logo_path }, true);
    return { ok: true, branding: inUse ? { companyName: data.company_name } : null };
  } catch (err) {
    console.error('White label: could not read the kit for a download:', err);
    return { ok: false, failure: 'failed' };
  }
}
