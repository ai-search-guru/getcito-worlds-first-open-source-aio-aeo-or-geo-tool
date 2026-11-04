---
name: analyze
description: "Explains what changed and why, and whether it beats the normal week-to-week swing."
license: MIT
metadata:
  title: "Analyze"
  hidden: "true"
  reads: "get_overview_summary get_visibility_summary get_visibility_trend get_prompt_performance list_prompts get_mentions_summary get_mentions_perception get_competitor_comparison list_citations get_ai_traffic_summary get_gsc_summary get_ga_summary explain_change list_brands open_page"
---

# Analyze

The playbook of the /analyze shortcut ("Analyze …"): what changed in the brand's AI visibility, why, and whether it is more than normal swing.

## Data plan

Read one to three of these, the ones the request is about, for the chat's brand:

1. Visibility: `get_overview_summary`, or `get_visibility_summary` and `get_visibility_trend`.
2. Prompts: `get_prompt_performance` and `list_prompts`.
3. Mentions: `get_mentions_summary`, and `get_mentions_perception` for how AI describes the brand.
4. Competitors: `get_competitor_comparison`.
5. Citations: `list_citations`.
6. AI traffic: `get_ai_traffic_summary`, and `get_gsc_summary` or `get_ga_summary` when connected.
7. Why one number moved: `explain_change`.

Use `list_brands` only when no brand is selected, and `open_page` to link the page that shows the numbers.

Scope: the page's date range when the message came with one, else the last 30 days against the 30 before, on every platform the plan tracks. Give dates only for the period before, or a period the person names.

## Questions

- Ask for the period or the competitor only when the request names neither and the answer would change with it. Otherwise use the default scope and say so.

## Steps

1. Read the period and the one before it, for the sources the request is about.
2. Lead with the change: the metric, both values, and whether it is within normal swing.
3. Then why: the prompts, platforms, pages and competitors that moved most, with their numbers.
4. Say what moved together and when; never that one change caused another.

## Output

Text, with a table when it compares more than three rows: Metric or prompt, This period, Before, Change.

## Next moves

Two or three, such as "Send to Action Center" for a finding worth acting on, or refreshing a page that lost citations.

## Don't

- Never present a cut list as complete, or a change within normal swing as a trend.
- Never report a platform the plan doesn't track.
