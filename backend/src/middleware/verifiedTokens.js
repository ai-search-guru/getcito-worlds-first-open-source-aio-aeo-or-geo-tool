import { createHash } from 'node:crypto';

/**
 * Short-lived cache of Authorization headers that decodeToken has already
 * verified against Supabase Auth, mapped to their user id. The rate limiter
 * consults it to give real users per-user buckets WITHOUT trusting the header
 * blindly: a forged or garbage token never gets verified, so it never earns a
 * bucket of its own and keeps counting against the caller's IP limit.
 *
 * Only the SHA-256 of the header is stored, never the raw JWT. Entries expire
 * after 30 minutes (well under the token's own lifetime) and the map is
 * capped, evicting oldest-inserted first, so it can't grow unbounded.
 */
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;

function hashAuthHeader(authorizationHeader) {
  return createHash('sha256').update(authorizationHeader).digest('hex').slice(0, 32);
}

function verifiedCache() {
  const cache = new Map();
  return {
    mark(authorizationHeader, id) {
      if (!authorizationHeader || !id) return;
      if (cache.size >= MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(hashAuthHeader(authorizationHeader), { id, expiresAt: Date.now() + TTL_MS });
    },
    get(authorizationHeader) {
      if (!authorizationHeader) return null;
      const key = hashAuthHeader(authorizationHeader);
      const hit = cache.get(key);
      if (!hit) return null;
      if (hit.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
      }
      return hit.id;
    },
    clear() {
      cache.clear();
    },
  };
}

const users = verifiedCache();

export function markTokenVerified(authorizationHeader, userId) {
  users.mark(authorizationHeader, userId);
}

export function verifiedUserId(authorizationHeader) {
  return users.get(authorizationHeader);
}

/**
 * Internal requests acting as a member (actingUser.js), by the secret's
 * header and the X-Acting-User they sent: that member's own bucket, once
 * actingUser.js has checked the pair. The secret's header alone earns
 * none, and a session's token with an X-Acting-User keeps its own.
 */
function actingKey(authorizationHeader, actingHeader) {
  if (typeof actingHeader !== 'string' || !authorizationHeader) return null;
  return `${authorizationHeader}\nacting-for:${actingHeader}`;
}

export function markActingUserVerified(authorizationHeader, actingHeader, userId) {
  users.mark(actingKey(authorizationHeader, actingHeader), userId);
}

export function verifiedActingUserId(authorizationHeader, actingHeader) {
  return users.get(actingKey(authorizationHeader, actingHeader));
}

/**
 * AI-bot senders (AT-010) whose secret named a live connection, mapped to
 * the connection's id. Kept apart from users, so a bot secret never earns
 * a dashboard bucket. Each accepted request marks it again, so a sender
 * that keeps sending keeps its bucket.
 */
const botSenders = verifiedCache();

export function markBotSenderVerified(authorizationHeader, connectionId) {
  botSenders.mark(authorizationHeader, connectionId);
}

export function verifiedBotConnection(authorizationHeader) {
  return botSenders.get(authorizationHeader);
}

// Test hook — the limiter's behavior depends on cache state.
export function clearVerifiedTokens() {
  users.clear();
  botSenders.clear();
}
