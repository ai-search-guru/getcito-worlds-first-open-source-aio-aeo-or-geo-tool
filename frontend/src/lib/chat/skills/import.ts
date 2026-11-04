import { unzipSync } from 'fflate';
import { checkSkillFile, parseSkillFile, scanSkillText } from './format';
import { MAX_TITLE, skillChecksum, skillFileText, type SkillParts } from './skillFile';

/**
 * Reading a skill someone imports (CHAT-13 items 13–17, Chat Wave 3
 * W3-09a): a SKILL.md, a .zip of its folder, or the files a GitHub folder
 * holds (github.ts). What comes out is instructions only, held for an
 * Admin's review before anyone runs it:
 *
 *   - The archive is read from its central directory before anything is
 *     unpacked: at most MAX_UPLOAD bytes, MAX_FILES files and MAX_UNPACKED
 *     bytes unpacked (a zip bomb never inflates), and refused whole for a
 *     path that leaves its folder, a symlink, an archive inside it, or a
 *     file that isn't text.
 *   - One SKILL.md, at the root or in one folder. Scripts, hooks and every
 *     other file are left out (instructions only); in the file,
 *     `allowed-tools` and the front matter's other unknown fields, `!command`
 *     lines and HTML comments are removed. What was removed is listed for
 *     the reviewer, in words ("scripts/ (3 files)").
 *   - Its license: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC, from
 *     its front matter or its LICENSE file (Wave 3 decision 6); none, or a
 *     NonCommercial, ShareAlike or Commons Clause one, is refused.
 *   - Checked as a SKILL.md (format.ts): a skill whose form is wrong is
 *     refused; one the scan blocks is kept as `blocked`, which an Admin
 *     sees but can't approve (item 18); the rest wait as `pending_review`.
 *
 * Pure: no database, no network.
 */

/** The largest upload: a SKILL.md or a .zip (item 13). */
export const MAX_UPLOAD = 5 * 1024 * 1024;
/** The most a .zip may unpack to, all its files together, and how many files it may hold. */
export const MAX_UNPACKED = 5 * 1024 * 1024;
export const MAX_FILES = 200;
/** The longest license text kept (00458). */
export const MAX_LICENSE_TEXT = 30_000;
/** The longest line of the removed list, and the list's most bytes as JSON (00458 keeps 16,000). */
export const MAX_REMOVED_ITEM = 200;
export const MAX_REMOVED_BYTES = 15_000;

/** The licenses an import may carry (Wave 3 decision 6), as SPDX ids. */
export const IMPORT_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
] as const;
export type ImportLicense = (typeof IMPORT_LICENSES)[number];

/** Why an import is refused before it is kept: chatSkills.refusal.{code} says it. */
export type ImportRefusalCode =
  | 'too_large'
  | 'not_zip'
  | 'too_many_files'
  | 'unsafe_path'
  | 'symlink'
  | 'nested_archive'
  | 'binary_file'
  | 'no_skill_file'
  | 'several_skills'
  | 'invalid'
  | 'license';

export type ImportRefusal = { code: ImportRefusalCode; detail?: Record<string, string | number> };

/** A file of the import: its path inside the skill's folder, and its bytes (null: listed, not read). */
export interface ImportFile {
  path: string;
  bytes: Uint8Array | null;
}

/** A skill read from an import, ready to keep for review. */
export interface ParsedImport {
  parts: SkillParts & { license: ImportLicense };
  /** The LICENSE file's text, when there is one. */
  licenseText: string | null;
  checksum: string;
  /** What the scan found: `blocks` keep it `blocked`, `warns` go to the reviewer. */
  scan: { blocks: string[]; warns: string[] };
  /** What was removed, in words, for the reviewer (removed_json). */
  removed: string[];
  status: 'pending_review' | 'blocked';
}

export type ImportParse = { ok: true; value: ParsedImport } | { ok: false; refusal: ImportRefusal };

const refuse = (code: ImportRefusalCode, detail?: ImportRefusal['detail']): ImportParse => ({
  ok: false,
  refusal: detail ? { code, detail } : { code },
});

