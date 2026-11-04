import { z } from 'zod';

/**
 * The workspace's authors (Content Editor Quality spec §9, CE-037,
 * content_authors 00256): what Settings › Authors reads and saves.
 */

export interface ContentAuthor {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  /** Profile links (LinkedIn, X, GitHub…): Person schema's sameAs. */
  sameAs: string[];
  /** The member the author is, when they are one. */
  userId: string | null;
  /** The member who added it: they may edit it, as the author and admins may. */
  createdBy: string | null;
  /** The brands whose pages it is by when nobody picks another. */
  defaultFor: string[];
  /** The Library pages it is the author of (content_drafts.author_id, CE-038), when counted. */
  pages: number | null;
}

export interface AuthorsRead {
  authors: ContentAuthor[];
  /** The brands, and whether exports put the byline in the content (00261, CE-057). */
  brands: { id: string; name: string; bylineInContent?: boolean }[];
  /** The member reading: what they may change. */
  me: { id: string; role: string };
}

/** "Ada Lovelace" → "AL": an author's face without a photo. */
export function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Whether the member reading may edit an author: whoever added it, the
 * author themself or an admin, as the table's update policy says.
 */
export function canEditAuthor(author: ContentAuthor, me: AuthorsRead['me']): boolean {
  return author.userId === me.id || author.createdBy === me.id || me.role === 'admin';
}

/** The most profile links an author keeps (00256). */
export const MAX_PROFILES = 10;
/** The longest profile link; the table checks it too, with https (content_author_links_ok). */
export const MAX_LINK_LENGTH = 300;

const profileLink = z
  .string()
  .trim()
  .max(MAX_LINK_LENGTH)
  .refine((value) => /^https:\/\/[^\s]+$/.test(value), 'https');

export const authorInput = z.object({
  id: z.guid().optional(),
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120).optional().default(''),
  bio: z.string().trim().max(400).optional().default(''),
  photoUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value), 'https')
    .optional()
    .default(''),
  sameAs: z.array(profileLink).max(MAX_PROFILES).optional().default([]),
  /** The author is the member saving it. */
  isMe: z.boolean().optional().default(false),
});
export type AuthorInput = z.input<typeof authorInput>;
