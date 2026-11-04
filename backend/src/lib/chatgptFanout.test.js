import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('./logger.js', () => ({ default: log, logger: log }));

const { chatgptFanoutDue, chatgptFanoutMode, chatgptFanoutWeekday } =
  await import('./chatgptFanout.js');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Prompt ids shaped like the real ones, fixed so the test never changes. */
const ids = Array.from(
  { length: 700 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
);
/** Seven consecutive days, starting at an hour a nightly run might submit. */
const week = (start) => Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY_MS));

describe('chatgptFanoutMode', () => {
  const clear = () => {
    delete process.env.CLORO_CHATGPT_FANOUT;
    delete process.env.IS_CLOUD;
  };
  beforeEach(clear);
  afterEach(clear);

  it('reads off, sample and all, in any case', () => {
    expect(chatgptFanoutMode('off', true)).toBe('off');
    expect(chatgptFanoutMode(' ALL ', false)).toBe('all');
    expect(chatgptFanoutMode('Sample', false)).toBe('sample');
  });

  it('is sample on the cloud and off on self-host when unset or blank', () => {
    for (const value of [undefined, '', '  ']) {
      expect(chatgptFanoutMode(value, true)).toBe('sample');
      expect(chatgptFanoutMode(value, false)).toBe('off');
    }
  });

  it('reads the environment', () => {
    expect(chatgptFanoutMode()).toBe('off');
    process.env.IS_CLOUD = 'true';
    expect(chatgptFanoutMode()).toBe('sample');
    process.env.CLORO_CHATGPT_FANOUT = 'off';
    expect(chatgptFanoutMode()).toBe('off');
  });

  it('turns a value it does not know off, and says so once', () => {
    expect(chatgptFanoutMode('weekly', true)).toBe('off');
    expect(chatgptFanoutMode('of', true)).toBe('off');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'weekly' }),
      'CLORO_CHATGPT_FANOUT has a value it does not know; ChatGPT fan-out is off',
    );
  });
});

describe('chatgptFanoutDue', () => {
  it('asks once in any seven days on sample, for every prompt', () => {
    for (const start of [Date.UTC(2026, 9, 29, 2), Date.UTC(2027, 0, 3, 23, 59)]) {
      for (const id of ids) {
        const days = week(start).filter((date) => chatgptFanoutDue(id, date, 'sample'));
        expect(days).toHaveLength(1);
        expect(days[0].getUTCDay()).toBe(chatgptFanoutWeekday(id));
      }
    }
  });

  it('keeps a prompt on the same day, whatever the hour', () => {
    const id = ids[0];
    const day = Date.UTC(2026, 9, 29);
    const due = chatgptFanoutDue(id, new Date(day), 'sample');
    expect(chatgptFanoutDue(id, new Date(day + DAY_MS - 1), 'sample')).toBe(due);
  });

  it('spreads the prompts across the week', () => {
    const perDay = new Array(7).fill(0);
    for (const id of ids) perDay[chatgptFanoutWeekday(id)]++;
    // 100 a day on average; none of them close to empty or doubled.
    for (const count of perDay) {
      expect(count).toBeGreaterThan(70);
      expect(count).toBeLessThan(130);
    }
  });

  it('asks on every day on all, and on none on off', () => {
    for (const date of week(Date.UTC(2026, 9, 29, 2))) {
      for (const id of ids.slice(0, 50)) {
        expect(chatgptFanoutDue(id, date, 'all')).toBe(true);
        expect(chatgptFanoutDue(id, date, 'off')).toBe(false);
      }
    }
  });
});
