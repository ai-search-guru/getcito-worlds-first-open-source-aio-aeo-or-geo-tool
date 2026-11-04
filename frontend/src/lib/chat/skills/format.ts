/**
 * The Agent Skills format (CHAT-13 items 1–2, agentskills.io): a skill is a
 * folder `<name>/` with a SKILL.md, YAML front matter and a Markdown body.
 * This reads the front matter, checks the format's rules, and scans the
 * whole file for what a skill may never hold (items 16 and 20). No
 * dependency: the front matter is a small fixed subset of YAML (`key: value`
 * on one line, quoted or plain, and one level of `metadata:`); anything
 * else is refused with a message, never guessed at. Pure: the library test
 * runs it over the repo's /skills folder (library.test.ts).
 */

/** 1–64 characters: lowercase letters, digits and single hyphens inside. */
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_COMPATIBILITY = 500;
/** Body lines past which a skill warns, and past which it is refused (item 2). */
export const WARN_LINES = 500;
export const MAX_LINES = 1000;
/** The largest body, in bytes (item 2). */
export const MAX_BYTES = 50 * 1024;
/** A longer line is an anomaly (item 16). */
export const MAX_LINE_CHARS = 2000;

/** The front matter's fields (item 1). `allowed-tools` is read only to be refused. */
const FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata']);

export interface SkillFile {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  /** `metadata.title` is the display title. */
  metadata: Record<string, string>;
  body: string;
}

export interface SkillCheck {
  skill: SkillFile;
  /** What refuses the skill, each in a sentence. */
  problems: string[];
  /** What a reviewer should see, without refusing it. */
  warnings: string[];
}

/** A plain YAML value that a YAML reader would take for something else. */
const UNSAFE_PLAIN = /^[[\]{}&*!|>%@`#,?-]|: | #/;

function readValue(raw: string, key: string, problems: string[]): string | undefined {
  const value = raw.trim();
  if (value === '') {
    problems.push(`${key} is empty or spread over several lines: write it on one line`);
    return undefined;
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      problems.push(`${key}: its closing quote is missing`);
      return undefined;
    }
    try {
      return JSON.parse(value) as string;
    } catch {
      problems.push(`${key}: its double-quoted text isn't valid`);
      return undefined;
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      problems.push(`${key}: its closing quote is missing`);
      return undefined;
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (UNSAFE_PLAIN.test(value)) {
    problems.push(`${key}: put the text in quotes (it holds ": ", " #" or starts with a mark)`);
    return undefined;
  }
  return value;
}

/** A SKILL.md's front matter and body, with what is wrong with its form. */
export function parseSkillFile(text: string): { skill: SkillFile; problems: string[] } {
  const problems: string[] = [];
  // No prototype: a key like "constructor" is the skill's own, never Object's.
  const skill: SkillFile = { metadata: Object.create(null) as Record<string, string>, body: '' };
  const normalized = text.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) {
    problems.push('the file must start with front matter between two --- lines');
    skill.body = normalized;
    return { skill, problems };
  }
  skill.body = normalized.slice(match[0].length);
  const seen = new Set<string>();
  let inMetadata = false;
  // The indent of metadata's first key: the others keep it.
  let metadataIndent: string | null = null;
  for (const line of match[1].split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^[ ]*\t/.test(line)) {
      problems.push(`"${line.trim()}" is indented with a tab: use spaces`);
      continue;
    }
    const field = /^( *)([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!field) {
      problems.push(`"${line.trim()}" isn't a key: value line`);
      inMetadata = false;
      continue;
    }
    const [, indent, key, after] = field;
    const label = indent ? `metadata.${key}` : key;
    if (after !== '' && !after.startsWith(' ')) {
      problems.push(`${label}: put a space after the colon`);
      continue;
    }
    if (indent) {
      if (!inMetadata) {
        problems.push(`"${line.trim()}" is indented outside metadata`);
        continue;
      }
      metadataIndent ??= indent;
      if (indent !== metadataIndent) {
        problems.push(`${label} is indented unlike the keys before it`);
        continue;
      }
      if (Object.hasOwn(skill.metadata, key)) problems.push(`${label} is there twice`);
      const value = readValue(after, label, problems);
      if (value !== undefined) skill.metadata[key] = value;
      continue;
    }
    inMetadata = false;
    if (seen.has(key)) problems.push(`${key} is there twice`);
    seen.add(key);
    if (key === 'allowed-tools') {
      problems.push('allowed-tools is not allowed: skills run instructions only');
      continue;
    }
    if (!FIELDS.has(key)) {
      problems.push(`${key} is not a SKILL.md field`);
      continue;
    }
    if (key === 'metadata') {
      if (after.trim() !== '') problems.push('metadata takes its keys on the lines under it');
      inMetadata = true;
      continue;
    }
    const value = readValue(after, key, problems);
    if (value !== undefined) (skill as unknown as Record<string, string>)[key] = value;
  }
  return { skill, problems };
}