// ─── The archive ────────────────────────────────────────────────────────────

const ARCHIVES = /\.(zip|tar|tgz|gz|bz2|xz|7z|rar|jar|war|zst|lz|lzma|z)$/i;
/** Left out unseen: what an OS adds when it zips a folder. */
const OS_LITTER = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/;
/** A unix file type in a zip entry's external attributes: a symlink. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

interface ZipEntry {
  name: string;
  size: number;
  symlink: boolean;
  directory: boolean;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/**
 * A .zip's entries as its central directory lists them, without
 * unpacking: names, unpacked sizes and symlinks. Null when it isn't one
 * this reads (no end record, ZIP64, a directory past the file), or when
 * fflate could read other entries than these: its count is the one on this
 * disk (+8) and a ZIP64 locator before the end record moves its directory,
 * so both counts must agree, no locator, and the entries fill the directory.
 */
function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  // The end record: 22 bytes, then a comment of up to 65,535.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let at = bytes.length - 22; at >= floor; at--) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = u16(bytes, end + 10);
  if (u16(bytes, end + 8) !== count) return null;
  if (end >= 20 && u32(bytes, end - 20) === 0x07064b50) return null;
  const size = u32(bytes, end + 12);
  const offset = u32(bytes, end + 16);
  // ZIP64 isn't read: a skill never needs it.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
  if (offset + size > end) return null;
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(bytes, at) !== 0x02014b50) return null;
    const unpacked = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const external = u32(bytes, at + 38);
    if (unpacked === 0xffffffff) return null;
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const mode = external >>> 16;
    entries.push({
      name,
      size: unpacked,
      symlink: (mode & S_IFMT) === S_IFLNK,
      directory: name.endsWith('/'),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== offset + size) return null;
  return entries;
}

/** A path that stays inside its folder: relative, no `..`, no backslash, no drive. */
function safePath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return !name.split('/').some((part) => part === '..' || part === '.');
}

/**
 * A .zip's files, checked before anything is unpacked: its size, how many
 * files, how much they unpack to, their paths, symlinks and archives
 * inside. OS litter and folders are left out.
 */
export function readZip(
  bytes: Uint8Array,
): { ok: true; files: ImportFile[] } | { ok: false; refusal: ImportRefusal } {
  if (bytes.length > MAX_UPLOAD) return { ok: false, refusal: { code: 'too_large' } };
  const entries = zipEntries(bytes);
  if (!entries) return { ok: false, refusal: { code: 'not_zip' } };
  const files = entries.filter((e) => !e.directory && !OS_LITTER.test(e.name));
  if (files.length > MAX_FILES) {
    return { ok: false, refusal: { code: 'too_many_files', detail: { max: MAX_FILES } } };
  }
  let total = 0;
  for (const entry of entries) {
    if (!safePath(entry.name.replace(/\/$/, ''))) {
      return { ok: false, refusal: { code: 'unsafe_path', detail: { path: entry.name } } };
    }
    if (entry.symlink) {
      return { ok: false, refusal: { code: 'symlink', detail: { path: entry.name } } };
    }
    if (!entry.directory && ARCHIVES.test(entry.name)) {
      return { ok: false, refusal: { code: 'nested_archive', detail: { path: entry.name } } };
    }
    total += entry.size;
  }
  if (total > MAX_UNPACKED) return { ok: false, refusal: { code: 'too_large' } };
  // Only what was checked unpacks: each name once, at the size checked, MAX_UNPACKED in all.
  const wanted = new Map(files.map((f) => [f.name, f.size]));
  const seen = new Set<string>();
  let inflated = 0;
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter: (file) => {
        const size = wanted.get(file.name);
        if (size === undefined) return false;
        inflated += file.originalSize;
        if (seen.has(file.name) || file.originalSize !== size || inflated > MAX_UNPACKED) {
          throw new Error('the archive unpacks other than its directory says');
        }
        seen.add(file.name);
        return true;
      },
    });
  } catch {
    return { ok: false, refusal: { code: 'not_zip' } };
  }
  return {
    ok: true,
    files: files.map((f) => ({ path: f.name, bytes: unpacked[f.name] ?? null })),
  };
}

