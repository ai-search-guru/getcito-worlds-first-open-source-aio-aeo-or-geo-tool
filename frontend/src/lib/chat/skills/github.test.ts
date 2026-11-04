// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseGithubUrl, readGithubSkill } from './github';

/**
 * A skill from a GitHub folder (CHAT-13 item 14, W3-09b): only github.com
 * links; the ref pinned to its commit; only GitHub's own hosts asked, no
 * redirect followed; its SKILL.md and license read, the rest listed. No
 * request leaves the test.
 */

const SHA = 'a'.repeat(40);
const SKILL = '---\nname: copy-editing\ndescription: Tightens copy.\nlicense: MIT\n---\nRead it.\n';

/** GitHub as the fake fetch answers it: by URL, else 404. */
function github(routes: Record<string, () => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const route = routes[url];
    return route ? route() : new Response('Not Found', { status: 404 });
  });
  return { fetch, calls };
}
const json = (body: unknown) => () => Response.json(body);
const text = (body: string) => () => new Response(body);

const API = 'https://api.github.com/repos/acme/skills';
const RAW = `https://raw.githubusercontent.com/acme/skills/${SHA}`;

describe('parseGithubUrl', () => {
  it('reads a repository, a folder and a SKILL.md link', () => {
    expect(parseGithubUrl('https://github.com/acme/skills')).toEqual({
      owner: 'acme',
      repo: 'skills',
      ref: null,
      path: '',
    });
    expect(parseGithubUrl('https://github.com/acme/skills/tree/v1.2/copy-editing')).toEqual({
      owner: 'acme',
      repo: 'skills',
      ref: 'v1.2',
      path: 'copy-editing',
    });
    expect(
      parseGithubUrl('https://github.com/acme/skills/blob/main/copy-editing/SKILL.md'),
    ).toEqual({ owner: 'acme', repo: 'skills', ref: 'main', path: 'copy-editing' });
  });

  it('takes nothing but https github.com links to a folder or its SKILL.md', () => {
    for (const link of [
      'http://github.com/acme/skills',
      'https://gitlab.com/acme/skills',
      'https://github.com.evil.example/acme/skills',
      'https://user:pass@github.com/acme/skills',
      'https://github.com:8443/acme/skills',
      'https://github.com/acme',
      'https://github.com/acme/skills/tree/main/../../etc',
      'https://github.com/acme/skills/blob/main/README.md',
      'https://github.com/acme/skills/issues/1',
      'https://github.com/acme/skills/tree/main/%E0%A4%A',
      'not a link',
    ]) {
      expect(parseGithubUrl(link), link).toBeNull();
    }
  });
});

