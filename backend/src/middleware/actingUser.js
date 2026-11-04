/**
 * Internal requests that act as a member (Chat's triggered runs).
 *
 * A Chat run an agent's trigger starts has no one's session: the person it
 * runs for isn't there to sign in. The web's tools that write through this
 * API send `Authorization: Bearer ${CHAT_ACTING_SECRET}` and
 * `X-Acting-User: <the member's id>` instead of the member's token. A
 * secret of its own, apart from CHAT_INTERNAL_SECRET (the server's to the
 * web), so one that leaks opens one way only.
 * decodeToken (middleware/index.js) hands such a request here, and the
 * member is known as with a session: `req.user` is theirs, and everything
 * after it (the demo brand's check, the plan's, the route's own brand access
 * and role checks) runs as it would for them. Only the identity comes from
 * here instead of a token.
 *
 * Only the routes of ACTING_USER_ROUTES take it. The secret is never a
 * session: elsewhere it is refused (401) and never sent to Supabase Auth.
 * Without the secret, a request with X-Acting-User is refused (401) by
 * decodeToken before its token reaches Supabase Auth (a web whose value
 * differs from this server's would send its secret there), so only the
 * secret opens acting as someone. With CHAT_ACTING_SECRET unset, or
 * shorter than MIN_SECRET_LENGTH, the way is closed; with the new Chat off
 * on this deployment, it is refused before anyone is read. The member must
 * exist, belong to an organization with the new Chat on, and reach the
 * brand the request names (lib/access.js, read as the service role).
 *
 * Neither the secret nor the Authorization header is logged; the member is,
 * as `actingFor`. Rate limits count the request in the member's own bucket
 * (middleware/rateLimiter.js).
 */
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess, brandAccessOf, NOT_IN_WORKSPACE } from '../lib/access.js';
import { chatAgenticDeployed, chatAgenticEnabled } from '../lib/chatFlag.js';
import logger from '../lib/logger.js';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';
import { BadPathParam, TooManyIds, brandsNamedBy, demoRouteFor } from './demoBrand.js';
import { markActingUserVerified } from './verifiedTokens.js';

/** The header naming the member an internal request acts for (Express lower-cases it). */
export const ACTING_USER_HEADER = 'x-acting-user';

/** The shortest CHAT_ACTING_SECRET taken (`openssl rand -hex 32` makes 64). */
export const MIN_SECRET_LENGTH = 32;

/**
 * The routes, under /api, an internal request may act as a member on: the
 * writes the web makes through this API for a run with no session
 * (frontend/src/lib/chat/actor), and no others. Site Audit's starts and a
 * report's summary aren't: their Chat changes always wait on the person's
 * card, whose Approve runs with their session. Each is a DEMO_GUARDED route
 * (middleware/demoBrand.js), whose entry says where the request names its
 * brand, so the brand is checked here too.
 */
export const ACTING_USER_ROUTES = Object.freeze([
  // An opportunity's status (content.ts updateOpportunityStatus).
  'PATCH /content/:id/status',
  // A prompt suggestion dismissed (promptSuggestions.ts dismissSuggestion).
  'POST /prompts/suggestions/:id/dismiss',
  // Send to Action Center and its duplicate check (chatActionCenter.ts).
  'POST /action-center/chat-actions/check',
  'POST /action-center/chat-actions',
]);

const ALLOWED = new Set(ACTING_USER_ROUTES);

const UNAUTHORIZED = { message: 'Unauthorized API Request' };
const CHAT_OFF = 'Chat is off for this workspace';

/** Refused with the route's usual fields, so the web reads it as the route's own answer. */
function refuse(res, status, message, code) {
  return res
    .status(status)
    .json({ success: false, error: message, message, ...(code ? { code } : {}) });
}

/**
 * Whether the request carries CHAT_ACTING_SECRET where decodeToken reads a
 * token (after the scheme), compared in constant time, so the secret never
 * reaches Supabase Auth, even one too short to be taken. Always false with
 * the secret unset.
 */
