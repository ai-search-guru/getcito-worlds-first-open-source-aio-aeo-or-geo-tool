/**
 * What the Prompts table shows. A read that failed with nothing on screen
 * says so and offers to read again: it is never "No prompts yet", which
 * would tell a brand with prompts to add its first one. A failed re-read
 * keeps the rows already shown.
 */
export type PromptsTableState = 'loading' | 'failed' | 'empty' | 'rows';

export function promptsTableState({
  loading,
  failed,
  rows,
}: {
  loading: boolean;
  failed: boolean;
  rows: number;
}): PromptsTableState {
  if (loading) return 'loading';
  if (rows > 0) return 'rows';
  return failed ? 'failed' : 'empty';
}