/**
 * A SKILL.md checked against the format (items 1–2): its name matches its
 * folder, its description fits, and its body is within the limits.
 */
export function checkSkillFile(folder: string, text: string): SkillCheck {
  const { skill, problems } = parseSkillFile(text);
  const warnings: string[] = [];
  const { name, description, compatibility } = skill;
  if (!name) {
    problems.push('name is required');
  } else {
    if (name.length > MAX_NAME) problems.push(`name is over ${MAX_NAME} characters`);
    if (!SKILL_NAME.test(name)) {
      problems.push(
        `name "${name}" may only have lowercase letters, digits and single hyphens inside`,
      );
    }
    if (name !== folder) problems.push(`name "${name}" doesn't match its folder "${folder}"`);
  }
  if (!description) problems.push('description is required');
  else if (description.length > MAX_DESCRIPTION) {
    problems.push(`description is ${description.length} characters (max ${MAX_DESCRIPTION})`);
  }
  if (compatibility && compatibility.length > MAX_COMPATIBILITY) {
    problems.push(`compatibility is over ${MAX_COMPATIBILITY} characters`);
  }
  const lines = skill.body.split('\n').length;
  if (lines > MAX_LINES) problems.push(`the body has ${lines} lines (max ${MAX_LINES})`);
  else if (lines > WARN_LINES) warnings.push(`the body has ${lines} lines (over ${WARN_LINES})`);
  const bytes = new TextEncoder().encode(skill.body).length;
  if (bytes > MAX_BYTES) problems.push(`the body is ${bytes} bytes (max ${MAX_BYTES})`);
  // The file as written, and the front matter's values as they read: a
  // double-quoted value's escapes can spell what the file's text doesn't.
  const values = [
    name,
    description,
    skill.license,
    compatibility,
    ...Object.values(skill.metadata),
  ];
  const raw = scanSkillText(text);
  const read = scanSkillText(values.filter((value): value is string => !!value).join('\n'));
  const blocks = [...new Set([...raw.blocks, ...read.blocks])];
  const warns = [...new Set([...raw.warns, ...read.warns])];
  return { skill, problems: [...problems, ...blocks], warnings: [...warnings, ...warns] };
}

// ─── The scan (item 16, and what a published skill never holds, item 20) ────

/** Zero-width, bidi controls and tag characters: text a reader can't see. */
export const HIDDEN = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]|\uDB40[\uDC00-\uDC7F]/;
const BASE64 = /[A-Za-z0-9+/]{100,}={0,2}/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
/** A figure with a currency: a price ("$49", "49 €", "₺1.200"). */
const PRICE = /[$€£₺]\s?\d|\d\s?[$€£₺]/;
/** A URL that carries a tracking parameter. */
const TRACKING =
  /[?&](utm_[a-z]+|gclid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi)=/i;
