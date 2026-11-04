import { describe, expect, it } from 'vitest';
import { canEditAuthor, type ContentAuthor } from './authors';

/** Who may edit an author: the same rule as content_authors' update policy. */

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: null,
  photoUrl: null,
  sameAs: [],
  userId: 'u-ada',
  createdBy: 'u-bob',
  defaultFor: [],
  pages: null,
};

describe('canEditAuthor', () => {
  it('lets whoever added the author, the author themself and admins edit it', () => {
    expect(canEditAuthor(ada, { id: 'u-bob', role: 'analyst' })).toBe(true);
    expect(canEditAuthor(ada, { id: 'u-ada', role: 'analyst' })).toBe(true);
    expect(canEditAuthor(ada, { id: 'u-cal', role: 'admin' })).toBe(true);
  });

  it('keeps other members out, managers included', () => {
    expect(canEditAuthor(ada, { id: 'u-cal', role: 'manager' })).toBe(false);
    expect(
      canEditAuthor({ ...ada, userId: null, createdBy: null }, { id: 'u-cal', role: 'analyst' }),
    ).toBe(false);
  });
});
