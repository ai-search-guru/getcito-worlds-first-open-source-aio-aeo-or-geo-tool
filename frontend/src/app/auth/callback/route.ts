import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { NEXT_COOKIE, nextFromCookie, safeNextPath } from '@/lib/authNext';

/**
 * GET /auth/callback — where GitHub and Google sign-in come back. Goes on to
 * the page the visitor asked for: `?next=`, or the cookie the OAuth buttons
 * set before leaving (the provider's redirect URL stays the same), and only
 * to a page on this site.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(
    searchParams.get('next') ?? nextFromCookie(request.cookies.get(NEXT_COOKIE)?.value),
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(NEXT_COOKIE);
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
