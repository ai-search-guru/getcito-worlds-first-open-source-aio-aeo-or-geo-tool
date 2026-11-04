import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Actions from Product Visibility (ECOM-013): a product or a category sent to
 * the Action Center with the work types picked, each for a person or the
 * agent, and found again when sent twice.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '11111111-0000-0000-0000-000000000001';
const CATEGORY = '22222222-0000-0000-0000-000000000002';

let subject;
let openRow;
let inserted;
let reads;

function table(name) {
  const state = { name, op: 'select', filters: {} };
  const result = () => {
    if (name === 'catalog_products' || name === 'catalog_categories') {
      reads.push({ table: name, filters: state.filters });
      return { data: subject, error: null };
    }
    if (name === 'actions') {
      if (state.op === 'insert') return { data: { id: 'a1', action_no: 301 }, error: null };
      return { data: openRow, error: null };
    }
    if (name === 'prompts') {
      return {
        data: (state.filters.id ?? [])
          .filter((id) => id !== 'not-ours')
          .map((id) => ({ id, text: `prompt ${id}` })),
        error: null,
      };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, val) => ((state.filters[col] = val), chain),
    is: () => chain,
    in: (col, val) => ((state.filters[col] = val), chain),
    insert: (row) => {
      state.op = 'insert';
      inserted.push({ table: name, row });
      return chain;
    },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('./priorityData.js', () => ({ priorityOnCreate: async () => ({ priority_score: 55 }) }));
vi.mock('./sources.js', () => ({ resolveBrandSources: async () => new Set() }));
// The planner, as it is, unless a test has it plan nothing.
let planNothing = false;
vi.mock('./tasks/plan.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, planTasks: (...args) => (planNothing ? [] : actual.planTasks(...args)) };
});

const { modeFor, productActionDedupKey, productTasks, sendProductActions } =
  await import('./fromProducts.js');

beforeEach(() => {
  subject = {
    id: PRODUCT,
    title: 'Ridge 30L Backpack',
    url: 'https://northwind.example/products/ridge-30',
  };
  openRow = null;
  inserted = [];
  reads = [];
  planNothing = false;
});

const insertedInto = (name) => inserted.filter((i) => i.table === name).map((i) => i.row);

describe('modeFor', () => {
  it("gives the agent a task it can do, and a person every task that's theirs", () => {
    expect(modeFor('optimize_content', 'agent')).toBe('agent');
    expect(modeFor('optimize_content', 'me')).toBe('human');
    expect(modeFor('fix_structured_data', 'agent')).toBe('human');
    expect(modeFor('execute_outreach', 'agent')).toBe('human');
    expect(modeFor('create_content_brief', 'agent')).toBe('agent');
  });
});

describe('productTasks', () => {
  it("plans each work type's tasks in order, with the person's line as the why", () => {
    const plan = productTasks(
      [
        { type: 'optimize_page', who: 'agent', why: "Rewrite the page for women's fit and weight" },
        { type: 'get_listed', who: 'me' },
        { type: 'technical', who: 'agent' },
      ],
      { sources: new Set(), payload: { pages: ['https://northwind.example/products/ridge-30'] } },
    );
    expect(plan.map((t) => [t.taskKey, t.mode, t.details.workType])).toEqual([
      ['optimize_content', 'agent', 'optimize_page'],
      ['prepare_outreach', 'human', 'get_listed'],
      ['execute_outreach', 'human', 'get_listed'],
      ['fix_structured_data', 'human', 'technical'],
    ]);
    expect(plan[0].details).toMatchObject({
      why: "Rewrite the page for women's fit and weight",
      check: 'auto',
      url: 'https://northwind.example/products/ridge-30',
    });
    expect(plan[1].details.why).toBeUndefined();
  });
});

describe('sendProductActions', () => {
  it("opens a product's action with its tasks and its own questions, measured on its page", async () => {
    const result = await sendProductActions(BRAND, {
      target: { type: 'product', id: PRODUCT },
      work: [
        { type: 'optimize_page', who: 'agent', why: 'Women’s fit and weight in the title' },
        { type: 'create_content', who: 'me', why: 'Ridge 30L vs Summit Daypack 30 W' },
      ],
      promptIds: ['q1', 'q2', 'q1', 'not-ours'],
      userId: 'u1',
    });
    expect(result).toEqual({ actionId: 'a1', actionNo: 301, created: true });
    const [action] = insertedInto('actions');
    expect(action).toMatchObject({
      brand_id: BRAND,
      kind: 'shopping_product',
      category: 'growth',
      dedup_key: `shopping_product:${PRODUCT}`,
      kpi_keys: ['ai_visibility', 'mentions'],
      payload: {
        source: 'shopping',
        target: { type: 'product', id: PRODUCT, name: 'Ridge 30L Backpack' },
        title: 'Ridge 30L Backpack',
        workTypes: ['optimize_page', 'create_content'],
        pages: ['https://northwind.example/products/ridge-30'],
        promptIds: ['q1', 'q2'],
        targetCount: 2,
      },
    });
    expect(
      insertedInto('action_tasks')
        .flat()
        .map((t) => [t.task_key, t.mode]),
    ).toEqual([
      ['optimize_content', 'agent'],
      ['create_content_brief', 'human'],
      ['create_content_draft', 'human'],
    ]);
    expect(insertedInto('action_events')[0]).toMatchObject({ event: 'created', actor_id: 'u1' });
    expect(reads[0].filters).toMatchObject({ id: PRODUCT, brand_id: BRAND });
  });

  it("opens a category's as Compete, without a page, named by its last level", async () => {
    subject = { id: CATEGORY, name: 'Bags > Hiking backpacks' };
    await sendProductActions(BRAND, {
      target: { type: 'category', id: CATEGORY },
      work: [{ type: 'create_content', who: 'agent' }],
      promptIds: [],
      userId: 'u1',
    });
    expect(insertedInto('actions')[0]).toMatchObject({
      kind: 'shopping_category',
      category: 'compete',
      dedup_key: `shopping_category:${CATEGORY}`,
      payload: { title: 'Hiking backpacks', pages: [], promptIds: [] },
    });
    expect(reads[0].table).toBe('catalog_categories');
  });

  it('returns the open action for the same product, and refuses one not in the catalog', async () => {
    openRow = { id: 'a0', action_no: 299 };
    expect(
      await sendProductActions(BRAND, {
        target: { type: 'product', id: PRODUCT },
        work: [{ type: 'technical', who: 'me' }],
        promptIds: [],
        userId: 'u1',
      }),
    ).toEqual({ actionId: 'a0', actionNo: 299, created: false });
    expect(insertedInto('actions')).toEqual([]);

    subject = null;
    await expect(
      sendProductActions(BRAND, {
        target: { type: 'product', id: PRODUCT },
        work: [{ type: 'technical', who: 'me' }],
        promptIds: [],
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(productActionDedupKey({ type: 'category', id: 'c' })).toBe('shopping_category:c');
  });

  it('opens no action for work with no task to plan, and says so', async () => {
    planNothing = true;
    await expect(
      sendProductActions(BRAND, {
        target: { type: 'product', id: PRODUCT },
        work: [{ type: 'technical', who: 'me' }],
        promptIds: [],
        userId: 'u1',
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'None of the work picked has a task to plan for this brand.',
    });
    expect(inserted).toEqual([]);
  });
});
