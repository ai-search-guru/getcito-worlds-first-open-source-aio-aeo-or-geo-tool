import { MAX_FILES, MAX_UPLOAD, type ImportFile } from './import';

/**
 * A skill from a public GitHub folder (CHAT-13 item 14, Chat Wave 3
 * W3-09b): a github.com link to a repository, or to a folder or a SKILL.md
 * in it. The folder is read at one commit, the link's branch or tag
 * resolved to its SHA, so the skill never changes by itself: its source is
 * kept pinned to that commit. Only GitHub's own hosts are asked (GITHUB_
 * HOSTS), over https, and a redirect is never followed. The folder's
 * SKILL.md and LICENSE are read; its other files are listed only, for the
 * review's "removed" list. With no LICENSE in the folder, the repository's
 * is read. GITHUB_TOKEN, when set, signs the API's requests (a token that
 * reads public repositories only: Wave 3 decision 5). Server only.
 */

/** The only hosts asked. */
export const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'api.github.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
]);

/** The most folders read for the file list, and the largest LICENSE read. */
const MAX_FOLDERS = 20;
const MAX_LICENSE_BYTES = 200 * 1024;
const TIMEOUT_MS = 10_000;

export type GithubRefusalCode =
  | 'github_url'
  | 'github_not_found'
  | 'github_busy'
  | 'github_failed'
  | 'github_redirect'
  | 'too_large'
  | 'too_many_files'
  | 'symlink'
  | 'no_skill_file';

export type GithubRefusal = { code: GithubRefusalCode; detail?: Record<string, string | number> };

/** A GitHub folder, as a link names it: its ref (a branch, a tag or a SHA), or null for the default. */
export interface GithubFolder {
  owner: string;
  repo: string;
  ref: string | null;
  /** The folder's path in the repository; '' for its root. */
  path: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * The folder a github.com link names, or null for any other link: https,
 * github.com, no sign-in or port, `/{owner}/{repo}`, then `/tree/{ref}/…`
 * for a folder or `/blob/{ref}/…/SKILL.md` for its file. A branch name with
 * a slash in it isn't read (link the folder at a tag or a commit instead).
 */
export function parseGithubUrl(raw: string): GithubFolder | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    // A malformed % sequence.
    return null;
  }
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  if (parts.length === 2) return { owner, repo, ref: null, path: '' };
  const [, , kind, ref, ...rest] = parts;
  if ((kind !== 'tree' && kind !== 'blob') || !ref || !REF.test(ref)) return null;
  if (rest.some((p) => p === '..' || p === '.' || p.includes('\\'))) return null;
  if (kind === 'blob') {
    // A file: only its SKILL.md, read as its folder.
    if (rest[rest.length - 1] !== 'SKILL.md') return null;
    rest.pop();
  }
  return { owner, repo, ref, path: rest.join('/') };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface GithubOptions {
  fetch?: Fetcher;
  /** Defaults to GITHUB_TOKEN. */
  token?: string | null;
}

type Got = { ok: true; bytes: Uint8Array } | { ok: false; refusal: GithubRefusal };

const refused = (code: GithubRefusalCode, detail?: GithubRefusal['detail']) => ({
  ok: false as const,
  refusal: detail ? { code, detail } : { code },
});

/** A GET to one of GitHub's hosts: no redirect followed, at most `max` bytes. */
async function get(url: string, accept: string, max: number, options: GithubOptions): Promise<Got> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !GITHUB_HOSTS.has(target.host)) return refused('github_url');
  const headers: Record<string, string> = { Accept: accept, 'User-Agent': 'GetCito' };
  const token = options.token === undefined ? process.env.GITHUB_TOKEN : options.token;
  if (target.host === 'api.github.com') {
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return refused('github_failed');
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return refused('github_redirect');
  }
  if (res.status === 404) return refused('github_not_found');
  if (res.status === 403 || res.status === 429) return refused('github_busy');
  if (!res.ok) return refused('github_failed');
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > max) return refused('too_large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > max) return refused('too_large');
  return { ok: true, bytes };
}

const api = (folder: Pick<GithubFolder, 'owner' | 'repo'>, path: string) =>
  `https://api.github.com/repos/${encodeURIComponent(folder.owner)}/${encodeURIComponent(folder.repo)}${path}`;
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** The commit a ref names: a SHA as it is, a branch or tag asked of the API. */
async function commitOf(folder: GithubFolder, options: GithubOptions) {
  if (folder.ref && SHA.test(folder.ref)) return { ok: true as const, sha: folder.ref };
  const got = await get(
    api(folder, `/commits/${encodeURIComponent(folder.ref ?? 'HEAD')}`),
    'application/vnd.github.sha',
    1024,
    options,
  );
  if (!got.ok) return got;
  const sha = new TextDecoder().decode(got.bytes).trim();
  return SHA.test(sha) ? { ok: true as const, sha } : refused('github_failed');
}

