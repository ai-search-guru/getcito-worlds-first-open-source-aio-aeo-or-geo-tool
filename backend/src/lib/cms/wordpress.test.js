import { afterEach, describe, expect, it, vi } from 'vitest';

// The harness reaches the Supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { startFakeApi } = await import('../../connectors/testing.js');
const {
  WordPressError,
  answersAsWordPress,
  checkSite,
  createPost,
  readPost,
  readPostState,
  revokePassword,
  siteAddress,
  publishPost,
  unpublishPost,
  updatePost,
} = await import('./wordpress.js');

/**
 * WordPress's REST API for Send to CMS (#1331, phase 2): a site checked
 * before its sign-in is kept, draft posts written, and the password revoked
 * on disconnect, against a fake of the API (its answers as WordPress's
 * handbook shows them).
 */

const signIn = { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' };
// Basic editor:abcdefghijklmnopqrstuvwx — WordPress takes the password without its spaces.
const BASIC = `Basic ${Buffer.from('editor:abcdefghijklmnopqrstuvwx').toString('base64')}`;
const INDEX = {
  name: 'Acme Coffee Blog',
  namespaces: ['oembed/1.0', 'wp/v2', 'wp-site-health/v1'],
  authentication: {
    'application-passwords': {
      endpoints: { authorization: 'https://blog.acme.example/wp-admin/authorize-application.php' },
    },
  },
};
const ME = { id: 3, name: 'Editor', slug: 'editor', capabilities: { edit_posts: true } };

let api;
afterEach(() => api?.close());

const start = async (routes) => {
  api = await startFakeApi(routes);
  return { site: api.origin, request: api.request };
};

describe('siteAddress', () => {
  it('reads the address as the site, https, with what was copied around it taken off', () => {
    expect(siteAddress('blog.acme.example')).toBe('https://blog.acme.example');
    expect(siteAddress(' https://blog.acme.example/ ')).toBe('https://blog.acme.example');
    expect(siteAddress('https://acme.example/blog/wp-admin/post-new.php?x=1#y')).toBe(
      'https://acme.example/blog',
    );
    expect(siteAddress('https://acme.example/wp-json/wp/v2/posts')).toBe('https://acme.example');
  });

  it('refuses http, a sign-in in the address and what isn’t one', () => {
    for (const input of [
      'http://blog.acme.example',
      'https://u:p@blog.acme.example',
      'https://',
      '',
    ]) {
      expect(() => siteAddress(input)).toThrow(WordPressError);
    }
    expect(() => siteAddress('http://blog.acme.example')).toThrow(/https only/);
    expect(() => siteAddress('https://blog.acme.example:8443')).toThrow(/without a port/);
  });
});

describe('checkSite', () => {
  const FIELDS = { _fields: 'name,namespaces,authentication' };
  // A wrong password fails every call to the API, as WordPress's
  // rest_application_password_check_errors does; none is a visitor.
  const signedIn = (call, json) =>
    call.headers.authorization === BASIC || !call.headers.authorization
      ? { json }
      : { status: 401, json: { code: 'incorrect_password' } };

  it('takes a WordPress site whose user can write posts, the password sent once it answered as one', async () => {
    const { site, request } = await start({
      'GET /wp-json/': (call) => signedIn(call, INDEX),
      'GET /wp-json/wp/v2/users/me': () => ({ json: ME }),
    });
    expect(await checkSite(site, signIn, { request })).toEqual({
      siteName: 'Acme Coffee Blog',
      account: 'editor',
    });
    expect(api.calls.map((c) => [c.method, c.path, c.query, c.headers.authorization])).toEqual([
      ['GET', '/wp-json/', FIELDS, undefined],
      ['GET', '/wp-json/wp/v2/users/me', { context: 'edit' }, BASIC],
    ]);
  });

  it('sends no password to an address that isn’t WordPress', async () => {
    for (const routes of [
      {},
      { 'GET /wp-json/': () => ({ text: '<html>Hello</html>' }) },
      { 'GET /wp-json/': () => ({ json: { namespaces: ['wc/v3'] } }) },
    ]) {
      const checked = await start(routes);
      await expect(
        checkSite(checked.site, signIn, { request: checked.request }),
      ).rejects.toMatchObject({
        code: 'not_wordpress',
      });
      expect(api.calls.every((c) => !c.headers.authorization)).toBe(true);
      api.close();
    }
    api = null;
  });

  it('asks a site that keeps its API from visitors again, signed in', async () => {
    const { site, request } = await start({
      'GET /wp-json/': (call) =>
        call.headers.authorization
          ? signedIn(call, INDEX)
          : { status: 401, json: { code: 'rest_forbidden' } },
      'GET /wp-json/wp/v2/users/me': () => ({ json: ME }),
    });
    expect(await checkSite(site, signIn, { request })).toMatchObject({ account: 'editor' });
    expect(api.calls.map((c) => Boolean(c.headers.authorization))).toEqual([false, true, true]);
  });

  it('says the user or the password is refused, never repeating it', async () => {
    const { site, request } = await start({
      'GET /wp-json/': (call) =>
        call.headers.authorization
          ? { status: 401, json: { code: 'incorrect_password' } }
          : { json: INDEX },
      'GET /wp-json/wp/v2/users/me': () => ({ status: 401, json: { code: 'incorrect_password' } }),
    });
    const err = await checkSite(site, signIn, { request }).catch((e) => e);
    expect(err).toMatchObject({ code: 'auth_failed' });
    expect(err.message).not.toMatch(/abcd|editor/);
  });

  it('tells a server that drops the sign-in from a wrong password', async () => {
    // The header never reaches WordPress: every call is a visitor's.
    const { site, request } = await start({
      'GET /wp-json/': () => ({ json: INDEX }),
      'GET /wp-json/wp/v2/users/me': () => ({ status: 401, json: { code: 'rest_not_logged_in' } }),
    });
    const err = await checkSite(site, signIn, { request }).catch((e) => e);
    expect(err).toMatchObject({ code: 'header_dropped' });
    expect(err.message).toMatch(/Permalinks/);
  });

  it('says what stopped it at each step, in that step’s words', async () => {
    const cases = [
      [
        { 'GET /wp-json/': () => ({ status: 301, headers: { location: 'https://www.x/' } }) },
        'redirect',
      ],
      [{ 'GET /wp-json/': () => ({ status: 403, json: {} }) }, 'site_refused'],
      [{ 'GET /wp-json/': () => ({ status: 500, json: {} }) }, 'failed'],
      [
        {
          'GET /wp-json/': () => ({ json: INDEX }),
          'GET /wp-json/wp/v2/users/me': () => ({ status: 404, json: { code: 'rest_no_route' } }),
        },
        'users_hidden',
      ],
      [{ 'GET /wp-json/': () => ({ json: { ...INDEX, authentication: [] } }) }, 'no_app_passwords'],
      [
        {
          'GET /wp-json/': () => ({ json: INDEX }),
          'GET /wp-json/wp/v2/users/me': () => ({ json: { ...ME, capabilities: { read: true } } }),
        },
        'no_access',
      ],
    ];
    for (const [routes, code] of cases) {
      const checked = await start(routes);
      await expect(
        checkSite(checked.site, signIn, { request: checked.request }),
      ).rejects.toMatchObject({
        code,
      });
      api.close();
    }
    api = null;
  });

  it('reads the site’s name as WordPress escapes it', async () => {
    const { site, request } = await start({
      'GET /wp-json/': () => ({ json: { ...INDEX, name: 'Acme &amp; Co&#8217;s Blog' } }),
      'GET /wp-json/wp/v2/users/me': () => ({ json: ME }),
    });
    expect((await checkSite(site, signIn, { request })).siteName).toBe('Acme & Co’s Blog');
  });
});

describe('posts', () => {
  it('makes a draft post, whatever the post asked', async () => {
    const { site, request } = await start({
      'POST /wp-json/wp/v2/posts': (call) => ({
        status: 201,
        json: { id: 41, status: call.body.status, link: 'https://blog.acme.example/?p=41' },
      }),
    });
    const post = { title: 'Cold brew', slug: 'cold-brew', content: '<p>x</p>', excerpt: 'How.' };
    expect(await createPost(site, signIn, post, { request })).toEqual({
      id: 41,
      status: 'draft',
      link: 'https://blog.acme.example/?p=41',
    });
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      body: { ...post, status: 'draft' },
      headers: { authorization: BASIC, 'content-type': 'application/json' },
    });
  });

  it('writes a post without touching its status, and reads one as it stands', async () => {
    const { site, request } = await start({
      'POST /wp-json/wp/v2/posts/7': () => ({ json: { id: 7, status: 'draft', link: null } }),
      'GET /wp-json/wp/v2/posts/7': () => ({
        json: { id: 7, status: 'publish', link: 'https://blog.acme.example/cold-brew/' },
      }),
    });
    await updatePost(site, signIn, '7', { title: 'Cold brew', content: '<p>y</p>' }, { request });
    expect(api.calls[0].body).toEqual({ title: 'Cold brew', content: '<p>y</p>' });
    expect(await readPost(site, signIn, '7', { request })).toEqual({
      id: 7,
      status: 'publish',
      link: 'https://blog.acme.example/cold-brew/',
    });
    expect(api.calls[1].query).toEqual({ context: 'edit' });
  });

  it('reads another user’s post, which this one can’t edit, as none', async () => {
    const { site, request } = await start({
      'GET /wp-json/wp/v2/posts/7': () => ({
        status: 403,
        json: { code: 'rest_forbidden_context' },
      }),
    });
    expect(await readPost(site, signIn, '7', { request })).toBeNull();
  });

  it('reads a post deleted for good as none, and an id that isn’t one as none', async () => {
    const { site, request } = await start({
      'GET /wp-json/wp/v2/posts/7': () => ({
        status: 404,
        json: { code: 'rest_post_invalid_id', message: 'Invalid post ID.' },
      }),
    });
    expect(await readPost(site, signIn, '7', { request })).toBeNull();
    expect(await readPost(site, signIn, '../users', { request })).toBeNull();
    expect(api.calls).toHaveLength(1);
    await expect(updatePost(site, signIn, '7/x', {}, { request })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('says the user can’t, and tries a POST only once', async () => {
    const { site, request } = await start({
      'POST /wp-json/wp/v2/posts': () => ({ status: 403, json: { code: 'rest_cannot_create' } }),
    });
    await expect(
      createPost(site, signIn, { title: 't', content: 'c' }, { request }),
    ).rejects.toMatchObject({
      code: 'no_access',
    });
    api.close();
    const again = await start({ 'POST /wp-json/wp/v2/posts': () => ({ status: 503 }) });
    await expect(
      createPost(again.site, signIn, { title: 't', content: 'c' }, { request: again.request }),
    ).rejects.toMatchObject({ code: 'failed', message: 'WordPress answered 503.' });
    expect(api.calls).toHaveLength(1);
  });
});

describe('revokePassword', () => {
  const UUID = '6b2b6c3e-2f1b-4f5a-9d7e-1c2b3a4d5e6f';

  it('revokes the Application Password the connection signs in with', async () => {
    const { site, request } = await start({
      'GET /wp-json/wp/v2/users/me/application-passwords/introspect': () => ({
        json: { uuid: UUID, name: 'GetCito' },
      }),
      [`DELETE /wp-json/wp/v2/users/me/application-passwords/${UUID}`]: () => ({
        json: { deleted: true },
      }),
    });
    expect(await revokePassword(site, signIn, { request })).toBe(true);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /wp-json/wp/v2/users/me/application-passwords/introspect',
      `DELETE /wp-json/wp/v2/users/me/application-passwords/${UUID}`,
    ]);
  });

  it('says it couldn’t on a site that doesn’t tell a password its id', async () => {
    const { site, request } = await start({});
    expect(await revokePassword(site, signIn, { request })).toBe(false);
  });
});

