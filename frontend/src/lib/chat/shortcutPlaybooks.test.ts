// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ToolDenial } from './precedence';
import type { ChatTool } from './registry/defineTool';
import { messageShortcut, playbookPlanNote, playbookTools } from './shortcutPlaybooks';

// The registry's rows, for their names and classes only: nothing here reads or writes.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/contentDrafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/promptSuggestions', () => ({ dismissSuggestion: vi.fn() }));
const { CHAT_TOOLS, chatTool } = await import('./registry/tools');

/**
 * A shortcut's run on the server (CHAT-08 items 4, 7, 8; W2-09): the id
 * counts only for its own message, the run gets only its data plan's reads,
 * and the plan's gaps are said in one line.
 */

describe('messageShortcut', () => {
  it("takes a shortcut's id with its trigger words, picked from the / menu", () => {
    expect(messageShortcut('analyze', 'Analyze our citations on Perplexity')).toBe('analyze');
    expect(messageShortcut('new-report', 'Create a report on share of voice')).toBe('new-report');
    expect(messageShortcut('start', 'Help me get started. What should I set up first?')).toBe(
      'start',
    );
  });

  it("takes it with a Home chip's own words, word for word", () => {
    const chips = messages.chatShell.home.byFocus.shortcuts;
    expect(messageShortcut('analyze', chips.whatChangedMessage)).toBe('analyze');
    expect(messageShortcut('opportunities', chips.citedForRivalsMessage)).toBe('opportunities');
    // The chip's words with another shortcut's id, or changed: no.
    expect(messageShortcut('audit', chips.whatChangedMessage)).toBeNull();
    expect(messageShortcut('analyze', `${chips.whatChangedMessage} And last month?`)).toBeNull();
  });

  it('drops it for rewritten words, another id, or none', () => {
    expect(messageShortcut('analyze', 'Why did our citations drop?')).toBeNull();
    expect(messageShortcut('analyze', 'Create a report on share of voice')).toBeNull();
    expect(messageShortcut('report', 'Create a report on share of voice')).toBeNull();
    expect(messageShortcut('tasks', 'Complete tasks')).toBeNull();
    expect(messageShortcut(undefined, 'Analyze our citations')).toBeNull();
    expect(messageShortcut(42, 'Analyze our citations')).toBeNull();
  });
});

describe('playbookTools', () => {
  it('keeps the reads the data plan names and every change, and drops the other reads', () => {
    const kept = playbookTools(CHAT_TOOLS, { reads: ['list_citations', 'get_fanouts'] });
    const reads = kept.filter((tool) => tool.class === 'read').map((tool) => tool.name);
    expect(reads.sort()).toEqual(['get_fanouts', 'list_citations']);
    const changes = CHAT_TOOLS.filter((tool) => tool.class !== 'read');
    expect(changes.length).toBeGreaterThan(0);
    expect(kept.filter((tool) => tool.class !== 'read')).toEqual(changes);
  });
});

describe('playbookPlanNote', () => {
  const locked = (name: string, needs: 'growth' | 'enterprise') => ({
    tool: chatTool(name) as ChatTool,
    denial: { code: 'plan_locked', needs } as ToolDenial,
  });

  it("names the plan's missing reads in its words, with the plan that has them", () => {
    const note = playbookPlanNote(
      { reads: ['get_prompt_volumes', 'get_shopping_visibility', 'list_citations'] },
      [locked('get_prompt_volumes', 'growth'), locked('get_shopping_visibility', 'enterprise')],
      'Starter',
    );
    expect(note).toBe(
      "This shortcut's data plan includes what the Starter plan doesn't: Read prompt volumes (on Growth and up); Read Product Visibility (on Enterprise and up). Say so in one line, naming the Starter plan, then answer with what it includes.",
    );
    // Never a tool's name.
    expect(note).not.toMatch(/get_|list_/);
  });

  it('says nothing when the plan has it all, or for a refusal that is no plan gate', () => {
    expect(playbookPlanNote({ reads: ['list_citations'] }, [], 'Growth')).toBeNull();
    // Locked, but not in this data plan.
    expect(
      playbookPlanNote(
        { reads: ['list_citations'] },
        [locked('get_prompt_volumes', 'growth')],
        'Starter',
      ),
    ).toBeNull();
    const byRole = {
      tool: chatTool('get_prompt_volumes') as ChatTool,
      denial: { code: 'forbidden_role', role: 'analyst', roles: ['admin'] } as ToolDenial,
    };
    expect(playbookPlanNote({ reads: ['get_prompt_volumes'] }, [byRole], 'Starter')).toBeNull();
  });
});