describe('readGithubSkill', () => {
  it('pins the ref to its commit, reads the SKILL.md and LICENSE, and lists the rest', async () => {
    const { fetch, calls } = github({
      [`${API}/commits/v1.2`]: text(SHA),
      [`${API}/contents/copy-editing?ref=${SHA}`]: json([
        { path: 'copy-editing/SKILL.md', type: 'file', size: 80 },
        { path: 'copy-editing/LICENSE', type: 'file', size: 1000 },
        { path: 'copy-editing/scripts', type: 'dir' },
      ]),
      [`${API}/contents/copy-editing/scripts?ref=${SHA}`]: json([
        { path: 'copy-editing/scripts/run.sh', type: 'file', size: 10 },
      ]),
      [`${RAW}/copy-editing/SKILL.md`]: text(SKILL),
      [`${RAW}/copy-editing/LICENSE`]: text('MIT License'),
    });
    const read = await readGithubSkill('https://github.com/acme/skills/tree/v1.2/copy-editing', {
      fetch,
      token: 'gh-test',
    });
    if (!read.ok) throw new Error(JSON.stringify(read.refusal));
    expect(read.value.commitSha).toBe(SHA);
    expect(read.value.sourceUrl).toBe(`https://github.com/acme/skills/tree/${SHA}/copy-editing`);
    expect(read.value.files.map((f) => [f.path, f.bytes ? 'read' : 'listed'])).toEqual([
      ['SKILL.md', 'read'],
      ['LICENSE', 'read'],
      ['scripts/run.sh', 'listed'],
    ]);
    // Never followed, and signed only toward the API.
    for (const call of calls) expect(call.init.redirect).toBe('manual');
    const signed = calls.filter((c) => (c.init.headers as Record<string, string>).Authorization);
    expect(signed.every((c) => c.url.startsWith('https://api.github.com/'))).toBe(true);
    expect(signed.length).toBeGreaterThan(0);
  });

  it('reads the repository’s license when the folder has none, at its default branch', async () => {
    const { fetch } = github({
      [`${API}/commits/HEAD`]: text(SHA),
      [`${API}/contents/?ref=${SHA}`]: json([{ path: 'SKILL.md', type: 'file', size: 80 }]),
      [`${RAW}/SKILL.md`]: text(SKILL),
      [`${API}/license?ref=${SHA}`]: json({
        encoding: 'base64',
        content: Buffer.from('MIT License\nPermission is hereby granted, free of charge').toString(
          'base64',
        ),
      }),
    });
    const read = await readGithubSkill('https://github.com/acme/skills', { fetch, token: null });
    expect(read.ok && read.value.files.map((f) => f.path)).toEqual(['SKILL.md', 'LICENSE']);
  });

  it('never follows a redirect, and says GitHub’s refusals', async () => {
    const redirect = github({
      [`${API}/commits/main`]: () =>
        new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
    });
    expect(
      await readGithubSkill('https://github.com/acme/skills/tree/main/x', {
        fetch: redirect.fetch,
        token: null,
      }),
    ).toEqual({ ok: false, refusal: { code: 'github_redirect' } });
    expect(redirect.calls).toHaveLength(1);

    const missing = github({});
    expect(
      await readGithubSkill('https://github.com/acme/skills', {
        fetch: missing.fetch,
        token: null,
      }),
    ).toEqual({ ok: false, refusal: { code: 'github_not_found' } });
    const busy = github({ [`${API}/commits/HEAD`]: () => new Response('', { status: 403 }) });
    expect(
      await readGithubSkill('https://github.com/acme/skills', { fetch: busy.fetch, token: null }),
    ).toEqual({ ok: false, refusal: { code: 'github_busy' } });
    expect(
      await readGithubSkill('https://example.com/acme/skills', { fetch: busy.fetch, token: null }),
    ).toEqual({ ok: false, refusal: { code: 'github_url' } });
  });

  it('refuses a symlink, a folder with no SKILL.md (its subfolders unread), and a file too large', async () => {
    const pinned = `https://github.com/acme/skills/tree/${SHA}/x`;
    const link = github({
      [`${API}/contents/x?ref=${SHA}`]: json([
        { path: 'x/SKILL.md', type: 'file' },
        { path: 'x/data', type: 'symlink' },
      ]),
    });
    expect(await readGithubSkill(pinned, { fetch: link.fetch, token: null })).toEqual({
      ok: false,
      refusal: { code: 'symlink', detail: { path: 'data' } },
    });
    // A pinned SHA needs no commit lookup.
    expect(link.calls.some((c) => c.url.includes('/commits/'))).toBe(false);

    const none = github({
      [`${API}/contents/x?ref=${SHA}`]: json([{ path: 'x/sub', type: 'dir' }]),
    });
    expect(await readGithubSkill(pinned, { fetch: none.fetch, token: null })).toEqual({
      ok: false,
      refusal: { code: 'no_skill_file' },
    });
    expect(none.calls).toHaveLength(1);

    const large = github({
      [`${API}/contents/x?ref=${SHA}`]: json([{ path: 'x/SKILL.md', type: 'file' }]),
      [`${RAW}/x/SKILL.md`]: () =>
        new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } }),
    });
    expect(await readGithubSkill(pinned, { fetch: large.fetch, token: null })).toEqual({
      ok: false,
      refusal: { code: 'too_large' },
    });
  });
});