// ─── What is kept, and what is removed ──────────────────────────────────────

const SKILL_FILE = /(^|\/)SKILL\.md$/;
const LICENSE_FILE = /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i;
/** A file that would run, wherever it is (scripts/ is left out whole). */
const EXECUTABLE =
  /\.(sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php|ps1|psm1|bat|cmd|exe|bin|so|dylib|dll|jar)$/i;
const HOOKS = /^(hooks\/|\.claude\/)|(^|\/)hooks\.json$/;

/** The text of a file, or null when it isn't text (a NUL byte, not UTF-8). */
function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);

/** "scripts/ (3 files)", "README.md": what was left out, grouped by its top folder. */
function groupLeftOut(paths: string[]): string[] {
  const folders = new Map<string, number>();
  const loose: string[] = [];
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash < 0) loose.push(path);
    else folders.set(path.slice(0, slash + 1), (folders.get(path.slice(0, slash + 1)) ?? 0) + 1);
  }
  return [...[...folders].map(([folder, n]) => `${folder} (${files(n)})`), ...loose.sort()];
}

/** The fields a SKILL.md keeps (format.ts); `allowed-tools` and the rest are removed. */
const KEPT_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata']);

/**
 * The front matter without the fields a skill may not carry: each with the
 * lines under it (an indented value, a list). Their names, for the list.
 */
function cleanFrontMatter(front: string): { text: string; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];
  let dropping = false;
  for (const line of front.split('\n')) {
    const top = /^([A-Za-z0-9_-]+):/.exec(line);
    if (top) {
      dropping = !KEPT_FIELDS.has(top[1]);
      if (dropping) removed.push(top[1]);
    } else if (dropping && (/^\s/.test(line) || /^-\s/.test(line) || line.trim() === '')) {
      continue;
    } else {
      dropping = false;
    }
    if (!dropping) kept.push(line);
  }
  return { text: kept.join('\n'), removed };
}

