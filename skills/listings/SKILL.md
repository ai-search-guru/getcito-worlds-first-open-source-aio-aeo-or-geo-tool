---
name: listings
description: "Lists the sources AI cites in a market and whether they list you."
license: MIT
metadata:
  title: "Listing gaps"
  filters: "visibility"
---

# Listing gaps

The directories, marketplaces, review sites and publishers AI engines cite in the brand's category, and whether each one lists the brand.

## When to use

- "Which directories and review sites does AI trust in our category?", "Where are we missing?", "Publisher sites."
- To fix what AI gets wrong about the brand, the Fix wrong claims about us skill fits better.

## What to read

1. `list_citations` with the external filter: the third-party sites AI cites for the brand's prompts, and how often.
2. `list_ai_answers` for the prompts that cite them: which brands those answers recommend.
3. `list_competitors`: the competitors to look for on each site.
4. `fetch_page` for each site's page about the category: whether it names the brand.

## Steps

1. Take the market the person names; with none, every market the brand tracks.
2. List the third-party sources AI cites most, by kind: directory, marketplace, review site, publisher.
3. For each: the answers that cite it, and the competitors it names.
4. Read its page to see whether it lists the brand. When the page can't be read, write "unknown".
5. Suggest a next step for each: ask for a listing, update a profile, or nothing to do.

## Output

1. A table: Source, Kind, Answers citing it, Lists you, Competitors listed, Next step.
2. Outreach drafts for the top three, when the person asks.
3. Sending leaves the workspace: the person does it. Chat sends nothing.

## Don't

- Never say a site lists the brand, or doesn't, without reading its page.
- Don't invent contacts, names or addresses for outreach.
- Never promise a listing will bring citations.
