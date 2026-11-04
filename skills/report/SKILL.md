---
name: report
description: "Citations, mentions and share of voice: what changed and why. Ready to share with your team."
license: MIT
metadata:
  title: "Weekly report"
  filters: "reports"
---

# Weekly report

A one-page report a team can read in two minutes: where the brand stands in AI answers this week, what changed, and what to do next.

## When to use

- "Write this week's report", "Give me a weekly recap", "What should I tell the team on Monday?"
- For another period, follow the same layout with the period the person names.

## What to read

1. Seven days of answers: `get_overview_summary`, or `get_visibility_summary` for this week and for last week, on every tracked platform.
2. `get_visibility_trend` by day for the two weeks.
3. `get_mentions_summary`: mention rate and sentiment against the week before.
4. `get_competitor_comparison` for this week and last: share of voice against competitors.
5. `list_citations` for both weeks: the pages that gained or lost citations.
6. `get_prompt_performance` sorted by visibility, both ways, for the biggest gainers and losers.
7. `list_action_center_tasks` sorted by priority, open ones only, and `get_action_history` for actions closed this week.

## Steps

1. Read 7 days of answers on all tracked platforms.
2. Compare with last week: citations, mentions and share of voice.
3. Write the report in the layout below.

## Output

**Weekly report · {first day} to {last day}**

1. **Summary:** three bullets, the most important first.
2. **Numbers:** a table with Metric, This week, Last week and Change, for citations, mentions, share of voice and visibility.
3. **What changed and why:** the prompts, pages and platforms that moved most, up and down, with their numbers and what moved with them.
4. **Competitors:** who gained or lost share of voice.
5. **Next week:** the three Action Center actions to work on, by priority, and what closed this week.

End with the date of the newest data the report used.

## Don't

- Chat doesn't email the report: the person keeps it with **Save to Files** or downloads it, and sends it to the team.
- Never claim a change caused another: say what moved together, and when. An outcome before day 30 is a reading so far.
- Keep it internal and truthful: report drops as plainly as gains.
