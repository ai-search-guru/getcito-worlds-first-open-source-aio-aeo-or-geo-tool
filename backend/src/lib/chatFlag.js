/**
 * The new Chat (the Drive Chat specs, CHAT-00…25) behind CHAT_AGENTIC.
 *
 * Read from the environment each time it is asked; the process sees a change
 * when it starts again (a restart or a new deployment). Off unless
 * "true", so a self-hosted install — or the cloud with it unset — keeps
 * today's agent and sees nothing new. With it on, CHAT_AGENTIC_ORGS
 * (organization ids, comma-separated) narrows it to those workspaces; unset
 * or empty, it is on for every one. The web's lib/chat/flag.ts reads the same
 * two variables the same way.
 *
 * @param {string | null | undefined} [organizationId]
 * @returns {boolean}
 */
export function chatAgenticEnabled(organizationId) {
  if (!chatAgenticDeployed()) return false;
  const orgs = chatAgenticOrgs();
  if (orgs.length === 0) return true;
  return !!organizationId && orgs.includes(String(organizationId).trim().toLowerCase());
}

/**
 * Whether this deployment runs the new Chat at all, whichever workspaces it
 * is on for: what the server's own Chat jobs (the model price sync) start on.
 */
export function chatAgenticDeployed() {
  return process.env.CHAT_AGENTIC === 'true';
}

/** CHAT_AGENTIC_ORGS as a list: trimmed, lower-cased, blanks dropped. */
export function chatAgenticOrgs() {
  return (process.env.CHAT_AGENTIC_ORGS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}
