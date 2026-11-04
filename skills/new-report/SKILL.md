---
name: new-report
description: "Builds a one-off report on the brand and keeps it in Reports, to open, share or download."
license: MIT
metadata:
  title: "Reports"
  hidden: "true"
  reads: "get_overview_summary get_visibility_summary get_visibility_trend get_competitor_comparison get_mentions_summary list_citations get_ai_traffic_summary get_reports list_brands open_page"
---

# Reports

The playbook of the /new-report shortcut ("Create a report on …"): a one-off report on the brand, kept in the Reports module. The Weekly report skill is /report; this is any other report the person asks for.

## Data plan

Read only what the report needs, for the chat's brand:

1. `get_overview_summary`, or `get_visibility_summary` and `get_visibility_trend`: visibility and its trend.
2. `get_competitor_comparison`: share of voice against the brand's competitors.
3. `get_mentions_summary`: mentions and sentiment.
4. `list_citations`: the pages and domains AI cites.
5. `get_ai_traffic_summary`, when the report is about AI traffic.
6. `get_reports`: the reports already made, so the new one doesn't repeat one from the same period.

Use `list_brands` only when no brand is selected, and `open_page` to link Reports.

Scope: the period the person names, else the last 30 days, with the brand's competitors and every platform the plan tracks.

## Questions

- When the request gives neither, ask who the report is for and which period, together in one question.

## Steps

1. Pick the report's template from what it is about: weekly_visibility for visibility, its trend and share of voice; executive_summary for leadership; competitor_benchmark for competitors; citation_sources for cited sources.
2. Make it with `build_report` over the period; the app asks the person first when it should.
3. Sum up its three most important findings in the answer, with their numbers.
4. When no template fits (an AI traffic report, say), write the report in the answer instead, in short sections with a table, so the person keeps it with **Save to Files** or downloads it.

## Output

The report in Reports, and three findings in the answer. Without a template: the report itself, in the answer.

## Next moves

Two or three, such as opening the report in Reports, or the same report for the period before.

## Don't

- Chat doesn't email or schedule the report: the person shares or downloads it from Reports.
- Keep it truthful: report drops as plainly as gains, and never claim one change caused another.
