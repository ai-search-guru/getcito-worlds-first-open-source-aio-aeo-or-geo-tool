import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const { setSyncedPrices } = await import('./modelPriceCache.js');
const { REMOVED_AFTER_MS, SEARCH_LIMIT, chatModelMenu, menuModel, runsChat, shortName, toneOf } =
  await import('./modelMenu.js');

/** Chat's model menu (CHAT-16 §A–B, W4-01): multipliers and tones, never a price. */

afterEach(() => setSyncedPrices([]));

const NOW = new Date('2026-11-02T12:00:00Z');
const SYNCED = '2026-11-02T05:17:00.000Z';

const row = (model_id, input_per_m, output_per_m, over = {}) => ({
  model_id,
  name: `Provider: ${model_id.split('/')[1]}`,
  input_modalities: ['text'],
  output_modalities: ['text'],
  input_per_m,
  output_per_m,
  overrides: [],
  is_batch: false,
  supported_parameters: ['tools', 'reasoning'],
  synced_at: SYNCED,
  ...over,
});

const CATALOG = [
  row('anthropic/claude-haiku-5.5', 0.1, 0.5),
  row('anthropic/claude-sonnet-5.5', 2, 10),
  row('anthropic/claude-opus-5.5', 4, 20),
  row('deepseek/deepseek-v4.1-flash', 0.07, 0.14, {
    overrides: [{ utc_start: 1630, utc_end: 30, prompt: '0.00000003' }],
  }),
  row('anthropic/claude-sonnet-5.5:batch', 1, 5, { is_batch: true }),
  row('openai/gpt-image-2', 5, 40, { output_modalities: ['image'] }),
  row('mistralai/mistral-tiny', 0.1, 0.1, { supported_parameters: ['max_tokens'] }),
  row('anthropic/claude-sonnet-4.5', 3, 15, {
    synced_at: new Date(Date.parse(SYNCED) - REMOVED_AFTER_MS - 1).toISOString(),
  }),
];

const OFFERED = [
  'anthropic/claude-haiku-5.5',
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
];

describe('toneOf', () => {
  it('is green under 1x, amber from 3x, plain between', () => {
    expect(toneOf(0.04)).toBe('low');
    expect(toneOf(0.99)).toBe('low');
    expect(toneOf(1)).toBe('normal');
    expect(toneOf(2.33)).toBe('normal');
    expect(toneOf(3)).toBe('high');
    expect(toneOf(null)).toBeNull();
  });
});

describe('runsChat', () => {
  it('takes text models that call tools, never a batch variant or an unread one', () => {
    const [haiku, , , deepseek, batch, image, tiny] = CATALOG;
    expect(runsChat(haiku)).toBe(true);
    expect(runsChat(deepseek)).toBe(true);
    expect(runsChat(batch)).toBe(false);
    expect(runsChat(image)).toBe(false);
    expect(runsChat(tiny)).toBe(false);
    expect(runsChat({ ...haiku, supported_parameters: null })).toBe(false);
    expect(runsChat(null)).toBe(false);
  });
});

describe('shortName', () => {
  it('drops the provider before the colon, else keeps the id', () => {
    expect(shortName('Anthropic: Claude Sonnet 5.5', 'x')).toBe('Claude Sonnet 5.5');
    expect(shortName('Claude Sonnet 5.5', 'x')).toBe('Claude Sonnet 5.5');
    expect(shortName('', 'anthropic/claude-opus-5.5')).toBe('anthropic/claude-opus-5.5');
  });
});

describe('chatModelMenu', () => {
  it('lists the offered models with their multipliers and tones, Auto at 1x, and no dollars', () => {
    setSyncedPrices(CATALOG);
    const menu = chatModelMenu({ ids: OFFERED, now: NOW });
    expect(menu.auto).toEqual({ id: 'auto', multiplier: '1x', tone: 'normal' });
    expect(menu.models).toEqual([
      {
        id: 'anthropic/claude-haiku-5.5',
        name: 'claude-haiku-5.5',
        multiplier: '0.1x',
        tone: 'low',
        variesByHour: false,
        removed: false,
      },
      expect.objectContaining({ id: 'anthropic/claude-sonnet-5.5', multiplier: '2.3x' }),
      expect.objectContaining({
        id: 'anthropic/claude-opus-5.5',
        multiplier: '4.7x',
        tone: 'high',
      }),
    ]);
    expect(menu.updatedAt).toBe(SYNCED);
    // Chat models with tools: Haiku, Sonnet, Opus, DeepSeek and the dropped Sonnet 4.5.
    expect(menu.catalogCount).toBe(5);
    expect(JSON.stringify(menu)).not.toMatch(/per_m|input|output|\$|price/i);
  });

  it('leaves a dropped model off the list, but answers it as removed when a chat runs on it', () => {
    setSyncedPrices(CATALOG);
    const menu = chatModelMenu({
      ids: [...OFFERED, 'anthropic/claude-sonnet-4.5', 'anthropic/claude-gone-1'],
      selected: 'anthropic/claude-sonnet-4.5',
      now: NOW,
    });
    expect(menu.models.map((m) => m.id)).toEqual(OFFERED);
    expect(menu.selected).toMatchObject({ id: 'anthropic/claude-sonnet-4.5', removed: true });
    expect(chatModelMenu({ selected: 'auto' }).selected).toBeNull();
    expect(menuModel('anthropic/claude-gone-1', { now: NOW, updatedAt: SYNCED }).removed).toBe(
      true,
    );
  });

  it('counts nothing as dropped before any sync, with no multipliers yet', () => {
    setSyncedPrices([]);
    const menu = chatModelMenu({ ids: OFFERED, now: NOW });
    expect(menu.models.map((m) => [m.id, m.multiplier, m.tone, m.removed])).toEqual(
      OFFERED.map((id) => [id, null, null, false]),
    );
    expect(menu.updatedAt).toBeNull();
    expect(menu.catalogCount).toBe(0);
  });

  it('flags a model whose price moves by the hour', () => {
    setSyncedPrices(CATALOG);
    expect(menuModel('deepseek/deepseek-v4.1-flash', { now: NOW }).variesByHour).toBe(true);
  });

  it('searches the chat models with tools by id or name, at most SEARCH_LIMIT', () => {
    setSyncedPrices(CATALOG);
    expect(chatModelMenu({ q: 'SONNET', now: NOW }).results.map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-5.5',
    ]);
    expect(chatModelMenu({ q: 'tiny', now: NOW }).results).toEqual([]);
    expect(chatModelMenu({ now: NOW }).results).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => row(`acme/model-${i}`, 1, 1));
    setSyncedPrices([...CATALOG, ...many]);
    expect(chatModelMenu({ q: 'acme', now: NOW }).results).toHaveLength(SEARCH_LIMIT);
  });
});
