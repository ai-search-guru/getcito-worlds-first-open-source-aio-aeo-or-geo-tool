import { createHash } from 'node:crypto';

/**
 * A workspace skill's SKILL.md as it is kept (CHAT-13 items 1, 19), and its
 * checksum: what saving (store.ts) and importing (import.ts) both check and
 * keep. Pure.
 */

/** The longest title (00458). */
export const MAX_TITLE = 120;

/** A skill's parts, as a row keeps them. */
export interface SkillParts {
  name: string;
  title: string;
  description: string;
  body: string;
  license?: string | null;
  compatibility?: string | null;
}

/**
 * A skill's SKILL.md as it is stored (CHAT-13 items 1, 19): the front
 * matter from its columns, values quoted, then its body. What it is
 * checked as when it is saved, and what its checksum is of.
 */
export function skillFileText(skill: SkillParts): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${JSON.stringify(skill.description)}`];
  if (skill.license) lines.push(`license: ${JSON.stringify(skill.license)}`);
  if (skill.compatibility) lines.push(`compatibility: ${JSON.stringify(skill.compatibility)}`);
  lines.push('metadata:', `  title: ${JSON.stringify(skill.title)}`, '---', skill.body);
  return lines.join('\n');
}

/** The SHA-256 of a skill's file as stored (chat_skills.checksum_sha256). */
export const skillChecksum = (skill: SkillParts) =>
  createHash('sha256').update(skillFileText(skill)).digest('hex');
