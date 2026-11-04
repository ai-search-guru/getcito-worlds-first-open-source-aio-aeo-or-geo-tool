import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS_VIEW,
  MAX_LOCATION_COLUMNS,
  PROMPT_COLUMNS,
  addLocationColumn,
  parseLocationColumn,
  pendingColumn,
  removeColumn,
  effectiveView,
  moveColumn,
  readColumnsView,
  sameView,
  toggleColumn,
  visibleColumns,
} from './promptTableColumns';

/** The Tracked Prompts table's columns (PROMPT-015a). */

describe('readColumnsView', () => {
  it("drops ids it doesn't know and puts a new column back at its default place", () => {
    const view = readColumnsView({
      order: ['visibility', 'gone', 'topic', 'status', 'mentions', 'visibility'],
      hidden: ['runs', 'nope'],
    });
    expect(view?.order.slice(0, 5)).toEqual(['visibility', 'topic', 'status', 'work', 'mentions']);
    expect(view?.order).toHaveLength(PROMPT_COLUMNS.length);
    expect(new Set(view?.order)).toEqual(new Set(PROMPT_COLUMNS));
    expect(view?.hidden).toEqual(['runs']);
  });

  it("reads anything that isn't a view as none", () => {
    expect(readColumnsView(null)).toBeNull();
    expect(readColumnsView([])).toBeNull();
    expect(readColumnsView({ hidden: [] })).toBeNull();
  });
});

describe('a view', () => {
  it('shows every column, in order, by default', () => {
    expect(visibleColumns(DEFAULT_COLUMNS_VIEW)).toEqual([...PROMPT_COLUMNS]);
  });

  it('hides and shows a column', () => {
    const hidden = toggleColumn(DEFAULT_COLUMNS_VIEW, 'competition', false);
    expect(visibleColumns(hidden)).not.toContain('competition');
    expect(sameView(toggleColumn(hidden, 'competition', true), DEFAULT_COLUMNS_VIEW)).toBe(true);
  });

  it('moves a column a step, or to where it was dropped', () => {
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'status', -1).order.slice(0, 2)).toEqual([
      'status',
      'topic',
    ]);
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'topic', -1).order[0]).toBe('topic');
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'lastRun', 1).order.at(-1)).toBe('lastRun');
    // Dropped on a later column: after it. On an earlier one: before it.
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'topic', 'work').order.slice(0, 3)).toEqual([
      'status',
      'work',
      'topic',
    ]);
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'volume', 'visibility').order.slice(3, 5)).toEqual([
      'volume',
      'visibility',
    ]);
  });

  it("is the person's own, else the brand's shared one, else the default", () => {
    const mine = toggleColumn(DEFAULT_COLUMNS_VIEW, 'runs', false);
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    expect(effectiveView(mine, brand)).toBe(mine);
    expect(effectiveView(null, brand)).toBe(brand);
    expect(effectiveView(null, null)).toBe(DEFAULT_COLUMNS_VIEW);
  });
});

describe('location columns (PROMPT-015b)', () => {
  it('adds a metric in a location at the end, once, and takes it out', () => {
    const added = addLocationColumn(DEFAULT_COLUMNS_VIEW, 'visibility', 'TR');
    expect(added.order.at(-1)).toBe('loc:visibility:TR');
    expect(addLocationColumn(added, 'visibility', 'TR').order).toEqual(added.order);
    expect(parseLocationColumn('loc:position:US-CA')).toEqual({
      metric: 'position',
      region: 'US-CA',
    });
    expect(parseLocationColumn('volume')).toBeNull();
    expect(removeColumn(added, 'loc:visibility:TR')).toEqual(DEFAULT_COLUMNS_VIEW);
  });

  it(`keeps saved ones, ${MAX_LOCATION_COLUMNS} at most, and drops malformed ones`, () => {
    const many = Array.from({ length: 10 }, (_, i) => `loc:mentions:R${i}`);
    const view = readColumnsView({
      order: [...PROMPT_COLUMNS, ...many, 'loc:nope:TR'],
      hidden: [],
    });
    expect(view?.order.filter((id) => id.startsWith('loc:'))).toHaveLength(MAX_LOCATION_COLUMNS);
    expect(view?.order).not.toContain('loc:nope:TR');
  });
});

describe('pendingColumn', () => {
  const active = { isActive: true, regions: ['US', 'TR'] };
  const all = [...PROMPT_COLUMNS];

  it('says it once, in the first answer column shown, for a row with no answers', () => {
    expect(pendingColumn(active, { hasAnswers: false, region: '', columns: all })).toBe(
      'visibility',
    );
    // Visibility hidden, Runs moved ahead of Mentions.
    expect(
      pendingColumn(active, {
        hasAnswers: false,
        region: '',
        columns: ['topic', 'status', 'runs', 'mentions', 'loc:visibility:TR'],
      }),
    ).toBe('runs');
    // No answer column shown: nowhere.
    expect(
      pendingColumn(active, { hasAnswers: false, region: '', columns: ['topic', 'volume'] }),
    ).toBeNull();
  });

  it('leaves a row with answers to its figures', () => {
    expect(pendingColumn(active, { hasAnswers: true, region: '', columns: all })).toBeNull();
    expect(pendingColumn(active, { hasAnswers: true, region: 'TR', columns: all })).toBeNull();
  });

  it('with a location picked, says it only for a prompt tracked there', () => {
    expect(pendingColumn(active, { hasAnswers: false, region: 'TR', columns: all })).toBe(
      'visibility',
    );
    expect(pendingColumn(active, { hasAnswers: false, region: 'DE', columns: all })).toBeNull();
  });

  it("names a paused prompt only when the Status column doesn't already", () => {
    const paused = { ...active, isActive: false };
    expect(pendingColumn(paused, { hasAnswers: false, region: '', columns: all })).toBeNull();
    expect(
      pendingColumn(paused, {
        hasAnswers: false,
        region: '',
        columns: all.filter((id) => id !== 'status'),
      }),
    ).toBe('visibility');
  });
});