/** Text that tries to take over the assistant. */
const ROLE_OVERRIDE = [
  /\bignore (all |any )?(the )?(previous|prior|above|earlier|system) (instructions|rules|prompts?)\b/i,
  /\bdisregard (all |any )?(the )?(previous|prior|above|earlier|system) (instructions|rules|prompts?)\b/i,
  /\bforget (all |any )?(your|the|previous|prior) (instructions|rules)\b/i,
  /\byou are now\b/i,
  /\b(don't|do not|never) (tell|inform) the (user|person)\b/i,
  /\bwithout (telling|informing) the (user|person)\b/i,
  /\bkeep (this|it) (secret|hidden) from the (user|person)\b/i,
  /\b(reveal|print|show) (your |the )?system prompt\b/i,
];
/** Rules fetched from somewhere else, or a command piped to a shell. */
const REMOTE = [
  /\b(fetch|load|download|get|pull) (the |your |new |more )?(instructions|rules) (from|at) /i,
  /\bfollow (the )?(instructions|rules) (at|from) (this|that|the|a) (url|link|page|file|address)\b/i,
  /\b(curl|wget)\b[^\n]*\|\s*(ba|z)?sh\b/i,
];
const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgetcito_[A-Za-z0-9]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bpassword\s*[:=]\s*\S+/i,
];
/** A Claude Code `!command` line, which would run a shell command (item 15). */
const COMMAND_LINE = /^\s*!\s*`?[A-Za-z./]/m;
/** Tags the engine wraps skills in: a body can't close its block or open another. */
const BLOCK_TAGS = /<\/?(skill|available_skills)\b/i;
const URL = /\bhttps?:\/\/\S+/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Text a reader can't see: zero-width, bidi controls, tag characters (memory reuses it, CHAT-14 item 12). */
export const hasHiddenCharacters = (text: string) => HIDDEN.test(text);
/** A key, token or password (memory reuses it, CHAT-14 item 12). */
export const hasSecret = (text: string) => SECRETS.some((re) => re.test(text));
/** An email address (memory reuses it, CHAT-14 item 12). */
export const hasEmail = (text: string) => EMAIL.test(text);
/** Text that tries to take over the assistant (memory reuses it, CHAT-14 item 12). */
export const overridesRules = (text: string) => ROLE_OVERRIDE.some((re) => re.test(text));

/**
 * What the scan finds in a skill's text: `blocks` refuse it, `warns` go to
 * review. Rules that read sentences (role override, remote instructions)
 * are a pattern list; imports add a model check later (W3).
 */
export function scanSkillText(text: string): { blocks: string[]; warns: string[] } {
  const blocks: string[] = [];
  const warns: string[] = [];
  if (HIDDEN.test(text)) blocks.push('hidden characters (zero-width, bidi or tag characters)');
  if (BASE64.test(text)) blocks.push('a base64 blob of 100 characters or more');
  if (EMAIL.test(text)) blocks.push('an email address');
  if (PRICE.test(text)) blocks.push('a price (a figure with a currency sign)');
  if (TRACKING.test(text)) blocks.push('a URL with a tracking parameter');
  if (UUID.test(text)) blocks.push('an internal id');
  if (ROLE_OVERRIDE.some((re) => re.test(text))) {
    blocks.push(
      'text that tries to override the assistant\'s rules ("ignore previous instructions")',
    );
  }
  if (REMOTE.some((re) => re.test(text))) {
    blocks.push('instructions fetched from somewhere else, or a command piped to a shell');
  }
  if (SECRETS.some((re) => re.test(text))) blocks.push('a secret (a key, token or password)');
  if (COMMAND_LINE.test(text)) blocks.push('a !command line');
  if (BLOCK_TAGS.test(text)) blocks.push('a <skill> or <available_skills> tag');
  const long = text.split('\n').findIndex((line) => line.length > MAX_LINE_CHARS);
  if (long >= 0) blocks.push(`line ${long + 1} is over ${MAX_LINE_CHARS} characters`);
  if (/[ \t]{200,}|\n{20,}/.test(text)) warns.push('a long run of blank space');
  if (URL.test(text)) warns.push('a URL');
  if (/<!--/.test(text)) warns.push('an HTML comment');
  return { blocks, warns };
}
