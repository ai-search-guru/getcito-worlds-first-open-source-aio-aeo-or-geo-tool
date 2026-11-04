---
name: markets
description: "Shows who AI recommends in each market and language you track."
license: MIT
metadata:
  title: "Who AI recommends by market"
  filters: "visibility"
---

# Who AI recommends by market

Who AI engines recommend in each market the brand tracks, and where a competitor leads in one market but not in the others.

## When to use

- "Where in Germany does AI send buyers to rivals?", "Market snapshot", "How do we do in each country?"
- For the sources AI cites in a market, the Listing gaps skill fits better.

## What to read

1. `list_prompts`: the locations each prompt tracks. A market is a location the brand's prompts track.
2. `get_visibility_summary` and `get_competitor_comparison` for each market: the brand's place and the competitors'.
3. `list_ai_answers` for the market's prompts: which brands each engine recommends there, and how buyers ask.
4. `list_citations` for the market: the sources behind those answers.

## Steps

1. List the markets the brand tracks. With only one, compare languages or segments instead, and say so.
2. For each market: the brands AI recommends most, and the brand's place.
3. Where a competitor leads in one market but not in the others, say where, on which prompts, and which sources back it.
4. Note the markets with too few answers to tell anything yet.

## Output

1. One table per market: Brand, Mentioned in, Recommended in, Top prompt.
2. "Where to start": the market and prompts where a change would count most.

## Don't

- Don't name a market the brand doesn't track.
- Don't guess a market's size or the brand's sales there.
- Don't compare markets with too few answers to tell.
