import supabaseAdmin from '../config/supabase.js';
import logger from '../lib/logger.js';
import { markTokenVerified } from './verifiedTokens.js';
import { isAllowedOrigin } from './originCheck.js';
import { ACTING_USER_HEADER, authenticateActingUser, carriesActingSecret } from './actingUser.js';

class Middleware {
  async decodeTokenForSocket(socket, next) {
    try {
      const token = socket?.handshake?.query?.authorization;

      if (!token) {
        return next(new Error('Missing authorization token'));
      }

      const {
        data: { user },
        error,
      } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        logger.warn('unauthorized socket request');
        return next(new Error('Unauthorized'));
      }

      socket.user = user;
      return next();
    } catch (e) {
      logger.error({ err: e }, 'socket middleware internal error');
      return next(new Error('Internal Error'));
    }
  }

  async decodeToken(req, res, next) {
    // The acting secret is never a session: the web's Chat acting as a
    // member, on a few routes only (actingUser.js). Never sent to Supabase Auth.
    if (carriesActingSecret(req)) return authenticateActingUser(req, res, next);
    // A request acting as a member without the secret (another one, a web and a server whose
    // values differ): refused here, so what it carries never reaches Supabase Auth.
    if (req?.headers?.[ACTING_USER_HEADER] !== undefined) {
      (req.log ?? logger).warn(
        { method: req.method, path: req.path },
        'request acting for a member without the acting secret',
      );
      return res.status(401).json({ message: 'Unauthorized API Request' });
    }

    try {
      const token = req?.headers?.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({ message: 'Missing authorization token' });
      }

      const {
        data: { user },
        error,
      } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ message: 'Unauthorized API Request' });
      }

      // Promote this token to a per-user rate-limit bucket (see rateLimiter.js)
      markTokenVerified(req.headers.authorization, user.id);

      req.user = user;
      return next();
    } catch {
      return res.status(500).json({ message: 'Internal Error' });
    }
  }

  async checkRequestIsComingFromDomain(req, res, next) {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    try {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      const domain = req?.headers?.referer || req?.headers?.origin;

      if (!domain) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      if (isAllowedOrigin(domain, allowedOrigins)) {
        return next();
      }

      return res.status(403).json({ message: 'Forbidden' });
    } catch (error) {
      logger.error({ err: error }, 'domain check error');
      return res.status(500).json({ message: 'Internal Error' });
    }
  }

  async checkRequestIsComingFromDomainForSocket(socket, next) {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    try {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      const domain = socket?.handshake?.headers?.referer || socket?.handshake?.headers?.origin;

      if (!domain) {
        return next(new Error('Forbidden Socket'));
      }

      if (isAllowedOrigin(domain, allowedOrigins)) {
        return next();
      }

      return next(new Error('Forbidden Socket'));
    } catch (error) {
      logger.error({ err: error }, 'socket domain check error');
      return next(new Error('Internal Error Socket'));
    }
  }
}

export default new Middleware();
