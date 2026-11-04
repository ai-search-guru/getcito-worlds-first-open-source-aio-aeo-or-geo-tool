import supabaseAdmin from '../../config/supabase.js';
import { openCredentials, sealCredentials } from '../catalog/credentials.js';

/**
 * A CMS connection's sign-in (Send to CMS #1331, 00294): WordPress's user
 * and Application Password. Kept in `brand_cms_credentials`, which only the
 * service role reads, sealed as a store's sign-in is (lib/catalog/credentials.js:
 * AES-256-GCM under CONNECTOR_CREDENTIALS_KEY). The envelope is bound to
 * `cms:<connection id>`, so it opens on its own connection only, never on
 * another's row nor as a store source's.
 *
 * Credentials never go in a log, an error message or a response.
 */

const bound = (connectionId) => `cms:${connectionId}`;

/** Keeps (or replaces) a connection's credentials. */
export async function saveCmsCredentials(
  connectionId,
  credentials,
  { setBy = null, db = supabaseAdmin } = {},
) {
  const secret = sealCredentials(bound(connectionId), credentials);
  const { error } = await db
    .from('brand_cms_credentials')
    .upsert(
      { connection_id: connectionId, secret, set_at: new Date().toISOString(), set_by: setBy },
      { onConflict: 'connection_id' },
    );
  if (error) throw new Error(`brand_cms_credentials write: ${error.code ?? 'error'}`);
}

/** A connection's credentials, or null when it has none it can open. */
export async function readCmsCredentials(connectionId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('brand_cms_credentials')
    .select('secret')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (error) throw new Error(`brand_cms_credentials read: ${error.code ?? 'error'}`);
  return data?.secret ? openCredentials(bound(connectionId), data.secret) : null;
}