/** A Claude Code `!command`: a line that starts with one, or one in backticks inside a line. */
const COMMAND_LINE = /^\s*!\s*`?[A-Za-z./].*$/gm;
const INLINE_COMMAND = /!`[^`\n]*`/g;

/** The body without HTML comments and `!command` lines; how many of each went. */
function cleanBody(body: string): { text: string; comments: number; commands: number } {
  let comments = 0;
  let text = body.replace(/<!--[\s\S]*?-->/g, () => {
    comments++;
    return '';
  });
  // A comment left open: its line goes.
  text = text.replace(/^.*<!--.*$/gm, () => {
    comments++;
    return '';
  });
  let commands = 0;
  text = text.replace(COMMAND_LINE, () => {
    commands++;
    return '';
  });
  text = text.replace(INLINE_COMMAND, () => {
    commands++;
    return '';
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), comments, commands };
}

// ─── The license ────────────────────────────────────────────────────────────

/** Licenses an import may never carry (Wave 3 decision 6). */
const REFUSED_LICENSE = [
  /non-?commercial/i,
  /\bCC[- ]BY[- ](NC|SA)\b/i,
  /share-?alike/i,
  /commons clause/i,
];

/** A license name as its SPDX id, when it is one an import may carry. */
function spdxOf(name: string): ImportLicense | null {
  const plain = name
    .trim()
    .replace(/\s+license$/i, '')
    .replace(/^the\s+/i, '');
  if (/^MIT$/i.test(plain)) return 'MIT';
  if (/^apache([- ]license)?[- ,]*(v(ersion)?\s*)?2(\.0)?$/i.test(plain)) return 'Apache-2.0';
  if (/^BSD[- ]?3[- ]?clause$/i.test(plain) || /^BSD[- ]3$/i.test(plain)) return 'BSD-3-Clause';
  if (/^BSD[- ]?2[- ]?clause$/i.test(plain) || /^BSD[- ]2$/i.test(plain)) return 'BSD-2-Clause';
  if (/^ISC$/i.test(plain)) return 'ISC';
  return null;
}

/** A LICENSE file's license, from its words. */
function spdxOfText(text: string): ImportLicense | null {
  const flat = text.replace(/\s+/g, ' ');
  if (/Permission is hereby granted, free of charge/i.test(flat)) return 'MIT';
  if (/Apache License,? Version 2\.0/i.test(flat)) return 'Apache-2.0';
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(flat)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(flat)) {
    return /Neither the name/i.test(flat) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  return null;
}

/**
 * The import's license: the LICENSE file's when it names one, else the
 * front matter's. Refused for none, one not accepted, or words that make it
 * NonCommercial, ShareAlike or a Commons Clause.
 */
function licenseOf(
  declared: string | undefined,
  licenseText: string | null,
): { ok: true; license: ImportLicense } | { ok: false } {
  for (const said of [declared ?? '', licenseText ?? '']) {
    if (REFUSED_LICENSE.some((re) => re.test(said))) return { ok: false };
  }
  const license = (licenseText && spdxOfText(licenseText)) || (declared && spdxOf(declared));
  return license ? { ok: true, license } : { ok: false };
}

// ─── The skill ──────────────────────────────────────────────────────────────

/**
 * A skill from an import's files: its one SKILL.md (at the root or in one
 * folder), cleaned, its license, checked and scanned. Paths are the
 * import's own (a .zip's, or a GitHub folder's).
 */
export function parseSkillImport(input: ImportFile[]): ImportParse {
  const skillFiles = input.filter((f) => SKILL_FILE.test(f.path));
  if (skillFiles.length === 0) return refuse('no_skill_file');
  if (skillFiles.length > 1) return refuse('several_skills');
  const skillFile = skillFiles[0];
  // The skill's folder: what its SKILL.md is in; files outside it aren't the skill's.
  const root = skillFile.path.slice(0, skillFile.path.length - 'SKILL.md'.length);
  const own = input
    .filter((f) => f.path.startsWith(root))
    .map((f) => ({ ...f, path: f.path.slice(root.length) }));

  const scripts: string[] = [];
  const hooks: string[] = [];
  const leftOut: string[] = [];
  let licenseText: string | null = null;
  let skillText: string | null = null;
  for (const file of own) {
    if (file.path.startsWith('scripts/') || EXECUTABLE.test(file.path)) {
      scripts.push(file.path);
      continue;
    }
    if (HOOKS.test(file.path)) {
      hooks.push(file.path);
      continue;
    }
    // Only text goes on: a file that isn't refuses the import whole.
    const text = file.bytes ? textOf(file.bytes) : null;
    if (file.bytes && text === null) return refuse('binary_file', { path: file.path });
    if (file.path === 'SKILL.md') skillText = text;
    // An empty LICENSE file is no text (00458 keeps 1 to 30,000 characters).
    else if (LICENSE_FILE.test(file.path) && text !== null) licenseText = text || null;
    else leftOut.push(file.path);
  }
  if (skillText === null) return refuse('no_skill_file');

  const removed: string[] = [];
  const scriptFolder = scripts.filter((p) => p.startsWith('scripts/')).length;
  if (scriptFolder > 0) removed.push(`scripts/ (${files(scriptFolder)})`);
  const loose = scripts.length - scriptFolder;
  if (loose > 0) removed.push(`${loose} executable ${loose === 1 ? 'file' : 'files'}`);
  if (hooks.length > 0) removed.push(`hooks (${files(hooks.length)})`);
  removed.push(...groupLeftOut(leftOut));

  // The file, cleaned: its front matter's unknown fields, then its body's comments and commands.
  const normalized = skillText.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) {
    return refuse('invalid', {
      problems: 'the file must start with front matter between two --- lines',
    });
  }
  const front = cleanFrontMatter(match[1]);
  for (const field of front.removed) {
    removed.push(field === 'allowed-tools' ? 'allowed-tools' : `front matter: ${field}`);
  }
  const body = cleanBody(normalized.slice(match[0].length));
  if (body.commands > 0) {
    removed.push(body.commands === 1 ? '1 command line' : `${body.commands} command lines`);
  }
  if (body.comments > 0) {
    removed.push(body.comments === 1 ? '1 HTML comment' : `${body.comments} HTML comments`);
  }
  const removedList = fitRemoved(removed);
  if (!removedList) {
    return refuse('invalid', { problems: 'it holds too many files to list what was removed' });
  }
  const { skill, problems: formProblems } = parseSkillFile(`---\n${front.text}\n---\n${body.text}`);
  if (formProblems.length > 0) return refuse('invalid', { problems: formProblems.join('; ') });

  const license = licenseOf(skill.license, licenseText);
  if (!license.ok) return refuse('license');
  if (licenseText && licenseText.length > MAX_LICENSE_TEXT) {
    licenseText = licenseText.slice(0, MAX_LICENSE_TEXT);
  }

  const name = skill.name ?? '';
  const title = (skill.metadata.title ?? name.replace(/-/g, ' ')).trim();
  if (title.length > MAX_TITLE) {
    return refuse('invalid', { problems: `metadata.title is over ${MAX_TITLE} characters` });
  }
  const parts: SkillParts & { license: ImportLicense } = {
    name,
    title,
    description: skill.description ?? '',
    body: body.text,
    license: license.license,
    compatibility: skill.compatibility ?? null,
  };
  // Checked as it is kept: the scan's findings block it, the form's refuse it.
  const check = checkSkillFile(name, skillFileText(parts));
  const scan = scanAll(parts);
  const problems = check.problems.filter((p) => !scan.blocks.includes(p));
  if (problems.length > 0) return refuse('invalid', { problems: problems.join('; ') });
  return {
    ok: true,
    value: {
      parts,
      licenseText,
      checksum: skillChecksum(parts),
      scan,
      removed: removedList,
      status: scan.blocks.length > 0 ? 'blocked' : 'pending_review',
    },
  };
}

