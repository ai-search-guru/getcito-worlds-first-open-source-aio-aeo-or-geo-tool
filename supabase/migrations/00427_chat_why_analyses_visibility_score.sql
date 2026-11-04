-- ============================================================================
-- 00427: Why did it move — keep a Visibility score analysis
-- ============================================================================
-- explain_change can now explain the Insights Visibility score
-- (metric visibility_score, why/score.ts). chat_why_analyses (00420) allowed
-- only the five v1 metrics, so keeping such an analysis failed its check and
-- the result wasn't kept. Same check, with visibility_score added. A
-- constraint swap on a small table: no rewrite, existing rows already pass.

alter table public.chat_why_analyses
  drop constraint if exists chat_why_analyses_metric_check;

alter table public.chat_why_analyses
  add constraint chat_why_analyses_metric_check check (
    metric in (
      'visibility',
      'mention_rate',
      'share_of_voice',
      'citations',
      'avg_position',
      'visibility_score'
    )
  );
