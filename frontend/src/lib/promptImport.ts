/**
 * Bulk import of prompts from a spreadsheet (PROMPT-005): reading the rows,
 * and the preview that decides, before anything is written, which rows are
 * imported, skipped or left out by the plan limit.
 *
 * The file is one column of prompts, one per row, with an optional "Prompt"
 * header — the shape a list exported from another tool already has. Topic and
 * location are set afterwards from each prompt's Edit; imported prompts get
 * the dialog's platforms and the brand's location, like a single add.
 *
 * Pure on purpose. The dialog runs it to show the preview; the server action
 * re-runs the limit inside one locked database call, so the preview is a
 * promise the write keeps rather than a second definition that can drift.
 *
 * The limit is counted in tracked prompt locations, the unit the plan cap is
 * enforced in (promptLocations.ts). Every imported row tracks one location.
 */

/** Rows a single file may carry; larger files are split by the user. */
export const MAX_IMPORT_ROWS = 1000;
/** Longest prompt text accepted. */
export const MAX_PROMPT_LENGTH = 500;

export const TEMPLATE_HEADER = 'Prompt';

export type ImportRowStatus = 'valid' | 'duplicate' | 'error' | 'over_limit';

export interface ImportRow {
  /** 1-based row number in the file, header excluded. */
  row: number;
  text: string;
  status: ImportRowStatus;
  /** Why a row is skipped; null for valid rows. */
  reason: string | null;
}

export interface ImportPreview {
  rows: ImportRow[];
  /** Rows that will be imported, in file order. */
  importable: ImportRow[];
  counts: { valid: number; duplicates: number; errors: number; overLimit: number };
  /** Rows beyond MAX_IMPORT_ROWS, not read at all. */
  truncated: number;
  /** The file had more columns than the prompt one; they were not read. */
  extraColumns: boolean;
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * CSV with the delimiter detected from the first line (comma or semicolon —
 * Excel in many European locales saves with semicolons), quoted fields with
 * doubled quotes, CRLF, and a UTF-8 BOM.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = count(';') > count(',') ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Spreadsheet cells (numbers, dates, booleans, nulls) as trimmed text. */
export function cellsToText(rows: unknown[][]): string[][] {
  return rows
    .map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c !== ''));
}

const PROMPT_HEADERS = new Set(['prompt', 'prompts']);

/**
 * Where the prompts are. A first row naming a "Prompt" column is a header and
 * picks that column; without one, the first column holds the prompts from the
 * first row on.
 */
export function promptColumn(sheet: string[][]): { column: number; hasHeader: boolean } {
  const first = sheet[0] ?? [];
  const i = first.findIndex((c) => PROMPT_HEADERS.has(c.trim().toLowerCase()));
  return i >= 0 ? { column: i, hasHeader: true } : { column: 0, hasHeader: false };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

/** Duplicates ignore case and whitespace. */
export function promptKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface PreviewContext {
  /** Prompt texts the brand already tracks. */
  existingTexts: string[];
  /** Free tracked-location slots under the plan; -1 = unlimited. */
  freeSlots: number;
}

/**
 * Every row's fate. Duplicates and errors are skipped and use no slot. Valid
 * rows are taken in file order until the limit is reached; from there on
 * every valid row is "over limit".
 */
export function buildPreview(sheet: string[][], ctx: PreviewContext): ImportPreview {
  const { column, hasHeader } = promptColumn(sheet);
  const body = hasHeader ? sheet.slice(1) : sheet;
  const truncated = Math.max(0, body.length - MAX_IMPORT_ROWS);
  const data = body.slice(0, MAX_IMPORT_ROWS);
  const extraColumns = sheet.some((r) => r.some((c, i) => i !== column && c.trim() !== ''));

  const seen = new Set(ctx.existingTexts.map(promptKey));
  let used = 0;
  const rows: ImportRow[] = data.map((r, i) => {
    const text = (r[column] ?? '').trim().replace(/\s+/g, ' ');
    const row = i + 1;
    if (!text) return { row, text, status: 'error', reason: 'Empty prompt' };
    if (text.length > MAX_PROMPT_LENGTH) {
      return { row, text, status: 'error', reason: `Longer than ${MAX_PROMPT_LENGTH} characters` };
    }
    const key = promptKey(text);
    if (seen.has(key)) {
      return { row, text, status: 'duplicate', reason: 'Already tracked or repeated in the file' };
    }
    seen.add(key);
    if (ctx.freeSlots === -1 || used < ctx.freeSlots) {
      used += 1;
      return { row, text, status: 'valid', reason: null };
    }
    return { row, text, status: 'over_limit', reason: 'Over plan limit' };
  });

  const importable = rows.filter((r) => r.status === 'valid');
  return {
    rows,
    importable,
    counts: {
      valid: importable.length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      errors: rows.filter((r) => r.status === 'error').length,
      overLimit: rows.filter((r) => r.status === 'over_limit').length,
    },
    truncated,
    extraColumns,
  };
}

/** Rows as a one-column file, for the "not imported" and error downloads. */
export function rowsForCsv(rows: ImportRow[], withReason: boolean): Record<string, string>[] {
  return rows.map((r) => ({
    [TEMPLATE_HEADER]: r.text,
    ...(withReason ? { reason: r.reason ?? '' } : {}),
  }));
}

/** The downloadable template: the header and a few example prompts. */
export const TEMPLATE_ROWS: Record<string, string>[] = [
  { [TEMPLATE_HEADER]: 'Best project management tools for startups' },
  { [TEMPLATE_HEADER]: 'En iyi proje yönetim araçları hangileri?' },
  { [TEMPLATE_HEADER]: 'Which CRM is best for small businesses?' },
];
