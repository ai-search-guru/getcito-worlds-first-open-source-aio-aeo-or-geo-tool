import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeRedirectUrl } from '@/lib/authNext';

/**
 * GET /auth/confirm — server-side OTP verification for email-driven auth flows.
 *
 * Supabase's default `{{ .ConfirmationURL }}` template variable points at
 * `https://<project>.supabase.co/auth/v1/verify?token=...&redirect_to=...`,
 * which returns the session in the URL hash fragment (`#access_token=...`).
 * Hash fragments aren't visible to server components, so the session never
 * makes it into our cookies — the user lands on the destination page
 * still "signed out" from the server's perspective and bounces to /sign-up.
 *
 * The fix is the standard Supabase + Next.js SSR pattern: customize the
 * email templates to point here with `{{ .TokenHash }}` + `{{ .Type }}`,
 * verify the OTP server-side, set the session via the auth helper's
 * cookie machinery, then 302 to the original destination.
 *
 * Expected template URL:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&redirect_to={{ .RedirectTo }}
 *
 * Works for every email type Supabase ships — invite, signup, recovery,
 * magiclink, email_change. The type comes from the template, not from us.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // Only to a page on this site (#1203): a crafted link can't send someone
  // who just confirmed an e-mail to another site.
  const redirectTarget = safeRedirectUrl(
    searchParams.get('redirect_to') ?? searchParams.get('next'),
    origin,
  );

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/sign-in?error=auth_confirm_missing_params`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=auth_confirm_failed&reason=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(redirectTarget);
}
