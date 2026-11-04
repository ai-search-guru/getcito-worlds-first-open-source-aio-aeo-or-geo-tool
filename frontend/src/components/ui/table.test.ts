/**
 * table.test.ts
 *
 * Tests the sticky header / first column classes exported from table.tsx.
 */

import { describe, expect, test } from 'vitest';
import { stickyTableClasses } from './table';

describe('stickyTableClasses', () => {
  test('a plain table only scrolls sideways and adds no sticky classes', () => {
    const c = stickyTableClasses({});
    expect(c.sticky).toBe(false);
    expect(c.container).toBe('overflow-x-auto');
    expect(c.table).toBe('');
  });

  test('stickyHeader caps the height, scrolls inside, and pins header cells', () => {
    const c = stickyTableClasses({ stickyHeader: true });
    expect(c.sticky).toBe(true);
    expect(c.container).toContain('overflow-auto');
    expect(c.container).toContain('max-h-');
    expect(c.table).toContain('[&_thead_th]:sticky');
    expect(c.table).toContain('[&_thead_th]:top-0');
    expect(c.table).toContain('[&_thead_th]:bg-card');
    expect(c.table).not.toContain('[&_tr>*:first-child]:sticky');
  });

  test('stickyFirstColumn pins the first cell of every row to the left', () => {
    const c = stickyTableClasses({ stickyFirstColumn: true });
    expect(c.sticky).toBe(true);
    expect(c.container).toContain('overflow-auto');
    expect(c.table).toContain('[&_tr>*:first-child]:sticky');
    expect(c.table).toContain('[&_tr>*:first-child]:left-0');
    expect(c.table).not.toContain('[&_thead_th]:sticky');
  });

  test('with both, the top-left header cell sits above the other sticky cells', () => {
    const c = stickyTableClasses({ stickyHeader: true, stickyFirstColumn: true });
    expect(c.table).toContain('[&_thead_th:first-child]:z-20');
  });
});
