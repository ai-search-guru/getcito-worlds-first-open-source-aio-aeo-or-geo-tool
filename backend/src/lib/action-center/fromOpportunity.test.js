import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const {
  actionPromptScope,
  actionTargets,
  assetTasks,
  combinedTasks,
  initialTaskStatus,
  opportunityAssets,
} = await import('./fromOpportunity.js');
const { getTask } = await import('./tasks/registry.js');

const owned = (decision) => ({ type: 'blog_post', channel: 'owned', decision });

describe('assetTasks', () => {
  it('writes a new page from a brief when there is none', () => {
    expect(assetTasks(owned('create'))).toEqual([
      'create_content_brief',
      'create_content_draft',
      'add_internal_links',
      'publish_content',
      'validate_ai_visibility',
    ]);
  });

  it('works on the existing page otherwise', () => {
    expect(assetTasks(owned('expand'))[0]).toBe('optimize_content');
    expect(assetTasks(owned('refresh'))[0]).toBe('refresh_content');
  });

  it('takes earned work through outreach', () => {
    expect(assetTasks({ type: 'backlink', channel: 'earned', decision: 'create' })).toEqual([
      'identify_target_sources',
      'prepare_outreach',
      'execute_outreach',
      'track_third_party_status',
      'validate_third_party_citation',
    ]);
  });

  it('uses only tasks the library has', () => {
    const all = combinedTasks([
      owned('create'),
      owned('refresh'),
      owned('optimize'),
      { type: 'third_party_article', channel: 'earned', decision: 'create' },
      { type: 'backlink', channel: 'earned', decision: 'create' },
    ]);
    for (const id of all) expect(getTask(id), id).toBeTruthy();
  });
});

describe('combinedTasks', () => {
  it('lists each task once, work before checks, measurement last', () => {
    const tasks = combinedTasks([
      owned('optimize'),
      { type: 'third_party_article', channel: 'earned', decision: 'create' },
    ]);
    expect(tasks).toEqual([
      'optimize_content',
      'add_internal_links',
      'publish_content',
      'identify_target_sources',
      'prepare_contribution',
      'execute_outreach',
      'track_third_party_status',
      'validate_ai_visibility',
      'validate_third_party_presence',
      'measure_action_outcome',
    ]);
  });
});

describe('initialTaskStatus', () => {
  it('starts the brief task completed when the opportunity has a brief', () => {
    expect(initialTaskStatus('create_content_brief', { brief: { outline: [] } })).toBe('completed');
    expect(initialTaskStatus('create_content_brief', { brief: null })).toBe('todo');
    expect(initialTaskStatus('create_content_draft', { brief: { outline: [] } })).toBe('todo');
  });
});

describe('opportunityAssets', () => {
  it('gives an opportunity from before assets one, from its own fields', () => {
    expect(
      opportunityAssets({
        title: 'T',
        type: 'owned',
        decision: 'optimize',
        source_data: { targetPages: [{ url: 'u' }] },
      }),
    ).toEqual([
      {
        key: 'a1',
        type: null,
        channel: 'owned',
        decision: 'optimize',
        title: 'T',
        pages: [{ url: 'u' }],
      },
    ]);
    expect(opportunityAssets({ title: 'T', type: 'earned', source_data: {} })[0]).toMatchObject({
      channel: 'earned',
      decision: 'create',
    });
  });
});

describe('actionPromptScope', () => {
  it("measures a cluster opportunity on its clusters' prompts", () => {
    expect(
      actionPromptScope({ prompt_id: 'p1', source_data: { prompts: ['A', 'B'] } }, ['p1', 'p2']),
    ).toEqual({ promptIds: ['p1', 'p2'], prompts: ['A', 'B'] });
  });

  it('measures a single-prompt opportunity on its own prompt', () => {
    expect(
      actionPromptScope({ prompt_id: 'p9', source_data: { promptText: 'Best espresso?' } }, []),
    ).toEqual({ promptIds: ['p9'], prompts: ['Best espresso?'] });
  });

  it('names only the prompt it measures when the clusters are gone', () => {
    expect(
      actionPromptScope(
        { prompt_id: 'p1', source_data: { promptText: 'A', prompts: ['A', 'B', 'C'] } },
        [],
      ),
    ).toEqual({ promptIds: ['p1'], prompts: ['A'] });
  });

  it('has nothing to measure when neither is known', () => {
    expect(actionPromptScope({ prompt_id: null, source_data: {} }, [])).toEqual({
      promptIds: [],
      prompts: [],
    });
  });
});

describe('an opportunity a task was sent as (AC-004)', () => {
  it('opens the action it came from instead of starting a second one', async () => {
    const { sendToActionCenter } = await import('./fromOpportunity.js');
    expect(
      await sendToActionCenter(
        {
          id: 'o1',
          brand_id: 'b1',
          source: 'action',
          source_data: { fromAction: { actionId: 'a1' } },
        },
        { userId: 'u1' },
      ),
    ).toEqual({ actionId: 'a1', created: false });
  });
});

describe('actionTargets (AC-009)', () => {
  it('counts and keeps the prompts the action is scoped to', () => {
    expect(actionTargets(['p1', 'p2', 'p3'], ['A', 'B'])).toEqual({
      targetCount: 3,
      targets: ['A', 'B'],
      targetIds: ['p1', 'p2', 'p3'],
    });
  });

  it('keeps the ones the opportunity names when it has no prompts', () => {
    expect(actionTargets([], ['A', { id: 'p9', text: 'B' }])).toEqual({
      targetCount: 2,
      targets: ['A', { id: 'p9', text: 'B' }],
      targetIds: ['A', 'p9'],
    });
    expect(actionTargets([], [])).toEqual({ targetCount: 0, targets: [] });
  });

  it('counts a prompt named twice once, as the action keeps it', () => {
    expect(actionTargets([], ['A', 'B', 'A ', ''])).toEqual({
      targetCount: 2,
      targets: ['A', 'B', 'A ', ''],
      targetIds: ['A', 'B'],
    });
  });
});