describe('readPostState and answersAsWordPress (the published check)', () => {
  it('reads a post this user can’t edit as the public sees it: a Contributor’s, published', async () => {
    const { site, request } = await start({
      'GET /wp-json/wp/v2/posts/7': (call) =>
        call.query.context === 'edit'
          ? { status: 403, json: { code: 'rest_forbidden_context' } }
          : { json: { id: 7, status: 'publish', link: 'https://blog.acme.example/cold-brew/' } },
    });
    expect(await readPostState(site, signIn, '7', { request })).toEqual({
      id: 7,
      status: 'publish',
      link: 'https://blog.acme.example/cold-brew/',
    });
    expect(api.calls.map((c) => c.query.context)).toEqual(['edit', 'view']);
  });

  it('throws, never reading as gone, a post it can’t read either way; null for one gone', async () => {
    const { site, request } = await start({
      'GET /wp-json/wp/v2/posts/7': () => ({ status: 403, json: { code: 'rest_forbidden' } }),
      'GET /wp-json/wp/v2/posts/8': () => ({ status: 404, json: { code: 'rest_post_invalid_id' } }),
    });
    await expect(readPostState(site, signIn, '7', { request })).rejects.toMatchObject({
      code: 'failed',
    });
    expect(await readPostState(site, signIn, '8', { request })).toBeNull();
  });

  it('says whether the site answers as WordPress now', async () => {
    let checked = await start({ 'GET /wp-json/': () => ({ json: { namespaces: ['wp/v2'] } }) });
    expect(await answersAsWordPress(checked.site, signIn, { request: checked.request })).toBe(true);
    expect(api.calls[0].query).toEqual({ _fields: 'namespaces' });
    api.close();
    checked = await start({});
    expect(await answersAsWordPress(checked.site, signIn, { request: checked.request })).toBe(
      false,
    );
  });
});