interface ContentEntry {
  name?: unknown;
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

/**
 * The folder's files at the commit, its subfolders read too: paths
 * relative to the folder. A symlink refuses the import; a submodule is
 * listed as left out.
 */
async function listFolder(
  folder: GithubFolder,
  sha: string,
  options: GithubOptions,
): Promise<
  { ok: true; files: { path: string; size: number }[] } | { ok: false; refusal: GithubRefusal }
> {
  const files: { path: string; size: number }[] = [];
  const queue = [folder.path];
  let read = 0;
  while (queue.length > 0) {
    const at = queue.shift() as string;
    if (++read > MAX_FOLDERS) return refused('too_many_files', { max: MAX_FILES });
    const got = await get(
      api(folder, `/contents/${encodePath(at)}?ref=${sha}`),
      'application/vnd.github+json',
      MAX_UPLOAD,
      options,
    );
    if (!got.ok) return got;
    let entries: unknown;
    try {
      entries = JSON.parse(new TextDecoder().decode(got.bytes));
    } catch {
      return refused('github_failed');
    }
    // A file, not a folder: the link names no skill folder.
    if (!Array.isArray(entries)) return refused('no_skill_file');
    for (const entry of entries as ContentEntry[]) {
      const path = typeof entry.path === 'string' ? entry.path : null;
      if (!path) continue;
      const relative = folder.path ? path.slice(folder.path.length + 1) : path;
      if (entry.type === 'symlink') return refused('symlink', { path: relative });
      if (entry.type === 'dir') queue.push(path);
      else files.push({ path: relative, size: typeof entry.size === 'number' ? entry.size : 0 });
      if (files.length > MAX_FILES) return refused('too_many_files', { max: MAX_FILES });
    }
    // Its own folder first: without a SKILL.md there, its subfolders aren't read.
    if (read === 1 && !files.some((f) => f.path === 'SKILL.md')) return refused('no_skill_file');
  }
  return { ok: true, files };
}

const LICENSE_FILE = /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i;

/** The repository's license file at the commit, or null when it has none. */
async function repoLicense(
  folder: GithubFolder,
  sha: string,
  options: GithubOptions,
): Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; refusal: GithubRefusal }> {
  const got = await get(
    api(folder, `/license?ref=${sha}`),
    'application/vnd.github+json',
    MAX_LICENSE_BYTES * 2,
    options,
  );
  if (!got.ok) return got.refusal.code === 'github_not_found' ? { ok: true, bytes: null } : got;
  try {
    const body = JSON.parse(new TextDecoder().decode(got.bytes)) as {
      content?: unknown;
      encoding?: unknown;
    };
    if (body.encoding !== 'base64' || typeof body.content !== 'string') {
      return { ok: true, bytes: null };
    }
    return { ok: true, bytes: Uint8Array.from(Buffer.from(body.content, 'base64')) };
  } catch {
    return refused('github_failed');
  }
}

/** The raw file at the commit, at most `max` bytes. */
const raw = (
  folder: GithubFolder,
  sha: string,
  path: string,
  max: number,
  options: GithubOptions,
) =>
  get(
    `https://raw.githubusercontent.com/${encodeURIComponent(folder.owner)}/${encodeURIComponent(folder.repo)}/${sha}/${encodePath(path)}`,
    'text/plain',
    max,
    options,
  );

export interface GithubSkill {
  /** The import's files: SKILL.md and LICENSE read, the rest listed. */
  files: ImportFile[];
  /** The folder's link, pinned to its commit. */
  sourceUrl: string;
  commitSha: string;
}

/**
 * Reads a skill's folder from a github.com link: the commit it is at, its
 * file list, its SKILL.md and its license. Refusals as values.
 */
export async function readGithubSkill(
  link: string,
  options: GithubOptions = {},
): Promise<{ ok: true; value: GithubSkill } | { ok: false; refusal: GithubRefusal }> {
  const folder = parseGithubUrl(link);
  if (!folder) return refused('github_url');
  const commit = await commitOf(folder, options);
  if (!commit.ok) return commit;
  const { sha } = commit;
  const listed = await listFolder(folder, sha, options);
  if (!listed.ok) return listed;
  if (!listed.files.some((f) => f.path === 'SKILL.md')) return refused('no_skill_file');

  const full = (path: string) => (folder.path ? `${folder.path}/${path}` : path);
  const files: ImportFile[] = [];
  let licensed = false;
  for (const file of listed.files) {
    if (file.path === 'SKILL.md') {
      const got = await raw(folder, sha, full(file.path), MAX_UPLOAD, options);
      if (!got.ok) return got;
      files.push({ path: file.path, bytes: got.bytes });
    } else if (LICENSE_FILE.test(file.path)) {
      const got = await raw(folder, sha, full(file.path), MAX_LICENSE_BYTES, options);
      if (!got.ok) return got;
      files.push({ path: file.path, bytes: got.bytes });
      licensed = true;
    } else {
      files.push({ path: file.path, bytes: null });
    }
  }
  if (!licensed) {
    const license = await repoLicense(folder, sha, options);
    if (!license.ok) return license;
    if (license.bytes) files.push({ path: 'LICENSE', bytes: license.bytes });
  }
  const tail = folder.path ? `/${encodePath(folder.path)}` : '';
  return {
    ok: true,
    value: {
      files,
      sourceUrl: `https://github.com/${folder.owner}/${folder.repo}/tree/${sha}${tail}`,
      commitSha: sha,
    },
  };
}
