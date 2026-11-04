/**
 * promptImport.test.ts  (PROMPT-005)
 *
 * Tests reading a one-column prompt file and the bulk-import preview:
 * duplicates, errors and the plan limit taken in file order.
 */

import { describe, expect, test } from 'vitest';
import {
  MAX_IMPORT_ROWS,
  buildPreview,
  cellsToText,
  parseCsv,
  promptColumn,
  promptKey,
  type PreviewContext,
} from './promptImport';

const ctx = (over: Partial<PreviewContext> = {}): PreviewContext => ({
  existingTexts: [],
  freeSlots: -1,
  ...over,
});

describe('parseCsv', () => {
  test('reads quotes, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿Prompt\r\n"Best, cheapest coffee"\r\n"Say ""hi"""\r\n')).toEqual([
      ['Prompt'],
      ['Best, cheapest coffee'],
      ['Say "hi"'],
    ]);
  });

  test('keeps Turkish characters and drops blank lines', () => {
    expect(parseCsv('Prompt\n\nEn iyi kahve aboneliği hangisi?\n\n')).toEqual([
      ['Prompt'],
      ['En iyi kahve aboneliği hangisi?'],
    ]);
  });
});

describe('cellsToText', () => {
  test('stringifies spreadsheet cells and drops empty rows', () => {
    expect(
      cellsToText([
        ['A', 3],
        [null, undefined],
        [' B ', true],
      ]),
    ).toEqual([
      ['A', '3'],
      ['B', 'true'],
    ]);
  });
});

describe('promptColumn', () => {
  test('a "Prompt" header, in any column and case, picks that column', () => {
    expect(
      promptColumn([
        ['id', 'PROMPT'],
        ['1', 'x'],
      ]),
    ).toEqual({ column: 1, hasHeader: true });
  });

  test('without a header the first column is prompts from the first row on', () => {
    expect(promptColumn([['Best coffee'], ['Best tea']])).toEqual({ column: 0, hasHeader: false });
  });
});

describe('buildPreview', () => {
  test('a file without a header imports every row', () => {
    const p = buildPreview([['Best coffee'], ['Best tea']], ctx());
    expect(p.importable.map((r) => r.text)).toEqual(['Best coffee', 'Best tea']);
  });

  test('marks duplicates (case and whitespace insensitive) and errors', () => {
    const p = buildPreview(
      [
        ['Prompt'],
        ['Best  Coffee'],
        ['best coffee'],
        ['Already here'],
        [''],
        ['x'.repeat(501)],
        ['Tea'],
      ],
      ctx({ existingTexts: ['already HERE'] }),
    );
    expect(p.rows.map((r) => r.status)).toEqual([
      'valid',
      'duplicate',
      'duplicate',
      'error',
      'error',
      'valid',
    ]);
    expect(p.rows[0].text).toBe('Best Coffee');
    expect(p.counts).toEqual({ valid: 2, duplicates: 2, errors: 2, overLimit: 0 });
  });

  test('Growth 200 with 50 used and a 250-row file: rows 1–150 in, 151–250 out', () => {
    const sheet = [['Prompt'], ...Array.from({ length: 250 }, (_, i) => [`Prompt ${i + 1}`])];
    const p = buildPreview(sheet, ctx({ freeSlots: 200 - 50 }));
    expect(p.counts).toEqual({ valid: 150, duplicates: 0, errors: 0, overLimit: 100 });
    expect(p.importable[149].row).toBe(150);
    expect(p.rows[150]).toMatchObject({ row: 151, status: 'over_limit' });
  });

  test('duplicates and errors after the limit still read as what they are', () => {
    const p = buildPreview([['Prompt'], ['A'], ['B'], ['a'], ['']], ctx({ freeSlots: 1 }));
    expect(p.rows.map((r) => r.status)).toEqual(['valid', 'over_limit', 'duplicate', 'error']);
  });

  test('zero free slots imports nothing', () => {
    const p = buildPreview([['Prompt'], ['A']], ctx({ freeSlots: 0 }));
    expect(p.counts).toMatchObject({ valid: 0, overLimit: 1 });
  });

  test('notes other columns, which are not read', () => {
    expect(
      buildPreview(
        [
          ['Prompt', 'Topic'],
          ['A', 'x'],
        ],
        ctx(),
      ).extraColumns,
    ).toBe(true);
    expect(buildPreview([['Prompt'], ['A']], ctx()).extraColumns).toBe(false);
  });

  test('reads at most MAX_IMPORT_ROWS rows and reports the rest', () => {
    const sheet = [['Prompt'], ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => [`P${i}`])];
    const p = buildPreview(sheet, ctx());
    expect(p.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(p.truncated).toBe(5);
  });

  test('promptKey ignores case and inner whitespace', () => {
    expect(promptKey('  Best   COFFEE ')).toBe(promptKey('best coffee'));
  });
});