describe('publishPost (AUTONOMOUS-GO-LIVE PR 9)', () => {
  it('sets the post live, nothing else, and answers its link', async () => {
    const { site, request } = await start({
      'POST /wp-json/wp/v2/posts/7': () => ({
        json: { id: 7, status: 'publish', link: 'https://blog.acme.example/cold-brew/' },
      }),
    });
    expect(await publishPost(site, signIn, '7', { request })).toEqual({
      id: 7,
      status: 'publish',
      link: 'https://blog.acme.example/cold-brew/',
    });
    expect(api.calls[0]).toMatchObject({ method: 'POST', body: { status: 'publish' } });
    expect(api.calls[0].headers.authorization).toBe(BASIC);
    await expect(publishPost(site, signIn, 'x', { request })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('unpublishPost (AUTONOMOUS-GO-LIVE PR 10)', () => {
  it('sets the post back to a draft, nothing else', async () => {
    const { site, request } = await start({
      'POST /wp-json/wp/v2/posts/7': () => ({
        json: { id: 7, status: 'draft', link: 'https://blog.acme.example/?p=7' },
      }),
    });
    expect(await unpublishPost(site, signIn, '7', { request })).toMatchObject({
      id: 7,
      status: 'draft',
    });
    expect(api.calls[0]).toMatchObject({ method: 'POST', body: { status: 'draft' } });
    await expect(unpublishPost(site, signIn, 'x', { request })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