/**
 * The removed list as it is kept: each line at most MAX_REMOVED_ITEM
 * characters, and null when the list is still over MAX_REMOVED_BYTES as
 * JSON (the database's text adds a space after each comma).
 */
function fitRemoved(removed: string[]): string[] | null {
  const fitted = removed.map((line) => {
    const chars = [...line];
    return chars.length > MAX_REMOVED_ITEM
      ? `${chars.slice(0, MAX_REMOVED_ITEM - 1).join('')}…`
      : line;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(fitted)).length + fitted.length;
  return bytes > MAX_REMOVED_BYTES ? null : fitted;
}

/** The scan of a skill as it is kept: its file, and its values as they read (as checkSkillFile). */
function scanAll(parts: SkillParts): { blocks: string[]; warns: string[] } {
  const raw = scanSkillText(skillFileText(parts));
  const read = scanSkillText(
    [parts.name, parts.title, parts.description, parts.license, parts.compatibility]
      .filter((v): v is string => !!v)
      .join('\n'),
  );
  return {
    blocks: [...new Set([...raw.blocks, ...read.blocks])],
    warns: [...new Set([...raw.warns, ...read.warns])],
  };
}

/**
 * An upload: a .zip of the skill's folder, or its SKILL.md alone (by its
 * name, else by its bytes: a .zip starts with PK).
 */
export function parseSkillUpload(fileName: string, bytes: Uint8Array): ImportParse {
  if (bytes.length > MAX_UPLOAD) return refuse('too_large');
  const zipped =
    /\.zip$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03);
  if (zipped) {
    const read = readZip(bytes);
    return read.ok ? parseSkillImport(read.files) : { ok: false, refusal: read.refusal };
  }
  if (!/\.md$/i.test(fileName) && !/^SKILL$/i.test(fileName)) return refuse('no_skill_file');
  return parseSkillImport([{ path: 'SKILL.md', bytes }]);
}