export function carriesActingSecret(req) {
  const auth = req.headers?.authorization;
  const token = typeof auth === 'string' ? auth.split(' ')[1] : '';
  return webhookSecretsMatch(process.env.CHAT_ACTING_SECRET, token);
}

/** The allowed route a request reaches, as demoRouteFor reads it, or null. */
export function actingRouteFor(req) {
  const route = demoRouteFor(req);
  return route?.guarded && ALLOWED.has(route.entry.route) ? route : null;
}

/**
 * Express middleware, for a request carrying the acting secret (decodeToken
 * checks carriesActingSecret first): sets `req.user` to the member
 * X-Acting-User names, or refuses. 401 with a secret too short to be taken,
 * off the allowed routes, without a member's id or for one who doesn't
 * exist; 403 chat_off with the new Chat off on this deployment (before
 * anyone is read) or for the member's organization; 403 for a member
 * without an organization, or who may not reach the brand named (404 for a
 * brand that is gone). A brand that isn't found by a row the request names
 * is left to the route, which answers 400 or 404 itself.
 */
export async function authenticateActingUser(req, res, next) {
  const log = req.log ?? logger;
  const where = { method: req.method, path: req.path };
  if ((process.env.CHAT_ACTING_SECRET ?? '').length < MIN_SECRET_LENGTH) {
    log.warn(
      where,
      `CHAT_ACTING_SECRET is shorter than ${MIN_SECRET_LENGTH} characters: acting as a member is closed`,
    );
    return res.status(401).json(UNAUTHORIZED);
  }
  if (!chatAgenticDeployed()) {
    log.warn(where, 'internal request acting for a member with Chat off');
    return refuse(res, 403, CHAT_OFF, 'chat_off');
  }
  const route = actingRouteFor(req);
  if (!route) {
    log.warn(where, 'internal secret on a route that takes no acting member');
    return res.status(401).json(UNAUTHORIZED);
  }

  const header = req.headers[ACTING_USER_HEADER];
  const parsed = z.guid().safeParse(header);
  if (!parsed.success) {
    log.warn(where, 'internal request without a member to act for');
    return res.status(401).json(UNAUTHORIZED);
  }
  const actingFor = parsed.data.toLowerCase();
  const acting = log.child({ actingFor });

  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(actingFor);
    const user = data?.user;
    const banned = user?.banned_until && new Date(user.banned_until) > new Date();
    if (error || !user || banned) {
      acting.warn(where, 'internal request acting for no one who may sign in');
      return res.status(401).json(UNAUTHORIZED);
    }

    const { orgId } = await brandAccessOf(user.id);
    if (!orgId) {
      acting.warn(where, 'internal request acting for someone without a workspace');
      return refuse(res, 403, NOT_IN_WORKSPACE, 'not_in_workspace');
    }
    if (!chatAgenticEnabled(orgId)) {
      acting.warn(where, 'internal request acting for a workspace without Chat');
      return refuse(res, 403, CHAT_OFF, 'chat_off');
    }

    for (const brandId of new Set(await brandsNamedBy(req, route))) {
      await assertBrandAccess(brandId, user.id);
    }

    req.user = user;
    req.actingFor = user.id;
    req.log = acting;
    // The member's own rate-limit bucket from the next request on (rateLimiter.js).
    markActingUserVerified(req.headers.authorization, header, user.id);
    acting.info(where, 'internal request acting for a member');
    return next();
  } catch (err) {
    if (err instanceof TooManyIds) {
      return refuse(res, 400, 'Too many ids at once', 'invalid');
    }
    if (err instanceof BadPathParam) {
      return refuse(res, 400, 'Invalid path', 'invalid');
    }
    if (err?.status) {
      acting.warn({ ...where, status: err.status, code: err.code }, 'acting member refused');
      return refuse(res, err.status, err.message, err.code);
    }
    acting.error({ err }, 'acting member check failed');
    return res.status(500).json({ message: 'Internal Error' });
  }
}
