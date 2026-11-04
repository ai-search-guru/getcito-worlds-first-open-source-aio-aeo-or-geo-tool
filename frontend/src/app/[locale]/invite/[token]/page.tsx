import { redirect } from '@/i18n/navigation';
import { getInvitationByToken } from '@/lib/actions/team';
import { createClient } from '@/lib/supabase/server';
import { AcceptInvitationCard } from '@/components/team/AcceptInvitationCard';
import { AlertTriangle } from 'lucide-react';

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return <InvalidInvitation reason="not_found" />;
  }

  if (invitation.status !== 'pending') {
    return <InvalidInvitation reason={invitation.status} />;
  }

  // eslint-disable-next-line react-hooks/purity -- server component renders fresh per request; Date.now() is the correct expiration check, the purity rule targets client-side memoization which doesn't apply on the server.
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return <InvalidInvitation reason="expired" />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = `/${locale}/invite/${token}`;
    redirect({
      href: `/sign-up?invite=${token}&email=${encodeURIComponent(invitation.email)}&next=${encodeURIComponent(next)}`,
      locale,
    });
  }

  const emailMatches = user!.email?.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <AcceptInvitationCard
          token={token}
          organizationName={invitation.organizationName ?? 'this team'}
          email={invitation.email}
          role={invitation.role}
          currentUserEmail={user!.email ?? ''}
          emailMatches={emailMatches}
        />
      </div>
    </div>
  );
}

function InvalidInvitation({
  reason,
}: {
  reason: 'not_found' | 'expired' | 'accepted' | 'revoked' | 'pending';
}) {
  const messages: Record<string, { title: string; description: string }> = {
    not_found: {
      title: 'Invitation not found',
      description: 'The link you followed is invalid.',
    },
    expired: {
      title: 'Invitation expired',
      description: 'Ask your team admin to send a new invitation.',
    },
    accepted: {
      title: 'Invitation already used',
      description: 'This invitation has already been accepted.',
    },
    revoked: {
      title: 'Invitation revoked',
      description: 'This invitation was revoked by the team admin.',
    },
    pending: {
      title: 'Invitation unavailable',
      description: 'Please try again or contact your team admin.',
    },
  };
  const msg = messages[reason] ?? messages.pending;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">{msg.title}</h1>
        <p className="text-sm text-muted-foreground">{msg.description}</p>
      </div>
    </div>
  );
}
