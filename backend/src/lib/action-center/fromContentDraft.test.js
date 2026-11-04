import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Team" in the Content Editor's Start (CE-015): a draft sent to the Action
 * Center as one action, with a new page's or an existing page's tasks, linked
 * back to the draft, and found again when sent twice.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '44444444-4444-4444-4444-444444444444';

let draftRow;
let openRow;
let inserted;
let updated;

function table(name) {
  const state = { name, op: 'select', filters: {} };
  const result = () => {
    if (name === 'content_drafts') {
      if (state.op === 'update') return { data: null, error: null };
      return { data: draftRow, error: null };
    }
    if (name === 'actions') {
      if (state.op === 'insert') return { data: { id: 'a1', action_no: 214 }, error: null };
      return { data: openRow, error: null };
    }
    if (name === 'prompts') {
      return {
        data: (state.filters.id ?? []).map((id) => ({ id, text: `prompt ${id}` })),
        error: null,
      };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, val) => ((state.filters[col] = val), chain),
    in: (col, val) => ((state.filters[col] = val), chain),
    insert: (row) => {
      state.op = 'insert';
      inserted.push({ table: name, row });
      return chain;
    },
    update: (row) => {
      state.op = 'update';
      updated.push({ table: name, row, filters: state.filters });
      return chain;
    },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('./priorityData.js', () => ({ priorityOnCreate: async () => ({ priority_score: 50 }) }));
vi.mock('./sources.js', () => ({ resolveBrandSources: async () => ({}) }));

const { contentDraftTasks, sendContentDraftToActionCenter } = await import('./fromContentDraft.js');

beforeEach(() => {
  draftRow = {
    id: DRAFT,
    brand_id: BRAND,
    title: 'CRM for real estate teams',
    method: 'create',
    page_type: 'solution_page',
    prompt_ids: ['p1', 'p2', 'p1'],
    source_url: null,
    opportunity_id: null,
  };
  openRow = null;
  inserted = [];
  updated = [];
});

const insertedInto = (name) => inserted.filter((i) => i.table === name).map((i) => i.row);

describe('contentDraftTasks', () => {
  it('plans a new page’s work, or an existing page’s, from the library', () => {
    expect(contentDraftTasks('create')).toEqual([
      'create_content_brief',
      'create_content_draft',
      'add_internal_links',
      'publish_content',
      'validate_ai_visibility',
    ]);
    expect(contentDraftTasks('optimize')).toEqual([
      'optimize_content',
      'add_internal_links',
      'publish_content',
      'validate_ai_visibility',
    ]);
  });
});

describe('sendContentDraftToActionCenter', () => {
  it('opens one action for the draft, with its prompts and tasks, and links the draft to it', async () => {
    await expect(
      sendContentDraftToActionCenter(BRAND, { draftId: DRAFT, userId: 'u1' }),
    ).resolves.toEqual({ actionId: 'a1', actionNo: 214, created: true });
    const [action] = insertedInto('actions');
    expect(action).toMatchObject({
      brand_id: BRAND,
      kind: 'content_draft',
      category: 'growth',
      impact: 'medium',
      dedup_key: `content_draft:${DRAFT}`,
      kpi_keys: ['ai_visibility', 'citations', 'mentions'],
      priority_score: 50,
      payload: {
        source: 'content_draft',
        draftId: DRAFT,
        title: 'CRM for real estate teams',
        method: 'create',
        pageType: 'solution_page',
        pages: [],
        promptIds: ['p1', 'p2'],
        targetEntity: 'prompts',
        targetCount: 2,
        targets: [
          { id: 'p1', label: 'prompt p1' },
          { id: 'p2', label: 'prompt p2' },
        ],
        contentExists: false,
      },
    });
    const tasks = insertedInto('action_tasks')[0];
    expect(tasks.map((t) => t.task_key)).toEqual(contentDraftTasks('create'));
    expect(tasks.every((t) => t.status === 'todo')).toBe(true);
    expect(insertedInto('action_events')[0]).toMatchObject({
      action_id: 'a1',
      event: 'created',
      actor_id: 'u1',
      data: { source: 'content_draft', draftId: DRAFT, method: 'create' },
    });
    expect(updated).toEqual([
      { table: 'content_drafts', row: { action_id: 'a1' }, filters: { id: DRAFT } },
    ]);
  });

  it('measures an optimize draft on the page it optimizes', async () => {
    draftRow = { ...draftRow, method: 'optimize', source_url: 'https://acme.example/pricing' };
    await sendContentDraftToActionCenter(BRAND, { draftId: DRAFT, userId: 'u1' });
    expect(insertedInto('actions')[0].payload).toMatchObject({
      pages: ['https://acme.example/pricing'],
      contentExists: true,
    });
    expect(insertedInto('action_tasks')[0][0].task_key).toBe('optimize_content');
  });

  it('returns the action still open when the draft is sent again', async () => {
    openRow = { id: 'a0', action_no: 200 };
    await expect(
      sendContentDraftToActionCenter(BRAND, { draftId: DRAFT, userId: 'u1' }),
    ).resolves.toEqual({ actionId: 'a0', actionNo: 200, created: false });
    expect(inserted).toEqual([]);
  });

  it('says so for a draft that isn’t the brand’s', async () => {
    draftRow = null;
    await expect(
      sendContentDraftToActionCenter(BRAND, { draftId: DRAFT, userId: 'u1' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(inserted).toEqual([]);
  });
});
