/**
 * GetCito staff, for Chat's Debug view (CHAT-03 items 25–26; Chat Wave 1,
 * W1-15) and its design preview (/dashboard/chat/preview). The app has no
 * staff role yet, so staff are the people whose
 * sign-in e-mail is in STAFF_EMAILS: comma-separated, any case, blanks
 * dropped; unset or empty, nobody is. The e-mail must be confirmed, so an
 * unconfirmed sign-up with a staff address isn't staff.
 *
 * Server only: read from the process's environment each time it is asked,
 * never a NEXT_PUBLIC_ variable, so the list never reaches a browser. The
 * process sees a change when it starts again (a restart, or a new deployment
 * on Vercel), as for CHAT_AGENTIC.
 */

/** Who signed in, as Supabase's auth user gives it. */
export interface StaffCandidate {
  email?: string | null;
  email_confirmed_at?: string | null;
}

/** STAFF_EMAILS as a list: trimmed, lower-cased, blanks dropped. */
export function staffEmails(): string[] {
  return (process.env.STAFF_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether the person signed in is GetCito staff: a confirmed e-mail in STAFF_EMAILS. */
export function isChatStaff(user: StaffCandidate | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email || !user?.email_confirmed_at) return false;
  return staffEmails().includes(email);
}
