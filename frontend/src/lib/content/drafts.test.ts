import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  DRAFT_STATUSES,
  PAGE_TYPES,
  WRITING_STALE_MS,
  agentRunOf,
  agentStateOf,
  contentEditorPath,
  draftConversationOf,
  draftOriginOf,
  draftsCreatedIn,
  draftsLastSent,
  draftsMadeIn,
  draftsInTab,
  isPageType,
  libraryTabCounts,
  type ContentDraftListItem,
  type DraftStatus,
} from './drafts';

const draft = (id: string, status: DraftStatus): ContentDraftListItem => ({
  id,
  title: id,
  pageType: 'feature_page',
  method: 'create',
  status,
  author: 'user',
  createdBy: null,
  isMine: true,
  agentState: null,
  createdAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  archivedAt: null,
  origin: 'editor',
  conversation: null,
});

const drafts = [
  draft('a', 'draft'),
  draft('b', 'in_review'),
  draft('c', 'in_review'),
  draft('d', 'published'),
];

describe('the Library’s Created filter', () => {
  const at = (id: string, createdAt: string) => ({ ...draft(id, 'draft'), createdAt });
  const now = Date.parse('2026-10-22T12:00:00Z');
  const list = [
    at('today', '2026-10-22T08:00:00Z'),
    at('week', '2026-10-16T12:00:00Z'),
    at('month', '2026-09-25T12:00:00Z'),
    at('old', '2026-06-01T12:00:00Z'),
  ];
  const ids = (range: Parameters<typeof draftsCreatedIn>[1]) =>
    draftsCreatedIn(list, range, now).map((d) => d.id);

  it('keeps the drafts created in the range, counted back from now', () => {
    expect(ids('all')).toEqual(['today', 'week', 'month', 'old']);
    expect(ids('7d')).toEqual(['today', 'week']);
    expect(ids('30d')).toEqual(['today', 'week', 'month']);
    expect(ids('90d')).toEqual(['today', 'week', 'month']);
  });
});

describe('the Library’s Last send filter (#1331)', () => {
  const list = ['going', 'sent', 'failed', 'live', 'never'].map((id) => draft(id, 'draft'));
  const sends = new Map([
    ['going', { status: 'queued' }],
    ['sent', { status: 'sent' }],
    ['failed', { status: 'failed' }],
    ['live', { status: 'published' }],
  ]);
  const ids = (filter: Parameters<typeof draftsLastSent>[2]) =>
    draftsLastSent(list, sends, filter).map((d) => d.id);

  it('keeps the drafts whose last send is as picked, or never sent', () => {
    expect(ids('all')).toEqual(['going', 'sent', 'failed', 'live', 'never']);
    expect(ids('never')).toEqual(['never']);
    expect(ids('queued')).toEqual(['going']);
    expect(ids('sent')).toEqual(['sent']);
    expect(ids('failed')).toEqual(['failed']);
    expect(ids('published')).toEqual(['live']);
  });

  it('lists a page taken down under Sent: a draft in its CMS again (PR 10)', () => {
    const down = new Map([...sends, ['live', { status: 'taken_down' }]]);
    expect(draftsLastSent(list, down, 'sent').map((d) => d.id)).toEqual(['sent', 'live']);
    expect(draftsLastSent(list, down, 'published')).toEqual([]);
  });
});

describe('the Library tabs', () => {
  it('counts every draft under All and each under its status', () => {
    expect(libraryTabCounts(drafts)).toEqual({
      all: 4,
      draft: 1,
      in_review: 2,
      ready: 0,
      published: 1,
      archived: 0,
    });
  });

  it('lists a tab’s drafts in their order, and every draft under All', () => {
    expect(draftsInTab(drafts, 'in_review').map((d) => d.id)).toEqual(['b', 'c']);
    expect(draftsInTab(drafts, 'ready')).toEqual([]);
    expect(draftsInTab(drafts, 'all')).toEqual(drafts);
  });

  it('keeps archived drafts under Archived only, with their status kept for Restore', () => {
    const shelved = { ...draft('e', 'published'), archivedAt: '2026-10-21T08:00:00Z' };
    const all = [...drafts, shelved];
    expect(libraryTabCounts(all)).toMatchObject({ all: 4, published: 1, archived: 1 });
    expect(draftsInTab(all, 'all').map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(draftsInTab(all, 'published').map((d) => d.id)).toEqual(['d']);
    expect(draftsInTab(all, 'archived')).toEqual([shelved]);
  });
});

describe('page types and labels', () => {
  it('names every page type, status and method', () => {
    const editor = messages.contentEditor;
    for (const type of PAGE_TYPES) expect(editor.pageTypes[type]).toBeTruthy();
    for (const status of DRAFT_STATUSES) {
      expect(editor.status[status]).toBeTruthy();
      expect(editor.library.tabs[status]).toBeTruthy();
    }
    expect(editor.method.create).toBeTruthy();
    expect(editor.method.optimize).toBeTruthy();
  });

  it('knows a stored key from anything else', () => {
    expect(isPageType('product_page')).toBe(true);
    expect(isPageType('landing')).toBe(false);
    expect(isPageType(null)).toBe(false);
  });

  it('opens a draft in the editor', () => {
    expect(contentEditorPath('d1')).toBe('/dashboard/content/editor/d1');
  });
});

describe('agentStateOf', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  it('reads the agent writing, failed, or done — a writing left long ago as failed', () => {
    expect(agentStateOf(null, null, now)).toBeNull();
    expect(agentStateOf('failed', '2026-10-21T11:59:00Z', now)).toBe('failed');
    expect(agentStateOf('writing', '2026-10-21T11:58:00Z', now)).toBe('writing');
    expect(agentStateOf('writing', new Date(now - WRITING_STALE_MS - 1).toISOString(), now)).toBe(
      'failed',
    );
    expect(agentStateOf('writing', null, now)).toBe('failed');
  });
});

describe('agentRunOf', () => {
  it('reads the run that holds the draft, and nothing else', () => {
    expect(agentRunOf('write')).toBe('write');
    expect(agentRunOf('rewrite')).toBe('rewrite');
    expect(agentRunOf(null)).toBeNull();
    expect(agentRunOf('brief')).toBeNull();
  });
});

describe('where a draft was made (00463, W4-10)', () => {
  it('reads a row’s origin, and the editor’s for anything else', () => {
    for (const origin of ['editor', 'chat', 'action_center', 'agent', 'mcp'] as const) {
      expect(draftOriginOf(origin)).toBe(origin);
    }
    expect(draftOriginOf(null)).toBe('editor');
    expect(draftOriginOf('somewhere')).toBe('editor');
  });

  it('reads the chat it was made in, or none when the member can’t read it', () => {
    expect(draftConversationOf({ id: 'c1', title: 'Pricing FAQ' })).toEqual({
      id: 'c1',
      title: 'Pricing FAQ',
    });
    expect(draftConversationOf([{ id: 'c1', title: null }])).toEqual({ id: 'c1', title: '' });
    expect(draftConversationOf(null)).toBeNull();
    expect(draftConversationOf([])).toBeNull();
  });

  it('lists the drafts made where the Made in filter says', () => {
    const made = [
      { ...draft('a', 'draft'), origin: 'chat' as const },
      { ...draft('b', 'draft'), origin: 'editor' as const },
      { ...draft('c', 'ready'), origin: 'action_center' as const },
    ];
    expect(draftsMadeIn(made, 'all').map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(draftsMadeIn(made, 'chat').map((d) => d.id)).toEqual(['a']);
    expect(draftsMadeIn(made, 'mcp')).toEqual([]);
  });
});
