# Visibility scoring reference

The GetCito **AI Visibility Score** (0–100) is the Visibility number the
dashboard shows everywhere. Over the MCP server it is
`totals.aiVisibilityScore` in `get_visibility_summary`, and each
competitor's `score`. Knowing the breakdown lets you tell the user
**why** a score is what it is, not just what it is.

## The formula

The score is computed over a set of tracked AI answers — brand-wide, per
prompt, per topic, per platform or per day. The same formula applies to
every scope, which is why the numbers agree across the dashboard.

```
score = 100 × ( 0.60 × mention rate
              + 0.25 × citation rate
              + 0.15 × position factor × position support )
```

| Component | Weight | What it is | MCP field |
| --- | --- | --- | --- |
| Mention rate | 60% | Share of answers that name the brand | `mentionAnswers / resultCount` |
| Citation rate | 25% | Share of answers that cite the brand's own domain | `citationAnswers / resultCount` |
| Position factor | 15% | Mean of 1/position over answers that name the brand (1 = always named first) | `positionFactor` |

**Position support** damps the position term on thin evidence:
`mentionAnswers / (mentionAnswers + 20)`. A brand named first in 5
answers out of thousands does not get the full 15 points; one named in
hundreds of answers does.

The score is `null` when the scope has no answers. Sentiment is **not**
part of it.

## How to read a score

- **80+:** the brand is named in almost every answer, usually early, and
  its site is cited often. Default answer territory.
- **60–80:** strong. Named in most answers; citations or position leave
  some room.
- **35–60:** present but not dominant. Typically named in about half the
  answers, or named often but rarely cited.
- **15–35:** fringe. Named now and then, rarely cited. Competitors own
  the answer.
- **Below 15:** barely surfacing — prompts may not match the brand's
  territory, or competitors fully own it.

## Component diagnoses

When you see a low score, the components tell you the lever to pull:

- **Low mention rate:** the brand isn't being named. A content or
  positioning problem — no source the AI uses connects this prompt to
  the brand. This is the heaviest weight, so it moves the score most.
- **Mentions OK, low citation rate:** the AI knows the brand but cites
  other sites as sources. The brand needs citable content on the topic
  (definition-first paragraphs, primary research, original data).
  `list_citations` shows who gets cited instead.
- **Mentions OK, low position factor:** the brand is listed, but after
  competitors. Comparison pages and clear "best for" positioning help.

## Coverage is a different number

`totals.visibilityRatePct` is **coverage**: the share of tracked prompts
the brand appeared in at all (`visiblePrompts / promptCount × 100`). It
is a percentage and answers "in how many of my prompts do I show up?",
not "how strongly?". `get_competitor_comparison` ranks entries by the
same kind of rate (`visibility_rate_pct`).

`avgVisibility` (on the brand and on competitors) is a **deprecated**
legacy average from an older formula. Don't quote it.

## What NOT to say

- _"Aim for 100."_ — 100 needs every answer to name the brand first and
  cite its site. It is almost never the right target. Aim for category
  leadership.
- _"Score went down 5 points, panic."_ — single-digit movement on small
  samples is noise. Always check `resultCount` before reacting.
- _"Visibility is 48%."_ — the score has no % sign. Rates and coverage
  do.

## Math sanity checks

Reference shapes (answers = `resultCount`):

| Answers | Mentioned in | Cited in | Position factor | Score |
| --- | --- | --- | --- | --- |
| 100 | 0 | 0 | — | 0 |
| 100 | 10 | 0 | 1.0 | 11.0 |
| 100 | 50 | 0 | 0.33 | 33.5 |
| 100 | 50 | 10 | 0.5 | 37.9 |
| 100 | 80 | 0 | 0.5 | 54.0 |
| 100 | 80 | 40 | 1.0 | 70.0 |
| 100 | 100 | 100 | 1.0 | 97.5 |
| 10 | 10 | 0 | 1.0 | 65.0 |

The last row is why small samples mislead: 10 answers, all naming the
brand first, already score 65.
