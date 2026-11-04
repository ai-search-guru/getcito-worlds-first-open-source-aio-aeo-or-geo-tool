import { describe, expect, it } from 'vitest';
import { chatShortcutOf, shortcutLabel } from './ChatShortcuts';

/**
 * The shell's keys (CHAT-23 P11): Ctrl+\ / ⌘\ and Ctrl+Shift+O / ⌘⇧O; Ctrl J / ⌘J for the side
 * panel (CHAT-01 item 14); Ctrl+B stays Bold.
 */

const key = (key: string, mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>>) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('chatShortcutOf', () => {
  it('reads the menu toggle and New chat on both keyboards', () => {
    expect(chatShortcutOf(key('\\', { ctrl: true }))).toBe('menu');
    expect(chatShortcutOf(key('\\', { meta: true }))).toBe('menu');
    expect(chatShortcutOf(key('O', { ctrl: true, shift: true }))).toBe('new');
    expect(chatShortcutOf(key('o', { meta: true, shift: true }))).toBe('new');
    expect(chatShortcutOf(key('k', { ctrl: true }))).toBe('search');
    expect(chatShortcutOf(key('K', { meta: true }))).toBe('search');
  });

  it('reads the side panel key on both keyboards', () => {
    expect(chatShortcutOf(key('j', { ctrl: true }))).toBe('panel');
    expect(chatShortcutOf(key('J', { meta: true }))).toBe('panel');
    expect(chatShortcutOf({ ...key('ö', { ctrl: true }), code: 'KeyJ' })).toBe('panel');
    expect(chatShortcutOf(key('j', { ctrl: true, shift: true }))).toBeNull();
    expect(chatShortcutOf(key('j', { ctrl: true, meta: true }))).toBeNull();
    expect(chatShortcutOf(key('j', { meta: true, alt: true }))).toBeNull();
  });

  it('leaves Bold, plain keys and other chords alone', () => {
    expect(chatShortcutOf(key('b', { ctrl: true }))).toBeNull();
    expect(chatShortcutOf(key('\\', {}))).toBeNull();
    expect(chatShortcutOf(key('o', { ctrl: true }))).toBeNull();
    expect(chatShortcutOf(key('\\', { ctrl: true, alt: true }))).toBeNull();
    expect(chatShortcutOf(key('k', {}))).toBeNull();
    expect(chatShortcutOf(key('k', { ctrl: true, shift: true }))).toBeNull();
  });
});

describe('shortcutLabel', () => {
  it('names the keys as each keyboard does', () => {
    expect(shortcutLabel('menu', false)).toBe('Ctrl+\\');
    expect(shortcutLabel('menu', true)).toBe('⌘\\');
    expect(shortcutLabel('new', true)).toBe('⌘⇧O');
    expect(shortcutLabel('search', false)).toBe('Ctrl K');
    expect(shortcutLabel('search', true)).toBe('⌘K');
    expect(shortcutLabel('panel', false)).toBe('Ctrl J');
    expect(shortcutLabel('panel', true)).toBe('⌘J');
  });
});
