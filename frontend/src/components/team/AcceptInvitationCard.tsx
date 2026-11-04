'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { acceptInvitation, type TeamRole } from '@/lib/actions/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';

interface Props {
  token: string;
  organizationName: string;
  email: string;
  role: TeamRole;
  currentUserEmail: string;
  emailMatches: boolean;
}

function roleLabel(role: TeamRole): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'manager':
      return 'Manager';
    case 'analyst':
      return 'Analyst';
    case 'agency_partner':
      return 'Agency Partner';
  }
}

export function AcceptInvitationCard({
  token,
  organizationName,
  email,
  role,
  currentUserEmail,
  emailMatches,
}: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  async function handleAccept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAcceptError(null);

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsAccepting(true);
    try {
      const supabase = createClient();

      // Order matters: set the password + name first so the moment the
      // invitation row flips to "accepted" the credentials are already
      // good. If updateUser fails we abort before mutating the invite —
      // otherwise the user lands in the same broken state we just fixed
      // (joined the org but can't sign back in).
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
        data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
      });
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      const result = await acceptInvitation(token);
      if ('error' in result) {
        // Inline beats a toast here — this is the message that tells the
        // user what to do next (e.g. which account to sign in with), and a
        // toast that auto-dismisses would take that instruction with it.
        setAcceptError(result.error);
        setIsAccepting(false);
        return;
      }

      toast.success(`Welcome to ${organizationName}!`);
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to accept invitation');
      setIsAccepting(false);
    }
  }

  async function handleSwitchAccount() {
    setIsSwitching(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(
      `/sign-up?invite=${token}&email=${encodeURIComponent(email)}&next=${encodeURIComponent(
        `/invite/${token}`,
      )}`,
    );
    router.refresh();
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Join {organizationName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve been invited to join as{' '}
          <span className="font-medium text-foreground">{roleLabel(role)}</span>
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Invited email</span>
          <span className="font-medium">{email}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-medium">{currentUserEmail}</span>
        </div>
      </div>

      {!emailMatches ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-destructive">
            This invitation was sent to <span className="font-medium">{email}</span>, but
            you&apos;re signed in as {currentUserEmail}. Please switch accounts to continue.
          </p>
          <Button onClick={handleSwitchAccount} disabled={isSwitching} className="w-full">
            {isSwitching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Switching...
              </>
            ) : (
              'Sign out and use correct account'
            )}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleAccept} className="mt-6 space-y-4">
          {acceptError && <p className="text-sm text-destructive">{acceptError}</p>}
          <div className="space-y-2">
            <Label htmlFor="invite-fullname">Full name</Label>
            <Input
              id="invite-fullname"
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              disabled={isAccepting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-password">Set a password</Label>
            <PasswordInput
              id="invite-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              disabled={isAccepting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-confirm-password">Confirm password</Label>
            <PasswordInput
              id="invite-confirm-password"
              placeholder="Repeat the password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              disabled={isAccepting}
            />
          </div>

          <Button type="submit" disabled={isAccepting} className="w-full">
            {isAccepting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Joining...
              </>
            ) : (
              `Accept and join ${organizationName}`
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            You&apos;ll use this password the next time you sign in.
          </p>
        </form>
      )}
    </div>
  );
}
