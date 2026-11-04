import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { SHORTCUTS, SHORTCUT_IDS, isShortcutId, keepsTrigger, shortcutCommand } from './shortcuts';

/**
 * Chat's shortcuts (CHAT-08, W2-09): the / menu's seven, in CHAT-08's
 * order, under the commands decided on 2026-11-02, each with its words; a
 * message is a shortcut's only while it keeps its trigger words.
 */

describe('the shortcuts', () => {
  it("are CHAT-08's, /new-report for Reports (/report is the Weekly report skill's)", () => {
    expect(SHORTCUTS.map(shortcutCommand)).toEqual([
      '/start',
      '/analyze',
      '/new-report',
      '/create',
      '/optimize',
      '/opportunities',
      '/audit',
    ]);
    expect(SHORTCUT_IDS).toEqual(SHORTCUTS.map((s) => s.id));
    // shortcut_id's check (00417): lowercase, digits and hyphens.
    for (const id of SHORTCUT_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
  });

  it("have a name and the mockup's trigger words", () => {
    const words = messages.chatComposer.slash.shortcuts;
    expect(Object.keys(words).sort()).toEqual(SHORTCUTS.map((s) => s.key).sort());
    expect(SHORTCUTS.map((s) => [words[s.key].name, words[s.key].starter])).toEqual([
      ['Get started', 'Help me get started. What should I set up first?'],
      ['Analyze', 'Analyze'],
      ['Reports', 'Create a report on'],
      ['Create content', 'Create content for'],
      ['Optimize content', 'Optimize this page:'],
      ['Find opportunities', 'Find content opportunities for'],
      ['Improve with audit', 'Run an audit on'],
    ]);
  });

  it('knows its ids, and nothing else', () => {
    expect(isShortcutId('analyze')).toBe(true);
    expect(isShortcutId('report')).toBe(false);
    expect(isShortcutId('tasks')).toBe(false);
    expect(isShortcutId(undefined)).toBe(false);
  });
});

describe('keepsTrigger', () => {
  it('holds while the text starts with the trigger words, alone or before a space or a line', () => {
    expect(keepsTrigger('Analyze ', 'Analyze')).toBe(true);
    expect(keepsTrigger('Analyze our citations', 'Analyze')).toBe(true);
    expect(keepsTrigger('Analyze\nthe drop', 'Analyze')).toBe(true);
    expect(keepsTrigger('  Optimize this page: acme.com/pricing ', 'Optimize this page:')).toBe(
      true,
    );
  });

  it('drops when the words were rewritten, run on, or are elsewhere in the text', () => {
    expect(keepsTrigger('Analyzed our citations', 'Analyze')).toBe(false);
    expect(keepsTrigger('Please analyze our citations', 'Analyze')).toBe(false);
    expect(keepsTrigger('Create a summary on Q3', 'Create a report on')).toBe(false);
    expect(keepsTrigger('', 'Analyze')).toBe(false);
    expect(keepsTrigger('Analyze', '')).toBe(false);
  });
});
