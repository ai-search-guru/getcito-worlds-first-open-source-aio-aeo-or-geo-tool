// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/supabase';
import { chatEvent } from './events';
import {
  CHAT_RUN_STEP_MEMBER_COLUMNS,
  CHAT_RUN_STEP_SELECT,
  toClientStep,
  type ChatRunStepMemberRow,
} from './steps';

/**
 * Stored steps as the browser gets them: the columns a member may read, and
 * the one function that turns a row into a step — never with its tool or
 * debug record, even from a row the server read in full.
 */

type StepRow = Database['public']['Tables']['chat_run_steps']['Row'];

const UUID = '7d3f2c1a-9b8e-4c6d-a5f4-3e2d1c0b9a87';

/** A step as the server reads it with the service role: every column. */
const FULL_ROW: StepRow = {
  id: UUID,
  run_id: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
  position: 2,
  kind: 'read',
  status: 'done',
  label: 'Read Citations',
  detail: 'Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows',
  scope_json: {
    subject: 'Pricing prompts',
    dateRange: 'Last 30 days',
    platforms: ['ChatGPT', 'Perplexity'],
    brandId: UUID,
  },
  row_count: 42,
  data_as_of: '2026-10-29T06:00:00+00:00',
  started_at: '2026-10-29T09:13:50+00:00',
  finished_at: '2026-10-29T09:13:52+00:00',
  tool: 'list_citations',
  debug_json: { input: { brand_id: UUID }, tokens: 1200, latencyMs: 840 },
  latency_ms: 840,
  cache_hit: true,
  truncated: true,
  result_tokens: 1200,
};

/** The columns only the server and staff read: the tool, its debug record and the step's measure (00410). */
const SERVER_ONLY = ['tool', 'debug_json', 'latency_ms', 'cache_hit', 'truncated', 'result_tokens'];

/** The columns 00400 grants members on chat_run_steps, read from the migrations. */
function grantedColumns(): string[] {
  const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
  let columns: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
    const grants = sql.matchAll(
      /grant\s+select\s*\(([^)]*)\)\s*on\s+(?:table\s+)?(?:public\.)?chat_run_steps\s+to\s+authenticated/gi,
    );
    for (const [, list] of grants) columns = list.split(',').map((c) => c.trim());
  }
  return columns;
}

describe('chat run step columns', () => {
  it('are the ones the migrations grant members, without the tool, its debug record or its measure', () => {
    expect([...CHAT_RUN_STEP_MEMBER_COLUMNS].sort()).toEqual(grantedColumns().sort());
    for (const column of SERVER_ONLY) {
      expect(CHAT_RUN_STEP_MEMBER_COLUMNS).not.toContain(column);
    }
  });

  it('cover every other column of the table', () => {
    const others = Object.keys(FULL_ROW).filter((c) => !SERVER_ONLY.includes(c));
    expect([...CHAT_RUN_STEP_MEMBER_COLUMNS].sort()).toEqual(others.sort());
  });

  it('make a select list, so a member never asks for *', () => {
    expect(CHAT_RUN_STEP_SELECT).toBe(CHAT_RUN_STEP_MEMBER_COLUMNS.join(', '));
    expect(CHAT_RUN_STEP_SELECT).not.toContain('*');
  });
});

describe('toClientStep', () => {
  it("gives the browser the step, never the tool or its debug record, from the server's full row", () => {
    const step = toClientStep(FULL_ROW);
    expect(step).toEqual({
      n: 2,
      kind: 'read',
      status: 'done',
      label: 'Read Citations',
      detail: 'Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows',
      scope: {
        subject: 'Pricing prompts',
        dateRange: 'Last 30 days',
        platforms: ['ChatGPT', 'Perplexity'],
      },
      rowCount: 42,
      dataAsOf: '2026-10-29T06:00:00.000Z',
    });
    const wire = JSON.stringify(step);
    expect(wire).not.toMatch(/list_citations|debug|tokens|latency|tool/i);
    expect(wire).not.toContain(UUID);
  });

  it('goes out as a step event as it is', () => {
    const step = toClientStep(FULL_ROW);
    expect(step).not.toBeNull();
    expect(chatEvent('step.finished', 1, { step: step! }).data.step).toEqual(step);
  });

  it('takes a row read with the member columns only', () => {
    const memberRow: ChatRunStepMemberRow = {
      id: UUID,
      run_id: UUID,
      position: 1,
      kind: 'thinking',
      status: 'running',
      label: 'Thinking',
      detail: null,
      scope_json: null,
      row_count: null,
      data_as_of: null,
      started_at: null,
      finished_at: null,
    };
    expect(toClientStep(memberRow)).toEqual({
      n: 1,
      kind: 'thinking',
      status: 'running',
      label: 'Thinking',
    });
  });

  it('shows a uuid in its words as "…" and keeps only the names in its scope', () => {
    const step = toClientStep({
      ...FULL_ROW,
      label: `Opened /products/${UUID}`,
      detail: `Prompt ${UUID}`,
      scope_json: { platforms: ['ChatGPT', 7, '', UUID], brand: 'Acme', prompt_ids: [UUID] },
    });
    expect(step?.label).toBe('Opened /products/…');
    expect(step?.detail).toBe('Prompt …');
    expect(step?.scope).toEqual({ platforms: ['ChatGPT', '…'], brand: 'Acme' });
  });

  it('keeps a memory step’s unit, items, and no other unit (CHAT-14 item 17)', () => {
    const memory = { ...FULL_ROW, row_count: 3 };
    expect(
      toClientStep({ ...memory, scope_json: { subject: 'Memory', unit: 'items' } })?.scope,
    ).toEqual({ subject: 'Memory', unit: 'items' });
    expect(toClientStep({ ...memory, scope_json: { unit: 'bytes' } })).not.toHaveProperty('scope');
  });

  it('leaves out a data time it cannot read', () => {
    expect(toClientStep({ ...FULL_ROW, data_as_of: 'soon' })).not.toHaveProperty('dataAsOf');
  });

  it("skips a kind or a status this build doesn't know (a newer server's)", () => {
    expect(toClientStep({ ...FULL_ROW, kind: 'navigate' })).toBeNull();
    expect(toClientStep({ ...FULL_ROW, status: 'archived' })).toBeNull();
  });
});
