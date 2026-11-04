import { describe, expect, it } from 'vitest';
import {
  PANEL_REOPEN_MS,
  nextPanelSize,
  panelReturnOf,
  panelRouteOf,
  panelSizeOf,
  reopenChatId,
} from './panel';

/** The side panel's rules (CHAT-01 items 13–24). */

describe('panelRouteOf', () => {
  it('tells Chat, the Content Editor and every other page apart', () => {
    expect(panelRouteOf('/dashboard/chat')).toBe('chat');
    expect(panelRouteOf('/dashboard/chat/abc')).toBe('chat');
    expect(panelRouteOf('/dashboard/chatter')).toBe('page');
    expect(panelRouteOf('/dashboard/content/editor/abc')).toBe('editor');
    expect(panelRouteOf('/dashboard/content/library')).toBe('page');
    expect(panelRouteOf('/dashboard/prompts')).toBe('page');
  });
});

describe('panel sizes', () => {
  it('reads a saved size, compact when none or unknown', () => {
    expect(panelSizeOf('wide')).toBe('wide');
    expect(panelSizeOf('full')).toBe('full');
    expect(panelSizeOf('huge')).toBe('compact');
    expect(panelSizeOf(null)).toBe('compact');
  });

  it('goes to the size clicked; Full screen again goes back to the one before', () => {
    expect(nextPanelSize('compact', 'wide', 'compact')).toBe('wide');
    expect(nextPanelSize('wide', 'full', 'wide')).toBe('full');
    expect(nextPanelSize('full', 'full', 'wide')).toBe('wide');
    expect(nextPanelSize('full', 'compact', 'wide')).toBe('compact');
  });
});

describe('reopenChatId', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z');
  const stored = (at: number) => JSON.stringify({ id: 'chat-1', at });

  it('opens the last chat used in the last 30 minutes', () => {
    expect(reopenChatId(stored(now - 5 * 60 * 1000), now)).toBe('chat-1');
    expect(reopenChatId(stored(now - PANEL_REOPEN_MS), now)).toBe('chat-1');
  });

  it('starts empty after that, or with nothing readable kept', () => {
    expect(reopenChatId(stored(now - PANEL_REOPEN_MS - 1), now)).toBeNull();
    expect(reopenChatId(stored(now + 60_000), now)).toBeNull();
    expect(reopenChatId(null, now)).toBeNull();
    expect(reopenChatId('not json', now)).toBeNull();
    expect(reopenChatId(JSON.stringify({ id: 4, at: now }), now)).toBeNull();
  });
});

describe('panelReturnOf', () => {
  it('returns to the app page the chat was opened from, with its filters', () => {
    expect(panelReturnOf('/dashboard/mentions?platform=chatgpt-web')).toBe(
      '/dashboard/mentions?platform=chatgpt-web',
    );
    expect(panelReturnOf('/dashboard/action-center/actions')).toBe(
      '/dashboard/action-center/actions',
    );
    // A dot inside a name, or in the query, is fine.
    expect(panelReturnOf('/dashboard/citations?domain=example.com&q=..')).toBe(
      '/dashboard/citations?domain=example.com&q=..',
    );
  });

  it('returns nowhere else: another site, Chat, the editor, outside the dashboard', () => {
    for (const from of [
      null,
      '',
      'https://example.com/dashboard/mentions',
      '//example.com/dashboard/x',
      '/dashboard//example.com',
      '/dashboard/chat/abc',
      '/dashboard/content/editor/d1',
      '/sign-in',
      '/dashboard/mentions\\x',
      // Dot segments resolve elsewhere: out of the dashboard, or into Chat.
      '/dashboard/../sign-in',
      '/dashboard/./chat/abc',
      '/dashboard/%2e%2e/%2E%2e/settings',
      '/dashboard/x/%2e%2e/chat/abc',
      '/dashboard/x/.%2E?tab=1',
    ]) {
      expect(panelReturnOf(from)).toBeNull();
    }
  });
});
